# Personas — Full Implementation Plan

> The goal: turn Off Grid from "a local LLM app" into "a private AI secretary you can actually trust." Personas are named assistants with personality, memory, skills, and integrations. The model picker disappears. The complexity hides. The magic stays.

---

## Current State (what we're building on)

| System | Current State | Notes |
|--------|--------------|-------|
| Projects | `id, name, description, systemPrompt, icon` | Lightweight — easy to extend |
| Conversations | `projectId?: string` linkage | Already scoped to projects |
| RAG / KB | Project-scoped via `ragService.searchProject(projectId)` | Fully reusable |
| Tool calls | Registry with 6 tools, projectId in context | Extend with integration tools |
| STT | `whisperService.ts` — realtime + file transcription | Working |
| TTS | Not yet implemented | Coming soon |
| Integrations | Separate branch (not yet merged) | Assume available soon |
| Navigation | HomeTab, ChatsTab, ProjectsTab, ModelsTab, SettingsTab | Will restructure |

---

## Data Models

### Persona (extends Project)

```typescript
// src/types/persona.ts

export type Capability =
  | 'text'          // text conversation
  | 'voice'         // STT + TTS
  | 'vision'        // image understanding
  | 'image-gen'     // image generation
  | 'rag'           // knowledge base search (user-uploaded documents)
  | 'memory-rag';   // cross-conversation RAG — past messages indexed and retrieved

export type SkillTriggerEvent =
  | 'message_received'    // new message in connected app
  | 'event_created'       // calendar event created
  | 'event_updated'
  | 'contact_mentioned'   // name appears in message
  | 'location_mentioned'
  | 'time_mentioned'
  | 'link_received';

export type IntegrationId =
  | 'calendar'
  | 'whatsapp'
  | 'slack'
  | 'email'
  | 'contacts'
  | 'reminders';

export interface SkillTrigger {
  integration: IntegrationId;
  event: SkillTriggerEvent;
  filters?: Record<string, string>;  // e.g. { from: 'boss@work.com' }
}

export interface SkillAction {
  integration: IntegrationId;
  operation: string;                 // e.g. 'create_event', 'draft_reply'
  requiresApproval: boolean;         // true = ask user before firing
  promptTemplate?: string;           // how to instruct the LLM to format the action
}

export interface Skill {
  id: string;
  name: string;                      // "Add WhatsApp events to Calendar"
  description: string;               // user-facing explanation
  trigger: SkillTrigger;
  action: SkillAction;
  isActive: boolean;
  lastFiredAt?: number;
}

export interface PersonaMemoryFact {
  id: string;
  content: string;                   // "Prefers morning meetings"
  source: 'user_stated' | 'inferred';
  createdAt: number;
  updatedAt: number;
}

export interface PersonaModelOverrides {
  text?: string;           // model id
  vision?: string;
  imageGen?: string;
  stt?: string;
  tts?: string;
  embedding?: string;
}

export interface PersonaVoice {
  interfaceMode: 'chat' | 'audio';   // 'chat' = text bubbles + play button; 'audio' = waveform bubbles by default
  ttsVoiceId: string;                // OuteTTS speaker profile id (e.g. '0')
  sttLanguage: string;               // 'en', 'es', etc.
  speakingRate: number;              // 0.5–2.0, default 1.0
}

export interface Persona {
  id: string;
  name: string;                      // "Jarvis", "Work Assistant"
  description: string;               // short user-facing description
  systemPrompt: string;              // personality + instructions
  icon: string;                      // hex color (existing) or Feather icon name
  accentColor: string;               // per-persona color (used in UI accents)

  // What this persona can do
  capabilities: Capability[];

  // What this persona knows
  knowledgeBaseIds: string[];        // attached RAG knowledge bases (user-uploaded documents)
  conversationMemoryEnabled: boolean; // true = all past conversations for this persona are embedded + searchable
  memoryFacts: PersonaMemoryFact[];  // persistent learned facts (LLM-extracted, concise)

  // What this persona does automatically
  skills: Skill[];

  // Connected data sources
  integrationIds: IntegrationId[];   // which integrations are active for this persona

  // How this persona communicates
  voice?: PersonaVoice;

  // Power user overrides
  modelOverrides?: PersonaModelOverrides;

  // Metadata
  isDefault: boolean;                // shipped defaults: editable, not deletable
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}
```

### Conversation (minor addition)

```typescript
// Add to existing Conversation type in src/types/index.ts
export interface Conversation {
  // ...existing fields...
  personaId?: string;        // replaces projectId eventually; keep both during migration
  activeCapability?: Capability;  // which capability is active in this session
}
```

### Integration (from integrations branch — extend as needed)

```typescript
// src/types/integration.ts

export interface Integration {
  id: IntegrationId;
  name: string;
  isConnected: boolean;
  connectedAt?: number;
  accountLabel?: string;   // "ali@work.com", "+1234567890"
  permissions: string[];   // what was granted
}
```

---

## Store

### personaStore.ts (new)

```typescript
// src/stores/personaStore.ts

interface PersonaStore {
  personas: Persona[];
  activePersonaId: string | null;

  // CRUD
  createPersona: (persona: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>) => Persona;
  updatePersona: (id: string, updates: Partial<Persona>) => void;
  deletePersona: (id: string) => void;
  duplicatePersona: (id: string) => Persona;
  getPersona: (id: string) => Persona | undefined;

  // Active persona
  setActivePersona: (id: string | null) => void;

  // Memory
  addMemoryFact: (personaId: string, fact: Omit<PersonaMemoryFact, 'id' | 'createdAt' | 'updatedAt'>) => void;
  removeMemoryFact: (personaId: string, factId: string) => void;
  updateMemoryFact: (personaId: string, factId: string, content: string) => void;

  // Skills
  addSkill: (personaId: string, skill: Omit<Skill, 'id'>) => void;
  updateSkill: (personaId: string, skillId: string, updates: Partial<Skill>) => void;
  removeSkill: (personaId: string, skillId: string) => void;
  toggleSkill: (personaId: string, skillId: string) => void;

  // Integrations
  attachIntegration: (personaId: string, integrationId: IntegrationId) => void;
  detachIntegration: (personaId: string, integrationId: IntegrationId) => void;
}
```

### integrationStore.ts (new or from integrations branch)

```typescript
// src/stores/integrationStore.ts

interface IntegrationStore {
  integrations: Integration[];
  connectIntegration: (id: IntegrationId) => Promise<void>;
  disconnectIntegration: (id: IntegrationId) => void;
  getIntegration: (id: IntegrationId) => Integration | undefined;
  isConnected: (id: IntegrationId) => boolean;
}
```

---

## Default Personas (seed on first launch)

```typescript
// src/constants/defaultPersonas.ts

export const DEFAULT_PERSONAS: Omit<Persona, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'default-jarvis',
    name: 'Jarvis',
    description: 'Your general-purpose assistant',
    systemPrompt: 'You are Jarvis, a capable and concise personal assistant. You help with anything — questions, tasks, planning, thinking. You are direct, warm, and never verbose unless asked.',
    icon: 'cpu',
    accentColor: '#6366F1',
    capabilities: ['text', 'voice', 'vision', 'memory-rag'],
    knowledgeBaseIds: [],
    conversationMemoryEnabled: true,  // Jarvis indexes all past conversations — gives it cross-chat intelligence
    memoryFacts: [],
    skills: [],
    integrationIds: [],
    isDefault: true,
  },
  {
    id: 'default-coder',
    name: 'Coder',
    description: 'Technical assistant for software work',
    systemPrompt: 'You are a senior software engineer. You write clean, correct code and explain technical concepts precisely. No fluff. You prefer showing code over describing it.',
    icon: 'code',
    accentColor: '#10B981',
    capabilities: ['text', 'rag'],
    knowledgeBaseIds: [],
    memoryFacts: [],
    skills: [],
    integrationIds: [],
    isDefault: true,
  },
  {
    id: 'default-creative',
    name: 'Creative',
    description: 'Writing, ideas, and image generation',
    systemPrompt: 'You are a creative collaborator. You help with writing, brainstorming, and visual ideas. You are imaginative, playful, and inspiring.',
    icon: 'feather',
    accentColor: '#F59E0B',
    capabilities: ['text', 'image-gen', 'voice'],
    knowledgeBaseIds: [],
    memoryFacts: [],
    skills: [],
    integrationIds: [],
    isDefault: true,
  },
  {
    id: 'default-research',
    name: 'Research',
    description: 'Deep analysis and document search',
    systemPrompt: 'You are a research analyst. You are thorough, precise, and cite your sources. When searching knowledge bases, you synthesize across multiple documents before answering.',
    icon: 'book-open',
    accentColor: '#3B82F6',
    capabilities: ['text', 'rag', 'vision'],
    knowledgeBaseIds: [],
    memoryFacts: [],
    skills: [],
    integrationIds: [],
    isDefault: true,
  },
];
```

---

## Auto Model Resolution

```typescript
// src/services/personaModelResolver.ts

/**
 * Given a persona and a capability, returns the best available model.
 * Checks overrides first, then falls back to best downloaded model for device RAM.
 */
export async function resolveModelForCapability(
  persona: Persona,
  capability: Capability,
  downloadedModels: DownloadedModel[],
  deviceRamGB: number,
): Promise<ResolvedModel | null> {
  // 1. Check persona override
  const overrideId = persona.modelOverrides?.[capability];
  if (overrideId) {
    const m = downloadedModels.find(m => m.id === overrideId);
    if (m) return { model: m, source: 'override' };
  }

  // 2. Filter by capability type
  const candidates = downloadedModels.filter(m => modelSupportsCapability(m, capability));

  // 3. Filter by RAM fit (model should use < 60% of device RAM)
  const fitting = candidates.filter(m => estimatedRamGB(m) < deviceRamGB * 0.6);

  // 4. Score: prefer larger (more capable) models that still fit
  const scored = fitting.sort((a, b) => scoreModel(b, deviceRamGB) - scoreModel(a, deviceRamGB));

  return scored[0] ? { model: scored[0], source: 'auto' } : null;
}

/**
 * Returns the download recommendation if no model available for a capability.
 */
export function getCapabilityDownloadRecommendation(
  capability: Capability,
  deviceRamGB: number,
): RecommendedDownload | null { ... }
```

---

## Services

### skillsEngine.ts (new — ambient background processor)

```typescript
// src/services/skillsEngine.ts

/**
 * The skills engine runs in the background, listening to integration events.
 * When a trigger fires, it runs the associated LLM action and either
 * auto-executes or queues for user approval.
 */
class SkillsEngine {
  private subscriptions: Map<string, () => void> = new Map();

  // Called on app launch and when personas/skills change
  async start(personas: Persona[]): Promise<void> {
    this.stop(); // clear old subscriptions
    for (const persona of personas) {
      for (const skill of persona.skills.filter(s => s.isActive)) {
        this.registerSkill(persona, skill);
      }
    }
  }

  stop(): void {
    this.subscriptions.forEach(unsub => unsub());
    this.subscriptions.clear();
  }

  private registerSkill(persona: Persona, skill: Skill): void {
    const unsub = integrationEventBus.on(
      skill.trigger.integration,
      skill.trigger.event,
      async (event) => {
        if (!this.matchesFilter(event, skill.trigger.filters)) return;
        await this.executeSkill(persona, skill, event);
      }
    );
    this.subscriptions.set(`${persona.id}:${skill.id}`, unsub);
  }

  private async executeSkill(persona: Persona, skill: Skill, event: IntegrationEvent): Promise<void> {
    // Use LLM to interpret the event and format the action
    const actionPayload = await this.interpretEvent(persona, skill, event);

    if (skill.action.requiresApproval) {
      // Queue a notification/approval card in the app
      skillApprovalQueue.push({ persona, skill, event, actionPayload });
    } else {
      // Execute immediately
      await integrationService.execute(skill.action.integration, skill.action.operation, actionPayload);
      skillHistoryStore.record({ persona, skill, event, actionPayload, status: 'executed' });
    }
  }

  private async interpretEvent(persona: Persona, skill: Skill, event: IntegrationEvent): Promise<any> {
    // Run a lightweight LLM call with the skill's promptTemplate + event data
    // Returns structured action payload (e.g. calendar event fields)
  }
}

export const skillsEngine = new SkillsEngine();
```

### personaMemoryService.ts (new)

```typescript
// src/services/personaMemoryService.ts

/**
 * Extracts memory-worthy facts from conversations and stores them on the persona.
 * Runs after each conversation turn.
 */
export async function extractMemoryFacts(
  personaId: string,
  recentMessages: Message[],
): Promise<PersonaMemoryFact[]> {
  // Lightweight LLM call: "Does this conversation reveal any persistent facts about
  // the user's preferences, schedule, relationships, or habits? Return JSON array."
  // Only runs if last N messages contain user statements (not questions).
}

/**
 * Builds the memory context string injected into the system prompt.
 */
export function buildMemoryContext(facts: PersonaMemoryFact[]): string {
  if (facts.length === 0) return '';
  return `\n\nWhat you know about the user:\n${facts.map(f => `- ${f.content}`).join('\n')}`;
}
```

### conversationRagService.ts (new — cross-conversation memory)

This is what makes Jarvis actually intelligent across sessions. Rather than relying only on extracted `memoryFacts` (brief summaries) or the current context window, Jarvis embeds every conversation message into a per-persona vector store. When a new message arrives, relevant past exchanges are retrieved and injected as context — so Jarvis remembers "we discussed your onboarding last Tuesday" without you having to repeat it.

**How it's different from document KB:**

| | Document KB (`knowledgeBaseIds`) | Conversation RAG (`conversationMemoryEnabled`) |
|---|---|---|
| Source | User-uploaded PDFs, notes | Past conversation messages |
| Indexed when | User uploads a file | After each assistant response |
| Retrieved by | User explicitly asking about docs | Automatically on every message |
| Scoped to | Attached knowledge bases | All conversations for this persona |

```typescript
// src/services/conversationRagService.ts

/**
 * Indexes completed conversation messages into the persona's vector store.
 * Called after each assistant turn completes (streaming done).
 *
 * Each chunk stored = ~4–6 messages grouped by semantic coherence, not
 * arbitrary token windows. This preserves conversational context.
 */
export async function indexConversationTurn(
  personaId: string,
  conversationId: string,
  messages: Message[],   // recent messages to embed (typically last 4–6)
): Promise<void> {
  const chunks = chunkMessagesForEmbedding(messages);
  for (const chunk of chunks) {
    const embedding = await embeddingService.embed(chunk.text);
    await vectorStore.upsert({
      id: `${conversationId}:${chunk.startIndex}`,
      embedding,
      metadata: {
        personaId,
        conversationId,
        timestamp: chunk.timestamp,
        preview: chunk.text.slice(0, 120),
      },
    });
  }
}

/**
 * Retrieves the most relevant past conversation context for the current message.
 * Returns plain text ready to inject into the system prompt.
 */
export async function retrieveRelevantHistory(
  personaId: string,
  currentMessage: string,
  topK = 3,
): Promise<string> {
  const queryEmbedding = await embeddingService.embed(currentMessage);
  const results = await vectorStore.search({
    embedding: queryEmbedding,
    filter: { personaId },
    topK,
    minScore: 0.72,   // only inject if meaningfully relevant
  });

  if (results.length === 0) return '';

  const snippets = results.map(r =>
    `[${formatRelativeDate(r.metadata.timestamp)}]\n${r.metadata.preview}`
  );
  return `\n\nRelevant context from past conversations:\n${snippets.join('\n\n---\n\n')}`;
}

/**
 * Groups messages into semantically coherent chunks for embedding.
 * Avoids splitting a user question from its assistant answer.
 */
function chunkMessagesForEmbedding(messages: Message[]): EmbeddingChunk[] {
  // Pair each user message with its following assistant response
  // Output: chunks of ~300–400 tokens each
}
```

**System prompt injection** (in `llm.ts` or wherever the prompt is assembled):

```typescript
// When conversationMemoryEnabled is true for the active persona:
if (persona.conversationMemoryEnabled) {
  const history = await conversationRagService.retrieveRelevantHistory(
    persona.id,
    latestUserMessage,
  );
  systemPrompt += history;
}
```

**Indexing trigger** (after streaming completes, in chatStore or the streaming callback):

```typescript
// After assistant response is done streaming:
if (persona.conversationMemoryEnabled) {
  conversationRagService.indexConversationTurn(
    persona.id,
    conversationId,
    recentMessages.slice(-6),
  ).catch(() => {});  // fire-and-forget, non-blocking
}
```

**Storage:** Uses the existing `ragService` vector store, namespaced by `personaId`. No new storage layer needed — just a new indexing source.

---

## Screens

### Screen 1: PersonasHomeScreen (replaces ProjectsTab)

**Route:** `PersonasTab` (bottom tab, replaces ProjectsTab)

**Layout:**
```
┌─────────────────────────────────────┐
│ Your Assistants              [+ New]│
│─────────────────────────────────────│
│ ┌─────────────────────────────────┐ │
│ │ ● Jarvis                    [⋯] │ │  ← accentColor dot, overflow menu
│ │   Your general-purpose assistant│ │
│ │   ◎ text  ◎ voice  ◎ vision    │ │  ← active capability pills
│ │   "What's on my schedule?"  →  │ │  ← last message preview
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ● Coder                     [⋯]│ │
│ │   ...                           │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [skill approval cards if any]       │  ← ambient skill results needing approval
└─────────────────────────────────────┘
```

**Interactions:**
- Tap card → PersonaChatScreen
- `[⋯]` overflow → Edit / Duplicate / Delete (defaults: Edit only)
- `[+ New]` → PersonaEditScreen (create mode)
- Sorted by `lastUsedAt` desc
- Skill approval cards shown above list when skills are queued

**Component:** `PersonaCard`
- Accent color dot
- Name (BODY, 14px)
- Description (DESCRIPTION, 13px, muted)
- Capability pills (META, 10px) — only enabled capabilities shown
- Last message preview (META, truncated to 1 line)

---

### Screen 2: PersonaChatScreen (extends ChatScreen)

**Route:** `Chat` with `personaId` param (in addition to existing `conversationId`, `projectId`)

**Changes to existing ChatScreen:**

**Header:**
```
← [●] Jarvis                      [⚙]
```
- Accent dot replaces model icon
- Persona name replaces model name
- Tap name → PersonaDetailSheet (quick view of memory, skills, integrations)
- `[⚙]` → PersonaEditScreen

**Capability Bar** (below header, above messages):
```
[◎ Chat] [◎ Voice] [◎ Vision] [◎ Image]
```
- Only shows capabilities enabled for this persona
- Active capability highlighted with accent color
- Tapping a capability without a downloaded model → CapabilityDownloadPrompt sheet
- Capability bar hidden when only `text` is enabled (no need to show one option)

**Message rendering — mode-branched:**
- `voice.interfaceMode === 'audio'` → assistant messages render as `AudioMessageBubble` (waveform + scrubber + speed chip + Show transcript). TTS is generated automatically after each streaming response completes and saved to `audio-cache/{conversationId}/{messageId}.wav`.
- `voice.interfaceMode === 'chat'` → standard text bubbles with a `TTSButton` play/stop icon on each assistant message. Audio generated on demand, discarded after playback.
- User messages (Whisper STT) render as waveform bubbles in both modes — transcript shown as secondary.

**Input Area:**
- Voice capability enabled → mic button replaces/joins send button
- Image gen capability → image prompt indicator in input area
- Vision capability → camera/attachment button always visible

**Memory Bar** (above input, shown contextually):
```
Jarvis remembered: "Prefers morning meetings"  [×]
```
- Shown when memory extraction detects a new fact
- User can dismiss or edit the fact

**Conversation scoping:**
- New conversations created with `personaId` set
- System prompt = `persona.systemPrompt + buildMemoryContext(persona.memoryFacts)`
- RAG search uses `persona.knowledgeBaseIds` (can be multiple)
- Tool context includes `personaId` and `integrationIds`

---

### Screen 3: PersonaEditScreen (create + edit)

**Route:** `PersonaEdit` with optional `personaId` param

**Sections (scrollable form):**

#### Identity
```
[Avatar picker]  Name: [_______________]
                 Accent: [● ● ● ● ●]
```
- Avatar: grid of Feather icons (8×5), searchable
- Accent: 8 preset colors + custom color picker
- Name: required, max 32 chars

#### Description
```
Short description (shown on persona card)
[___________________________________________]
```

#### Personality
```
How should this assistant behave?
[___________________________________________]
[                                           ]
[                                           ]  ← multi-line, expandable
```
Placeholder: "You are [name], a ..."

#### Capabilities
Toggle cards, each with an icon, label, and inline download CTA if model missing:

```
┌────────────────────────────────────────┐
│ [💬] Text Conversation          [ON]   │
│      Chat, answer questions, write     │
├────────────────────────────────────────┤
│ [🎤] Voice                      [ON]   │
│      Speak and listen                  │
│      Using: Whisper Tiny (75MB)        │
├────────────────────────────────────────┤
│ [👁] Vision                     [OFF]  │
│      Understand images & documents     │
│      Requires vision model    [Get →]  │
├────────────────────────────────────────┤
│ [🎨] Image Generation           [OFF]  │
│      Create images from descriptions   │
│      Requires image model     [Get →]  │
├────────────────────────────────────────┤
│ [📚] Knowledge Base             [OFF]  │
│      Search your documents             │
└────────────────────────────────────────┘
```

#### Voice Settings (shown when Voice is ON)
- Interface Mode: segmented control — `Chat` (text bubbles + play button) / `Audio` (waveform bubbles, always-on)
  - If device RAM < 6GB: Audio option greyed out with "Requires 6GB+ RAM"
- Voice: picker from available OuteTTS speaker profiles
- Speaking rate: slider 0.5–2.0x
- Speaking language: picker (STT language for Whisper)

#### Knowledge Bases (shown when KB is ON)
```
Attached knowledge bases:
  [📁] Work Docs                  [×]
  [📁] Meeting Notes              [×]
  [+ Attach knowledge base]
  [+ Create new knowledge base]
```

#### Integrations
```
Connected data sources:
  [📅] Calendar                  [✓ Connected]  [×]
  [💬] WhatsApp                  [Connect →]
  [📧] Email                     [Connect →]
  [💼] Slack                     [Connect →]
```

#### Skills (shown when at least one integration is connected)
```
Ambient skills:
  [⚡] WhatsApp → Calendar        [ON]  [>]
       Adds events from WhatsApp to Calendar
  [+ Add skill]
```
Tapping a skill → SkillEditSheet

#### Advanced (collapsed)
- Model overrides per capability (power user)
- Temperature, context length, etc.

**Footer:** `[Save]` / `[Delete Persona]` (delete hidden for defaults)

---

### Screen 4: SkillEditSheet (bottom sheet)

**Shown:** When tapping a skill or adding a new one in PersonaEditScreen

**Layout:**
```
┌─────────────────────────────────────┐
│ Skill: WhatsApp → Calendar          │
│─────────────────────────────────────│
│ TRIGGER                             │
│ When:   [WhatsApp ▼]                │
│ Event:  [Message received ▼]        │
│ Filter: [from contact... optional]  │
│─────────────────────────────────────│
│ ACTION                              │
│ Do:     [Create calendar event ▼]   │
│ Using:  [Calendar ▼]                │
│─────────────────────────────────────│
│ Ask me before doing this?  [YES/NO] │
│─────────────────────────────────────│
│ [Save Skill]      [Delete Skill]    │
└─────────────────────────────────────┘
```

---

### Screen 5: SkillApprovalCard (inline in PersonasHome + notifications)

When a skill fires with `requiresApproval: true`:

```
┌─────────────────────────────────────┐
│ ⚡ Jarvis wants to add an event     │
│─────────────────────────────────────│
│ "Team lunch on Friday at noon"      │
│  detected in WhatsApp               │
│─────────────────────────────────────│
│ Adding to Calendar:                 │
│  Title: Team Lunch                  │
│  Date:  Friday, Apr 11              │
│  Time:  12:00 PM                    │
│─────────────────────────────────────│
│ [Edit]   [Dismiss]   [✓ Add Event] │
└─────────────────────────────────────┘
```

---

### Screen 6: PersonaMemoryScreen

**Route:** `PersonaMemory` with `personaId` param  
**Access:** From PersonaDetailSheet or PersonaEditScreen

**Layout:**
```
┌─────────────────────────────────────┐
│ ← Jarvis's Memory                   │
│─────────────────────────────────────│
│ What Jarvis knows about you:        │
│                                     │
│  · Prefers morning meetings         [×]
│  · Based in London                  [×]
│  · Uses TypeScript for work         [×]
│                                     │
│  [+ Add fact manually]              │
│─────────────────────────────────────│
│ [Clear all memory]                  │
└─────────────────────────────────────┘
```

Facts are editable inline. Clear all → confirmation dialog.

---

### Screen 7: Updated Onboarding

**Replaces:** Current model download gate

**Step 1 — Welcome:**
```
Meet your assistants.
Private. Offline. Yours.

[→ Get started]
```

**Step 2 — Persona Carousel:**
Horizontal scroll through default 4 personas. Each card shows:
- Name + avatar
- Description
- Capability pills
- "Tap to activate"

**Step 3 — Activate:**
User taps a persona → background model download starts (non-blocking).
```
Setting up Jarvis...
[████████░░░░░░] 45%
Downloading base model

You can start chatting while this finishes.
[Start chatting →]
```

**Step 4 — Chat:**
Lands in PersonaChatScreen with that persona. Model loads in background. Input field available immediately with a "loading..." indicator until model ready.

---

## Navigation Changes

### New Tab Structure

```
Bottom Tabs:
  [Assistants]  [Chats]  [Explore]  [Settings]
```

- **Assistants** → PersonasHomeScreen (replaces Projects tab)
- **Chats** → ChatsListScreen (all conversations across all personas, with persona label)
- **Explore** → ModelsScreen (unchanged, for enthusiasts)
- **Settings** → SettingsScreen (unchanged)

### New Routes (add to AppNavigator)

```typescript
// Add to existing stack:
PersonaEdit: { personaId?: string }
PersonaMemory: { personaId: string }
PersonaConversations: { personaId: string }
IntegrationConnect: { integrationId: IntegrationId }
SkillHistory: { personaId: string }
```

---

## Tool System Extensions

### New integration tools (added to registry)

```typescript
// When calendar integration connected:
'get_calendar_events' — list events for a date range
'create_calendar_event' — create an event
'update_calendar_event' — modify existing event

// When contacts connected:
'search_contacts' — find a person by name/number

// When reminders connected:
'create_reminder' — set a reminder
'list_reminders' — get pending reminders

// When Slack connected:
'read_slack_messages' — recent messages from a channel
'send_slack_message' — send a message

// When email connected:
'list_emails' — recent emails with filters
'draft_email' — create a draft
```

These are all reactive (user-initiated via chat). Skills are the proactive counterpart.

### Tool context extension

```typescript
// Extend existing tool context to include persona
interface ToolContext {
  projectId?: string;      // keep for backward compat
  personaId?: string;      // new
  integrationIds?: IntegrationId[];  // which integrations are active
}
```

---

## Migration Plan (Projects → Personas)

Projects already exist. Users may have existing projects. Migration must be non-breaking.

```typescript
// src/migrations/projectsToPersonas.ts

export async function migrateProjectsToPersonas(): Promise<void> {
  const projects = projectStore.getState().projects;
  const existingPersonas = personaStore.getState().personas;

  // Don't re-migrate
  if (existingPersonas.length > 0) return;

  // Seed defaults first
  seedDefaultPersonas();

  // Convert existing user projects to personas
  for (const project of projects) {
    if (DEFAULT_PROJECT_IDS.includes(project.id)) continue; // skip defaults

    personaStore.getState().createPersona({
      name: project.name,
      description: project.description,
      systemPrompt: project.systemPrompt,
      icon: project.icon ?? 'user',
      accentColor: '#6366F1',
      capabilities: ['text'],        // conservative default
      knowledgeBaseIds: [project.id], // existing KB maps directly
      memoryFacts: [],
      skills: [],
      integrationIds: [],
      isDefault: false,
    });
  }

  // Migrate conversation projectId → personaId
  // (conversations that reference old project IDs still work via projectId field)
}
```

---

## TTS Integration

TTS plugs into the `voice` capability via `ttsService` and `ttsStore`. See `docs/TTS_IMPLEMENTATION_PLAN.md` for full service/store implementation.

### How persona voice settings wire into TTS

When a conversation loads, resolve the persona's voice settings and pass them through:

```typescript
const { voice } = persona;

// Chat Mode: generate on demand, play, discard
ttsStore.getState().speak(text, messageId);
// uses voice.ttsVoiceId and voice.speakingRate from ttsStore.settings

// Audio Mode: generate after streaming completes, save to disk
const { path, waveformData, durationSeconds } = await ttsStore.getState().generateAndSave(
  stripControlTokens(lastMessage.content),
  conversationId,
  lastMessage.id,
);
// saves to audio-cache/{conversationId}/{messageId}.wav
// update message record with audioPath, waveformData, audioDurationSeconds
```

### Per-persona voice settings → ttsStore sync

When a persona is activated (user opens chat), sync its voice settings into `ttsStore`:

```typescript
// src/hooks/usePersonaVoiceSync.ts

export function usePersonaVoiceSync(persona: Persona) {
  const updateSettings = useTTSStore(s => s.updateSettings);

  useEffect(() => {
    if (!persona.voice) return;
    updateSettings({
      interfaceMode: persona.voice.interfaceMode,
      voiceId: persona.voice.ttsVoiceId,
      speed: persona.voice.speakingRate,
    });
  }, [persona.id]);
}
```

This means each persona carries its own interface mode, voice, and speed — switching personas instantly reconfigures the TTS experience.

### Message model additions (required for Audio Mode)

Add to the `Message` type:

```typescript
export interface Message {
  // ...existing fields...
  audioPath?: string;              // path to WAV on disk (Audio Mode only)
  waveformData?: number[];         // 200-point amplitude envelope for waveform bar
  audioDurationSeconds?: number;   // total audio duration
  isGeneratingAudio?: boolean;     // true while TTS is running for this message
}
```

---

## Implementation Order

### Phase 1 — Foundation (no UI changes yet)
1. Add `Persona` type to `src/types/persona.ts`
2. Create `personaStore.ts` with CRUD + memory actions
3. Create `src/constants/defaultPersonas.ts`
4. Create `personaModelResolver.ts` (capability → best model)
5. Run migration: seed defaults + convert existing projects on store init
6. Extend `Conversation` type with `personaId` + `activeCapability`
7. Extend tool context with `personaId` and `integrationIds`

### Phase 2 — Core Screens
8. `PersonasHomeScreen` — persona cards list
9. `PersonaCard` component
10. `PersonaEditScreen` — identity + capabilities + KB sections
11. Wire persona creation/edit/delete
12. Update `ChatScreen` — persona header, scope system prompt, multi-KB RAG

### Phase 3 — Capability Bar + Voice
13. `CapabilityBar` component in chat
14. `CapabilityDownloadPrompt` sheet
15. Wire capability switching (text ↔ image gen ↔ vision)
16. TTS integration — requires TTS_IMPLEMENTATION_PLAN to be executed first, then:
    - Add `usePersonaVoiceSync` hook to sync persona voice settings into `ttsStore` on persona activation
    - Chat Mode: add `TTSButton` to text bubble action row
    - Audio Mode: render `AudioMessageBubble` for assistant messages; trigger `generateAndSave` after streaming completes
    - Add `audioPath`, `waveformData`, `audioDurationSeconds`, `isGeneratingAudio` to `Message` type

### Phase 4 — Memory
17. `personaMemoryService.ts` — fact extraction after conversations
18. Memory injection into system prompt
19. `PersonaMemoryScreen`
20. Memory bar in chat (new fact notification)
21. `conversationRagService.ts` — cross-conversation RAG for `memory-rag` capability
    - Index each conversation turn after streaming completes (fire-and-forget)
    - Retrieve relevant history and inject into system prompt before each LLM call
    - Jarvis has `conversationMemoryEnabled: true` by default; other personas opt in via PersonaEditScreen
    - Reuses existing `ragService` vector store, namespaced by `personaId`

### Phase 5 — Integrations in Chat (tool calls)
21. Wire integration tool registry entries
22. Connect integration permissions to tool availability
23. Integration tools fire based on `integrationIds` in tool context

### Phase 6 — Skills (ambient)
24. `integrationEventBus.ts` — pub/sub for integration events
25. `skillsEngine.ts` — register skill listeners on app launch
26. `SkillApprovalCard` component
27. `SkillEditSheet` bottom sheet
28. Skill history / audit log

### Phase 7 — Onboarding + Navigation
29. Updated onboarding flow (persona carousel)
30. Background model download during onboarding
31. Navigation restructure — add Assistants tab, retire Projects tab
32. `PersonaConversations` screen (per-persona history)

### Phase 8 — Polish
33. `SkillHistoryScreen`
34. Accent color theming per persona in chat
35. Power user model overrides in PersonaEditScreen advanced section
36. Persona duplication flow
37. Export/import persona (JSON)

---

## What Changes, What Doesn't

| Thing | Status | Notes |
|-------|--------|-------|
| `Project` type | Keep | Backward compat during migration |
| `projectStore` | Keep | Used by existing KBs and conversations |
| `chatStore` | Minor change | Add `personaId` to `createConversation` |
| `ragService` | Unchanged | Already project-scoped; persona uses `knowledgeBaseIds` |
| `ChatScreen` | Extended | Add capability bar, persona header, multi-KB |
| `ProjectsScreen` | Replaced | Becomes `PersonasHomeScreen` |
| `ProjectEditScreen` | Replaced | Becomes `PersonaEditScreen` |
| `KnowledgeBaseScreen` | Unchanged | Accessed from PersonaEditScreen |
| Tool registry | Extended | New integration tools added |
| Onboarding | Replaced | Persona carousel replaces model download gate |
| Models tab | Unchanged | Still exists for enthusiasts |
| Settings | Minor | Add persona-level settings access |

---

**Last Updated:** April 2026
