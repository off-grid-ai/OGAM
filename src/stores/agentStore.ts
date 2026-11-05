import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../utils/generateId';
import { COUNSELOR_PROMPT } from './counselorPrompt';

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
  createdAt: string;
  updatedAt: string;
}

const now = () => new Date().toISOString();

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
6. Keep answers short. Do not think out loud at length.`,
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
6. Keep it short. Put any danger warning first.`,
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
    enabledTools: ['list_files', 'read_file', 'write_file', 'create_web_page', 'open_file', 'calendar_events', 'add_calendar_event', 'remember', 'my_location', 'calculator', 'study_math', 'study_helpers', 'get_current_datetime', 'search_knowledge_base'],
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
    id: 'companion',
    name: 'Talk',
    description: 'Someone to talk things through with, privately and offline',
    systemPrompt: `You are a warm, honest conversation partner running entirely on the user's own device. Nothing they say leaves the phone.
- Listen, reflect back what you hear, and ask good follow-up questions.
- Be genuine: you can disagree kindly and give your honest view when asked.
- Help them think things through rather than lecturing.
- If they describe a crisis or danger to themselves, stay with them, take it seriously, and encourage reaching a trusted person or emergency services.`,
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
    enabledTools: ['remember', 'search_knowledge_base', 'search_offline_library'],
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
    name: 'Friend',
    description: 'Casual, natural conversation and friendly company',
    systemPrompt: `You are a casual, supportive conversational companion. Speak naturally like a good friend, with personality and humor when appropriate. Remember the context of the conversation and ask genuine questions, but do not interrogate. Avoid lengthy advice unless asked. Be respectful of boundaries, truthful about being an AI, and encourage the user's real-world relationships and independence.`,
    temperature: 0.85,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'jock-boyfriend',
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
          try { require('../atlasTools/models').switchToModelInBackground(agent.modelId); } catch { /* ignore */ }
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
          // Older Field ID prompts allowed an EDIBLE verdict from a photo; replace them.
          if (a.id === 'field-id' && (a.systemPrompt.includes('NEVER say a wild plant') ||
              a.systemPrompt.includes('EDIBLE, POISONOUS, or NOT SURE'))) a.systemPrompt = fid.systemPrompt;
          // The shipped Jake prompt once had a personal name written in; use the "Your name" setting instead.
          if (a.id === 'jock-boyfriend' && promptHash(a.systemPrompt) === OLD_PERSONAL_JAKE_HASH) {
            a.systemPrompt = DEFAULT_AGENTS.find(d => d.id === 'jock-boyfriend')!.systemPrompt;
          }
          if (a.id === 'counselor' && a.systemPrompt.startsWith('You are a warm, skilled counselor having a private conversation')) { a.systemPrompt = COUNSELOR_PROMPT; if (!a.contextLength) a.contextLength = 8192; }
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

/** The system prompt for a chat: the active agent's, plus project notes underneath. */
export function resolveAgentPrompt(projectPrompt: string | undefined, fallback: string): string {
  const { activeAgentId, agents } = useAgentStore.getState();
  const agent = agents.find((a) => a.id === activeAgentId);
  const lp = lowPowerNote();
  const phoneMode = require('./uiModeStore').useUiModeStore.getState().interfaceMode === 'audio';
  const phoneNote = phoneMode ? '\n\nPHONE CALL MODE: Speak like a natural telephone conversation. Answer in one or two short spoken sentences, usually under 35 words. No lists, markdown, headings, long introductions, or extended explanations unless urgently required for safety or explicitly requested. Ask one brief question if appropriate.' : '';
  // Respect per-project creative preferences, including imported/older projects
  // where missing flags default to off. Explicit user requests take precedence.
  const chatState = require('./chatStore').useChatStore.getState();
  const currentChat = chatState.conversations.find((c: any) => c.id === chatState.activeConversationId);
  const currentProject = currentChat?.projectId ? require('./projectStore').useProjectStore.getState().getProject(currentChat.projectId) : undefined;
  const learningEnabled = currentProject?.allowLearningActivities !== false;
  const projectPreferences = currentProject && !learningEnabled
    ? 'Do not proactively suggest or generate project-based learning games, quizzes, or podcasts. Only create them if the user explicitly asks. Standalone offline arcade games are unrelated to project content.'
    : '';
  const projectGuard = projectPreferences ? `\n\nPROJECT FEATURE PREFERENCES: ${  projectPreferences}` : '';
  // Settings > Appearance & AI style applies to every agent and project. It comes before
  // the phone-call note so call mode can still keep spoken answers short.
  let style = '';
  try { style = require('../services/aiStyle').aiStyleNote(require('./appStore').useAppStore.getState().settings?.aiStyle); } catch { /* no settings yet */ }
  if (!agent || !agent.systemPrompt.trim()) return (projectPrompt?.trim() || fallback) + lp + style + phoneNote + projectGuard;
  return agentPromptWithLessons(agent) + (projectPrompt?.trim() ? `\n\nProject notes:\n${projectPrompt.trim()}` : '') + lp + style + phoneNote + projectGuard;
}

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
  try {
    const lp = require('../atlasTools/lowPower');
    if (lp.lowPowerActive()) {
      const cap = lp.useLowPower.getState().maxTokens;
      const base = (a && typeof a.maxTokens === 'number') ? a.maxTokens : cap;
      o.maxTokens = Math.min(base, cap);
    }
  } catch { /* ignore */ }
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

function lowPowerNote(): string {
  try {
    const lp = require('../atlasTools/lowPower');
    return lp.lowPowerActive() ? `\n\n${lp.LOW_POWER_NOTE}` : '';
  } catch { return ''; }
}
