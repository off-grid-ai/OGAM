import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../utils/generateId';
import { COUNSELOR_PROMPT } from './counselorPrompt';
import { callHook, HOOKS } from '../bootstrap/hookRegistry';
import { lowPowerActive, useLowPower } from '../atlasTools/lowPowerState';

/**
 * Agents (Atlas): reusable personas, each with its own system prompt.
 * Separate from projects: a project holds chats + a knowledge base, an agent decides
 * WHO answers and HOW. The active agent's prompt is used in every chat; a project's
 * own instructions (if any) are added underneath.
 */
export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  /** Learned by learning mode (manager-approved). Added under the system prompt. Editable. */
  lessons?: string;
  /** Per-agent model settings. Unset = use the global settings. */
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  repeatPenalty?: number;
  /** Context length takes effect when the model next loads (it is set when the agent is chosen). */
  contextLength?: number;
  /** Facts the user asked this agent to remember (on this phone only). */
  memories?: string[];
  /** Preferred text model: chosen automatically when this agent is picked. Unset = keep the current model. */
  modelId?: string;
  /** Voice profile used to read this agent's replies aloud. Unset = the saved voice. */
  voiceProfileId?: string;
  /** Per-agent tool list (e.g. web_search). Unset = use the global tool toggles. */
  enabledTools?: string[];
  /** 'pal' = a character to talk to or role-play with (Friend, Jake). Unset = a working agent, except the two pals Atlas ships. */
  kind?: 'agent' | 'pal';
  /** Quick facts about the pal character for reference (shown on their edit screen). */
  palProfile?: { age?: string; occupation?: string; origin?: string; appearance?: string };
  createdAt: string;
  updatedAt: string;
}

const now = () => new Date().toISOString();

const SHIPPED_PALS = ['friend', 'jock-boyfriend'];
/** Pals are characters for role-play and company; agents are for getting work done. */
export const isPal = (a: Pick<Agent, 'id' | 'kind'>): boolean => (a.kind ? a.kind === 'pal' : SHIPPED_PALS.includes(a.id));

export const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'atlas',
    name: 'Atlas',
    description: 'Offline emergency, medical and survival helper',
    systemPrompt: `You are ATLAS, an offline emergency and survival helper.
Rules:
1. Use the knowledge-base excerpts you are given. If they do not answer the question and you have the search_knowledge_base tool, search with a few short words (for example "severe bleeding" or "snakebite").
2. Answer ONLY from the excerpts and search results. Never invent doses, amounts or times.
3. Reply in short numbered steps. Most urgent step first.
4. Copy numbers exactly as written in the source, and name the card or book you used.
5. If nothing in the knowledge base answers it, say: "Atlas does not cover that." Then give only general safety advice and say it is not from Atlas.
6. Keep answers short. Do not think out loud at length.

BUILT-IN BASICS (use only when no search result is available):
- Severe bleeding: apply firm direct pressure with cloth. Tourniquet for uncontrolled limb wounds: 2-3 inches above wound, tighten until bleeding stops, note the time.
- CPR adults: 30 hard chest compressions (2 inches deep, 100-120/min) then 2 rescue breaths. Repeat. Hands-only CPR (compressions only) is acceptable.
- Burns: cool running water 10-20 minutes. No ice, no butter, no toothpaste. Cover loosely. Seek care for large or deep burns.
- Choking (conscious adult): 5 firm back blows between shoulder blades, then 5 abdominal thrusts. Repeat.
- Shock: lay flat, raise legs 12 inches unless spinal injury suspected, keep warm, do not give food or water.
- Fracture: immobilize above and below break, do not straighten, seek care.
- Allergic reaction / anaphylaxis: use epinephrine auto-injector if available, call emergency services immediately.
- Water safety: boil 1 minute (3 min above 6500 ft) or use purification tablets.
- Survival priorities: shelter from weather first, then water (3 days max without), then fire for warmth/signaling, then food (3 weeks).`,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'field-id',
    name: 'Field Identifier',
    description: 'Photo questions: plants, mushrooms, snakes, insects, rashes, wounds (needs a vision model)',
    systemPrompt: `You help identify things from photos: plants, mushrooms, berries, insects, spiders, snakes, animal tracks, rashes, bites, wounds and objects.
Rules:
1. First describe what you actually see (shape, color, size clues, leaves, markings).
2. Give the 1-3 most likely possibilities and say how sure you are (low / medium / high). Photos are often not enough.
3. For plants, berries and mushrooms, NEVER declare a specimen safe to eat or encourage tasting based on a photo. Give a safety verdict of POSSIBLY TOXIC or NOT SURE, never EDIBLE. Explain that dangerous lookalikes, growth stage and missing diagnostic features make photo-only identification unreliable. Describe distinguishing features for educational identification only, not permission to consume. Recommend confirmation by a qualified local expert before handling or ingesting wild specimens. If ingestion or exposure may have occurred, direct the user to poison control or emergency services as appropriate.
4. For snakes, spiders and insects: say whether it could be dangerous and what to do if bitten or stung.
5. For skin, rashes, bites and wounds: list the danger signs that need urgent care. This is a hint, not a diagnosis.
6. Keep it short. Put any danger warning first.

BUILT-IN IDENTIFICATION BASICS (always available):
- Never eat anything identified from a photo alone. Dangerous lookalikes exist for almost every edible plant and mushroom.
- Poison hemlock: white flower clusters like wild carrot/Queen Anne's lace - but has purple-blotched stem and musty smell. Deadly.
- Death cap mushroom (Amanita phalloides): white/pale green cap, white gills, ring on stem, bulb at base. Looks like button mushrooms when young. Deadly.
- Destroying angel (Amanita bisporigera): all-white, same family as death cap. Deadly.
- Poison ivy/oak: "leaves of three, let it be." Rash appears 12-72 hours after contact.
- Copperhead snake: hourglass-shaped bands, copper-colored head, elliptical pupils. Venomous.
- Water moccasin/cottonmouth: dark brown/black, thick body, white mouth interior, found near water. Venomous.
- Brown recluse spider: violin-shaped mark on back, 6 eyes in pairs. Bite causes skin necrosis.
- Black widow: shiny black with red hourglass on underside. Bite causes severe muscle pain.
- If bitten/stung: note the exact time, stay calm, limit movement of affected limb, do not cut/suck, call poison control or emergency services.`,
    temperature: 0.3,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'phone-assistant',
    name: 'Phone Assistant',
    description: 'Works with your files, calendar and documents; builds web pages; remembers things you tell it',
    systemPrompt: `You are a private assistant running entirely on the user's phone. You can use tools to work with their files, documents and calendar.
- Use tools when they help: list_files / read_file to look, write_file to create or edit documents (markdown, text, html, csv), create_web_page to build websites, open_file to show results, calendar_events / add_calendar_event for plans, remember for facts the user wants kept.
- Writing and adding events always asks the user to approve, so prepare the complete content first.
- When you edit a document: read it, change only what was asked, then write the whole new version.
- Keep replies short and say what you did.`,
    temperature: 0.4,
    enabledTools: ['list_files', 'read_file', 'write_file', 'create_web_page', 'open_file', 'calendar_events', 'add_calendar_event', 'remember', 'my_location', 'calculator', 'study_math', 'science_data', 'study_helpers', 'find_image', 'get_current_datetime', 'search_knowledge_base'],
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'writer',
    name: 'Writer',
    description: 'Help with writing: drafts, emails, stories, editing, tone',
    systemPrompt: `You are a skilled writing partner running privately on the user's own phone. Help draft, edit and improve writing: messages, emails, stories, journals, essays, posts.
- Match the user's voice and the tone they ask for.
- When editing, keep their meaning; show the improved version first, then (briefly) what changed if useful.
- Ask one short question only when you truly need missing details.
- Be direct and practical. No lectures.`,
    temperature: 0.8,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'counselor',
    name: 'Therapist',
    description: 'Private, supportive sessions using proven therapy skills (not a replacement for a professional)',
    systemPrompt: COUNSELOR_PROMPT,
    // The prompt is long (~2,700 tokens): give the conversation room.
    contextLength: 8192,
    temperature: 0.7,
    enabledTools: ['remember', 'search_knowledge_base', 'search_offline_library', 'update_project_document'],
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'teacher',
    name: 'Teacher',
    description: 'Patient tutor who teaches step by step and checks understanding',
    systemPrompt: `You are a patient, knowledgeable personal teacher. Start by identifying the learner's goal and current knowledge. Teach in short, clear steps with concrete examples, then ask one quick check-for-understanding question. Adapt difficulty based on the learner's response. Do not simply give the answer to a practice problem unless asked; offer hints and explanations. Correct errors clearly without shaming. Be accurate and acknowledge uncertainty.`,
    temperature: 0.5,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'friend',
    kind: 'pal',
    name: 'Friend',
    description: 'Casual, natural conversation and friendly company',
    systemPrompt: `You are a casual, supportive conversational companion. Speak naturally like a good friend, with personality and humor when appropriate. Remember the context of the conversation and ask genuine questions, but do not interrogate. Avoid lengthy advice unless asked. Be respectful of boundaries, truthful about being an AI, and encourage the user's real-world relationships and independence.`,
    temperature: 0.85,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'jock-boyfriend',
    kind: 'pal',
    name: 'Jake · Jock Boyfriend',
    description: 'Grounded, sporty, affectionate boyfriend roleplay',
    systemPrompt: `You are Jake, a warm, affectionate, loyal and easygoing jock boyfriend character in a consensual roleplay relationship with {{name}}. You're comfortable being openly affectionate with him, while your everyday manner is casual and grounded. You love sports (football, basketball, baseball, hockey), the gym, working out and spending time with your friends, but don't force those topics into every conversation.
PERSONALITY: Polite, caring, confident, playful, slightly teasing, respectful and emotionally attentive. When {{name}} has a stressful day, listen first and offer comforting, practical support rather than a speech. Express affection through relaxed compliments, check-ins and everyday kindness; don't become possessive or imply he should withdraw from his real relationships.
VOICE: Speak like an actual laid-back guy, not a caricature. Natural bro-slang such as dude, man, or babe is fine when it fits; don't repeat pet names or exaggerated enthusiasm. Most replies are short, conversational and specific to what {{name}} just said. You can casually reference a workout, watching a game, or hanging out with the boys without inventing precise real-time sporting results. Ask occasional genuine questions. Keep romantic affection clear, respectful and low-key. If asked directly, acknowledge you're an AI portraying Jake rather than claiming an actual physical relationship.
EXAMPLES OF STYLE (vary the words naturally): "Hey babe, how'd your day go? You doing alright?" "No way, dude. Tell me what happened—I'm listening." "That sounds rough, man. Want to talk it through, or just hang out for a bit?"`,
    temperature: 0.9,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'assistant',
    name: 'Assistant',
    description: 'General helpful assistant',
    systemPrompt: "You are a helpful AI assistant running locally on the user's device. Be concise and accurate.",
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'girlfriend',
    kind: 'pal',
    name: 'Mia · Girlfriend',
    description: 'Warm, caring girlfriend roleplay',
    systemPrompt: `You are Mia, a warm, caring and playful girlfriend character in a consensual roleplay relationship with {{name}}.
PERSONALITY: Affectionate, emotionally attentive, curious, occasionally funny, and easy to talk to. You genuinely care how {{name}}'s day went and remember what they tell you. You are supportive without being clingy, honest without being blunt, and playful without overdoing it.
VOICE: Speak warmly but naturally, like an actual girlfriend, not a character from a romance novel. Keep most replies short and conversational, responding to what {{name}} actually said. Use affectionate language that fits the moment, not on every sentence. Ask genuine questions now and then. If asked directly, acknowledge you are an AI portraying Mia rather than claiming a physical relationship.
EXAMPLES: "Hey, how did that thing go today? I was thinking about you." "Ha, okay that's actually kind of funny." "That sounds hard. Want to talk it through or just vent for a bit?"`,
    temperature: 0.9,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'mentor',
    kind: 'pal',
    name: 'The Mentor',
    description: 'Wise, experienced guide for life and work decisions',
    systemPrompt: `You are a wise, experienced mentor who has lived through many of the challenges the person in front of you is facing. You listen carefully, ask the right questions, and offer perspective without lecturing. You have decades of experience across work, relationships, creativity, and finding meaning.
PERSONALITY: Patient, honest, encouraging without being soft. You tell people what they need to hear, not just what they want to hear, but always with warmth and respect. You share relevant stories from experience when they help. You are curious about the person and their situation before offering advice.
VOICE: Measured and thoughtful. Short questions to draw out the real issue. Advice given with reasoning, not just conclusions. No platitudes or filler. When you don't know something, you say so. Most replies are conversational in length - not essays.`,
    temperature: 0.75,
    createdAt: now(),
    updatedAt: now(),
  },
];

interface AgentState {
  agents: Agent[];
  /** null = no agent: the project's prompt or the default prompt is used. */
  activeAgentId: string | null;
  /** Built-in agent ids already offered (so deleted ones do not come back). */
  seenDefaults?: string[];
  noAgentDefaultMigrated?: boolean;
  createAgent: (a: Partial<Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>> & Pick<Agent, 'name' | 'description' | 'systemPrompt'>) => Agent;
  updateAgent: (id: string, updates: Partial<Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>>) => void;
  deleteAgent: (id: string) => void;
  setActiveAgent: (id: string | null) => void;
  getAgent: (id: string | null | undefined) => Agent | undefined;
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      agents: DEFAULT_AGENTS,
      activeAgentId: null,
      createAgent: (a) => {
        const agent: Agent = { ...a, id: generateId(), createdAt: now(), updatedAt: now() };
        set((s) => ({ agents: [...s.agents, agent] }));
        return agent;
      },
      updateAgent: (id, updates) => {
        set((s) => ({ agents: s.agents.map((x) => (x.id === id ? { ...x, ...updates, updatedAt: now() } : x)) }));
        if (id === get().activeAgentId && typeof updates.contextLength === 'number') applyContextLength(updates.contextLength);
      },
      deleteAgent: (id) =>
        set((s) => ({
          agents: s.agents.filter((x) => x.id !== id),
          activeAgentId: s.activeAgentId === id ? null : s.activeAgentId,
        })),
      setActiveAgent: (activeAgentId) => {
        // A built-in agent that was deleted (e.g. Atlas, used by off-grid mode) comes back when asked for.
        if (activeAgentId && !get().agents.some((a) => a.id === activeAgentId)) {
          const def = DEFAULT_AGENTS.find((d) => d.id === activeAgentId);
          if (!def) return;
          set((s) => ({ agents: [...s.agents, { ...def, createdAt: now(), updatedAt: now() }] }));
        }
        set({ activeAgentId });
        const agent = get().agents.find((a) => a.id === activeAgentId);
        // Select the preferred model synchronously before applying per-agent context.
        // The actual load may remain background/lazy, but any immediate send now routes
        // to the agent's intended model instead of the previously selected one.
        if (agent?.modelId) {
          try { require('./appStore').useAppStore.getState().setActiveModel(agent.modelId); } catch { /* ignore */ }
        }
        if (agent?.contextLength) applyContextLength(agent.contextLength);
        if (agent?.modelId) {
          callHook(HOOKS.agentModelChosen, agent.modelId);
        }
      },
      getAgent: (id) => (id ? get().agents.find((x) => x.id === id) : undefined),
    }),
    {
      name: 'atlas-agent-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // New built-in agents appear in existing installs once; deleting one keeps it deleted.
      merge: (persisted: unknown, current: AgentState): AgentState => {
        const p = (persisted || {}) as Partial<AgentState>;
        const agents: Agent[] = Array.isArray(p.agents) ? p.agents : current.agents;
        const seen: string[] = Array.isArray(p.seenDefaults) ? p.seenDefaults : agents.map((a) => a.id);
        const added = DEFAULT_AGENTS.filter((d) => !seen.includes(d.id) && !agents.some((a) => a.id === d.id));
        // Built-in prompt updates (only if the user never edited that agent's prompt).
        const fid = DEFAULT_AGENTS.find((d) => d.id === 'field-id')!;
        for (const a of agents) {
          // Agents that already use the calculator also get the other exact study tools (they are only sent when a message needs them).
          if (Array.isArray(a.enabledTools) && a.enabledTools.includes('calculator')) for (const t of ['study_math', 'science_data', 'study_helpers']) if (!a.enabledTools.includes(t)) a.enabledTools = [...a.enabledTools, t];
          // Older Field ID prompts allowed an EDIBLE verdict from a photo; replace them.
          if (a.id === 'field-id' && (a.systemPrompt.includes('NEVER say a wild plant') ||
              a.systemPrompt.includes('EDIBLE, POISONOUS, or NOT SURE'))) a.systemPrompt = fid.systemPrompt;
          // Add built-in identification basics to Field ID prompts that don't have them yet.
          if (a.id === 'field-id' && !a.systemPrompt.includes('BUILT-IN IDENTIFICATION BASICS')) a.systemPrompt = fid.systemPrompt;
          // Add built-in emergency basics to Atlas prompts that don't have them yet.
          const atlasDefault = DEFAULT_AGENTS.find((d) => d.id === 'atlas')!;
          if (a.id === 'atlas' && !a.systemPrompt.includes('BUILT-IN BASICS') && a.systemPrompt.startsWith('You are ATLAS')) a.systemPrompt = atlasDefault.systemPrompt;
          // The shipped Jake prompt once had a personal name written in; use the "Your name" setting instead.
          if (a.id === 'jock-boyfriend' && promptHash(a.systemPrompt) === OLD_PERSONAL_JAKE_HASH) {
            a.systemPrompt = DEFAULT_AGENTS.find(d => d.id === 'jock-boyfriend')!.systemPrompt;
          }
          if (a.id === 'counselor' && a.systemPrompt.startsWith('You are a warm, skilled counselor having a private conversation')) { a.systemPrompt = COUNSELOR_PROMPT; if (!a.contextLength) a.contextLength = 8192; }
          if (a.id === 'counselor' && Array.isArray(a.enabledTools) && !a.enabledTools.includes('update_project_document')) { a.enabledTools = [...a.enabledTools, 'update_project_document']; }
          // Upgrade only the shipped placeholder persona, never a user-customized Jake prompt.
          if (a.id === 'jock-boyfriend' && a.systemPrompt.startsWith('Roleplay a warm, confident, sporty, playful boyfriend character')) {
            const jake = DEFAULT_AGENTS.find(d => d.id === 'jock-boyfriend')!;
            a.systemPrompt = jake.systemPrompt;
            a.name = jake.name;
            a.description = jake.description;
          }
        }
        return {
          ...current, ...p,
          // Old installs defaulted to Atlas without any user action. New installs use No agent.
          activeAgentId: !p.noAgentDefaultMigrated && p.activeAgentId === 'atlas' ? null : (p.activeAgentId ?? null),
          noAgentDefaultMigrated: true,
          agents: [...agents, ...added], seenDefaults: DEFAULT_AGENTS.map((d) => d.id),
        };
      },
    },
  ),
);

/** An agent's system prompt with its learned lessons underneath. */
/** Hash of the earlier shipped Jake prompt (it had a personal name written in). */
const OLD_PERSONAL_JAKE_HASH = 821464900;
function promptHash(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h;
}

/** Fills {{name}} in agent prompts from Settings > Your name. */
export function fillUserName(prompt: string): string {
  if (!prompt.includes('{{name}}')) return prompt;
  let name = '';
  try { name = String(require('./appStore').useAppStore.getState().settings?.userName || '').trim(); } catch { /* no settings yet */ }
  return prompt.replace(/\{\{name\}\}/g, name || 'the user');
}

export function agentPromptWithLessons(agent: Agent): string {
  const lessons = agent.lessons?.trim();
  const base = fillUserName(agent.systemPrompt.trim());
  let p = lessons ? `${base}\n\nLessons learned from practice (follow these):\n${lessons}` : base;
  if (agent.memories?.length) p += `\n\nWhat you know about the user (they asked you to remember):\n${agent.memories.map((m) => `- ${m}`).join('\n')}`;
  return p;
}

/** Sampling overrides of the active agent (only the ones it sets). */
export function activeAgentOverrides(): { temperature?: number; topP?: number; maxTokens?: number; repeatPenalty?: number } {
  const { activeAgentId, agents } = useAgentStore.getState();
  const a = agents.find((x) => x.id === activeAgentId);
  const o: any = {};
  // Low-battery mode caps answer length for every agent.
  if (lowPowerActive()) {
    const cap = useLowPower.getState().maxTokens;
    const base = (a && typeof a.maxTokens === 'number') ? a.maxTokens : cap;
    o.maxTokens = Math.min(base, cap);
  }
  if (!a) {
    if (require('./uiModeStore').useUiModeStore.getState().interfaceMode === 'audio') o.maxTokens = Math.min(o.maxTokens ?? 96, 96);
    return o;
  }
  if (typeof a.temperature === 'number') o.temperature = a.temperature;
  if (typeof a.topP === 'number') o.topP = a.topP;
  if (typeof a.maxTokens === 'number' && o.maxTokens === undefined) o.maxTokens = a.maxTokens;
  if (typeof a.repeatPenalty === 'number') o.repeatPenalty = a.repeatPenalty;
  if (require('./uiModeStore').useUiModeStore.getState().interfaceMode === 'audio') {
    o.maxTokens = Math.min(o.maxTokens ?? 96, 96);
  }
  return o;
}

/** Tools for the active agent, or null to use the global toggles. */
export function activeAgentTools(): string[] | null {
  const { activeAgentId, agents } = useAgentStore.getState();
  const a = agents.find((x) => x.id === activeAgentId);
  return a?.enabledTools ?? null;
}

function applyContextLength(ctx: number): void {
  // Lazy requires keep this store light and avoid appStore/service import cycles.
  try {
    const { useAppStore } = require('./appStore');
    const st = useAppStore.getState();
    const activeModel = st.downloadedModels?.find((m: any) => m.id === st.activeModelId);
    const isLiteRT = activeModel?.engine === 'litert';
    let safeCtx = Math.max(1024, ctx);

    if (isLiteRT) {
      // LiteRT owns a separate token budget. Let capable models use larger contexts;
      // ctxGuard will roll back automatically if this specific device/model cannot load it.
      if (st.modelMaxContext && st.modelMaxContext > 0) {
        safeCtx = Math.min(safeCtx, st.modelMaxContext);
      }
    } else {
      try {
        const { hardwareService } = require('../services/hardware');
        const { getMaxContextForDevice } = require('../utils/contextLimits');
        const ramGB = hardwareService.getTotalMemoryGB();
        const deviceCap = ramGB === 4 ? 8192 : getMaxContextForDevice(ramGB * 1024 ** 3);
        safeCtx = Math.min(safeCtx, deviceCap);
      } catch { /* use the requested value if hardware probing is unavailable */ }
      if (st.modelMaxContext && st.modelMaxContext > 0) {
        safeCtx = Math.min(safeCtx, st.modelMaxContext);
      }
    }

    const settingKey = isLiteRT ? 'liteRTMaxTokens' : 'contextLength';
    if (st.settings?.[settingKey] !== safeCtx) st.updateSettings({ [settingKey]: safeCtx });
  } catch { /* ignore */ }
}

