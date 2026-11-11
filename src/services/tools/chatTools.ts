/**
 * Which tools a chat uses. One place decides it, for both what the chat shows and what a turn
 * sends: the chat's own choice if it has one, else its agent's default tools, else the app-wide
 * defaults from Settings -> Tools. Turning a tool on or off inside a chat changes only that chat.
 */
import { useAppStore, STUDY_TOOL_IDS } from '../../stores/appStore';
import { useAgentStore } from '../../stores/agentStore';
import { useChatStore } from '../../stores/chatStore';

type ChatLike = { enabledTools?: string[]; agentId?: string | null; projectId?: string | null } | null | undefined;

/**
 * Tools that only make sense inside a project: the maths, science and study helpers, and the ones that read and
 * update the project's own documents. A project chat always has them (nothing to switch on); a regular chat never
 * sends them, so it has fewer tools to read and one less thing to configure.
 */
export const PROJECT_TOOL_IDS = [...STUDY_TOOL_IDS, 'search_knowledge_base', 'update_project_document'];

/**
 * Permissions in a few switches instead of one per tool. Atlas only sends the model the tools a message could use
 * (relevantTools.ts), so turning a whole group on does not slow replies down.
 */
export const TOOL_GROUPS: Array<{ id: string; label: string; hint: string; tools: string[] }> = [
  { id: 'facts', label: 'Check facts and the web', hint: 'Search the web, open links, know the date and time, use the calculator', tools: ['web_search', 'read_url', 'get_current_datetime', 'calculator'] },
  { id: 'calendar', label: 'Calendar', hint: 'Read your events, and add one (asks first)', tools: ['calendar_events', 'add_calendar_event'] },
  { id: 'files', label: 'Files', hint: 'List, read, write and open files, build web pages (asks before writing)', tools: ['list_files', 'read_file', 'write_file', 'create_web_page', 'open_file'] },
  { id: 'memory', label: 'Memory', hint: 'Remember things about you', tools: ['remember'] },
  { id: 'phone', label: 'Phone', hint: 'Location, battery and storage, drafting texts and emails, reminders', tools: ['my_location', 'get_device_info', 'draft_message', 'schedule_task'] },
];

/** Whether every tool of a group is on. */
export const groupIsOn = (tools: string[], enabled: string[]): boolean => tools.every((t) => enabled.includes(t));

/** The tool list with a whole group turned on or off. */
export function withGroup(enabled: string[], tools: string[], on: boolean): string[] {
  return on ? [...enabled, ...tools.filter((t) => !enabled.includes(t))] : enabled.filter((t) => !tools.includes(t));
}

/** Project chats get the project tools; other chats never do. */
export function applyProjectScope(tools: string[], inProject: boolean): string[] {
  if (inProject) return [...tools, ...PROJECT_TOOL_IDS.filter((t) => !tools.includes(t))];
  return tools.filter((t) => !PROJECT_TOOL_IDS.includes(t));
}

/** Where a chat's tools come from, for the label on the tools screen. */
export function toolSourceFor(conv: ChatLike): 'chat' | 'agent' | 'app' {
  if (Array.isArray(conv?.enabledTools)) return 'chat';
  const agent = conv?.agentId ? useAgentStore.getState().agents.find((a) => a.id === conv.agentId) : null;
  return Array.isArray(agent?.enabledTools) ? 'agent' : 'app';
}

/** `appDefaults` lets a caller that already holds the settings pass them in. */
export function toolsForConversation(conv: ChatLike, appDefaults?: string[]): string[] {
  return applyProjectScope(chosenTools(conv, appDefaults), !!conv?.projectId);
}

function chosenTools(conv: ChatLike, appDefaults?: string[]): string[] {
  if (Array.isArray(conv?.enabledTools)) return conv!.enabledTools!;
  const agent = conv?.agentId ? useAgentStore.getState().agents.find((a) => a.id === conv.agentId) : null;
  if (Array.isArray(agent?.enabledTools)) return agent!.enabledTools!;
  return appDefaults ?? useAppStore.getState().settings.enabledTools ?? [];
}

const conversation = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id);

/** Turns one tool on or off for this chat only (other chats keep theirs). */
export function toggleChatTool(conversationId: string, toolId: string): void {
  const cur = toolsForConversation(conversation(conversationId));
  const next = cur.includes(toolId) ? cur.filter((t) => t !== toolId) : [...cur, toolId];
  useChatStore.getState().setConversationTools(conversationId, next);
}

/** Turns a whole group of tools on or off for this chat only. */
export function setChatToolGroup(conversationId: string, tools: string[], on: boolean): void {
  useChatStore.getState().setConversationTools(conversationId, withGroup(toolsForConversation(conversation(conversationId)), tools, on));
}

/** Back to the agent's (or the app's) default tools. */
export function resetChatTools(conversationId: string): void {
  useChatStore.getState().setConversationTools(conversationId, null);
}
