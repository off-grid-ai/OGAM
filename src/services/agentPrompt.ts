/**
 * The system prompt a chat really runs with: the active agent's prompt plus everything layered on
 * it (project notes, low-battery note, AI style, About you, phone-call mode, project-file rules).
 * A service on purpose: it reads half the stores, so it cannot live inside one of them.
 */
import { useAgentStore, agentPromptWithLessons } from '../stores/agentStore';
import { lowPowerActive, LOW_POWER_NOTE } from '../atlasTools/lowPowerState';

function lowPowerNote(): string {
  return lowPowerActive() ? `\n\n${LOW_POWER_NOTE}` : '';
}

/** The system prompt for a chat: the active agent's, plus project notes underneath. */
export function resolveAgentPrompt(projectPrompt: string | undefined, fallback: string): string {
  const { activeAgentId, agents } = useAgentStore.getState();
  const agent = agents.find((a) => a.id === activeAgentId);
  const lp = lowPowerNote();
  const phoneMode = require('../stores/uiModeStore').useUiModeStore.getState().interfaceMode === 'audio';
  const phoneNote = phoneMode ? '\n\nPHONE CALL MODE: Speak like a natural telephone conversation. Answer in one or two short spoken sentences, usually under 35 words. No lists, markdown, headings, long introductions, or extended explanations unless urgently required for safety or explicitly requested. Ask one brief question if appropriate.' : '';
  // Respect per-project creative preferences, including imported/older projects
  // where missing flags default to off. Explicit user requests take precedence.
  const chatState = require('../stores/chatStore').useChatStore.getState();
  const currentChat = chatState.conversations.find((c: any) => c.id === chatState.activeConversationId);
  const currentProject = currentChat?.projectId ? require('../stores/projectStore').useProjectStore.getState().getProject(currentChat.projectId) : undefined;
  const learningEnabled = currentProject?.allowLearningActivities !== false;
  const projectPreferences = currentProject && !learningEnabled
    ? 'Do not proactively suggest or generate project-based learning games, quizzes, or podcasts. Only create them if the user explicitly asks. Standalone offline arcade games are unrelated to project content.'
    : '';
  const projectGuard = projectPreferences ? `\n\nPROJECT FEATURE PREFERENCES: ${  projectPreferences}` : '';
  // Settings > Appearance & AI style applies to every agent and project. It comes before
  // the phone-call note so call mode can still keep spoken answers short.
  let style = '';
  try { style = require('./aiStyle').aiStyleNote(require('../stores/appStore').useAppStore.getState().settings?.aiStyle); } catch { /* no settings yet */ }
  let about = '';
  try {
    const me = require('../stores/aboutMeStore');
    about = me.aboutMeNote(me.useAboutMe.getState().about, me.useAboutMe.getState().memories, require('../stores/appStore').useAppStore.getState().settings?.userName || '');
  } catch { /* nothing saved yet */ }
  // Models update shared project files far too rarely unless told when to: say it plainly in project chats.
  const projectFiles = currentProject
    ? '\n\nPROJECT FILES: this chat belongs to a project whose documents every chat in it shares. When you finish a piece of work, make a decision, or learn something the next chat will need, call update_project_document yourself (use "Current Progress" with mode "append" for progress, "replace" to rewrite a document). Do this without being asked, then tell the user in one short line what you saved. Read search_knowledge_base before answering questions about the project.'
    : '';
  if (!agent || !agent.systemPrompt.trim()) return (projectPrompt?.trim() || fallback) + lp + about + style + phoneNote + projectGuard + projectFiles;
  return agentPromptWithLessons(agent) + (projectPrompt?.trim() ? `\n\nProject notes:\n${projectPrompt.trim()}` : '') + lp + about + style + phoneNote + projectGuard + projectFiles;
}

