import { useLearningStore } from './store';
import { NO_AGENT } from './agents';
import { expertsNote } from './experts';
import { useAgentStore } from '../stores/agentStore';

/** The lessons the AI learned that apply to this message. Chats with an agent use that agent's own lessons instead. */
export function learnedNote(message: string): string {
  if (useAgentStore.getState().activeAgentId) return '';
  try {
    const learning = useLearningStore.getState();
    const experts = learning.experts.map((e) => ({ id: e.id, name: e.name, topic: learning.getConfig(e.id).topic, lessons: learning.get(e.id).lessons }));
    return expertsNote(message, learning.get(NO_AGENT).lessons, experts);
  } catch { return ''; }
}
