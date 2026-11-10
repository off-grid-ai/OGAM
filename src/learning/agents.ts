/**
 * Learning mode works for an agent, or for no agent at all ("just learn"): the lessons then live with the learning
 * history instead of inside an agent, and nothing in the agent list changes. Everything that needs "the agent" asks here.
 */
import { useAgentStore, type Agent } from '../stores/agentStore';
import { useLearningStore } from './store';
import { writeLessonsFile } from './lessonsFile';

export const NO_AGENT = '__no-agent__';
/** The general subject: learning that is not about one field. Always shown first. */
export const GENERAL_NAME = 'General';

/**
 * Learning belongs to a subject (an "expert": General, Taxes, Law...), or to an agent when a link names one. An id that is
 * not an agent keeps its lessons with the learning history instead of inside an agent.
 */
export const isNoAgent = (id: string) => id === NO_AGENT || !useAgentStore.getState().getAgent(id);

export const expertName = (id: string): string =>
  id === NO_AGENT ? GENERAL_NAME : useLearningStore.getState().experts.find((e) => e.id === id)?.name ?? GENERAL_NAME;

export function learningAgent(id: string): Agent | undefined {
  if (!isNoAgent(id)) return useAgentStore.getState().getAgent(id);
  return {
    id, name: expertName(id), description: 'Learning without an agent', systemPrompt: '', lessons: useLearningStore.getState().get(id).lessons,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  } as Agent;
}

export function setLessons(id: string, lessons: string): void {
  if (isNoAgent(id)) useLearningStore.getState().patch(id, { lessons });
  else useAgentStore.getState().updateAgent(id, { lessons });
  void writeLessonsFile(learningAgent(id)?.name ?? GENERAL_NAME, lessons); // also kept as a file the person can open
}
