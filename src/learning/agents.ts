/**
 * Learning mode works for an agent, or for no agent at all ("just learn"): the lessons then live with the learning
 * history instead of inside an agent, and nothing in the agent list changes. Everything that needs "the agent" asks here.
 */
import { useAgentStore, type Agent } from '../stores/agentStore';
import { useLearningStore } from './store';
import { writeLessonsFile } from './lessonsFile';

export const NO_AGENT = '__no-agent__';
export const isNoAgent = (id: string) => id === NO_AGENT;

export function learningAgent(id: string): Agent | undefined {
  if (!isNoAgent(id)) return useAgentStore.getState().getAgent(id);
  return {
    id, name: 'Atlas', description: 'Learning without an agent', systemPrompt: '', lessons: useLearningStore.getState().get(id).lessons,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  } as Agent;
}

export function setLessons(id: string, lessons: string): void {
  if (isNoAgent(id)) useLearningStore.getState().patch(id, { lessons });
  else useAgentStore.getState().updateAgent(id, { lessons });
  void writeLessonsFile(learningAgent(id)?.name ?? 'Atlas', lessons); // also kept as a file the person can open
}
