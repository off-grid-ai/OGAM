import { useLearningStore } from './store';
import { NO_AGENT } from './agents';
import { bestExpert, expertsNote } from './experts';
import { useAgentStore } from '../stores/agentStore';

let lastUsed: string[] = [];
/** The lessons the latest reply was written with (General, and the matching expert), for the note under the reply. */
export const lessonsUsedThisTurn = (): string[] => lastUsed;

/** The lessons the AI learned that apply to this message. Chats with an agent use that agent's own lessons instead. */
export function learnedNote(message: string): string {
  lastUsed = [];
  if (useAgentStore.getState().activeAgentId) return '';
  try {
    const learning = useLearningStore.getState();
    const experts = learning.experts.map((e) => ({ id: e.id, name: e.name, topic: learning.getConfig(e.id).topic, lessons: learning.get(e.id).lessons }));
    const general = learning.get(NO_AGENT).lessons;
    const note = expertsNote(message, general, experts);
    if (note) lastUsed = [...(general.trim() ? ['General'] : []), ...(bestExpert(message, experts) ? [bestExpert(message, experts)!.name] : [])];
    return note;
  } catch { return ''; }
}
