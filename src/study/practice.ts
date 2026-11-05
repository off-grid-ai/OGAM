/** Makes a practice set from a project's own documents: collect passages, ask the model, keep only what the material supports. */
import { askModel, gatherSources } from './engine';
import { exercisePrompt, groundExercises, readExercises, useExerciseStore, type Exercise, type SourceChunk } from './exercises';

export interface PracticeResult { added: number; dropped: number; reasons: string[] }
export const ALL_KINDS: Exercise['kind'][] = ['mcq', 'truefalse', 'fill', 'calc', 'order', 'match', 'table', 'short', 'testlet'];

export async function generatePractice(projectId: string, topic: string, kinds: Exercise['kind'][] = ALL_KINDS, count = 8): Promise<PracticeResult> {
  const sources = await gatherSources(projectId, topic);
  if (!sources.length) throw new Error('No material found. Add documents to this project first.');
  const chunks: SourceChunk[] = sources.map((s) => ({ doc: s.doc, section: `part ${s.part}`, text: s.text }));
  const text = await askModel('You write exam practice questions strictly from the supplied material. Output only JSON.', exercisePrompt(chunks.slice(0, 6), kinds, count));
  const { kept, dropped } = groundExercises(readExercises(text), chunks, topic.trim() || sources[0].doc);
  useExerciseStore.getState().addSet(kept);
  return { added: kept.length, dropped: dropped.length, reasons: [...new Set(dropped.map((d) => d.why))] };
}
