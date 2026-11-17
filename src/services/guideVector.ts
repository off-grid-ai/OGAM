/**
 * The guide's question as a vector, so the shared matcher finds a flow by what the question means
 * ("use my graphics card" finds the GPU switch), not only by its words.
 *
 * The guide's vectors come from all-MiniLM-L6-v2 (GUIDE_KB_VECTOR_MODEL), the search model this app
 * ships built in. A question is embedded only with that same model: when someone picked another
 * search model, its vectors would not line up, and the guide matches by words instead. Any failure
 * does the same; the guide always answers.
 */
import { GUIDE_KB_VECTOR_MODEL } from '@offgrid/models';
import { embeddingService } from './rag/embedding';
import logger from '../utils/logger';

/** The built-in model, by the ids the search settings know it by. */
function usesBuiltInModel(): boolean {
  const id = embeddingService.getModelId();
  return id.includes(GUIDE_KB_VECTOR_MODEL) && !id.includes('/');
}

/** The question's vector from the built-in search model, or undefined to match by words. */
export async function guideQuestionVector(question: string): Promise<number[] | undefined> {
  try {
    return await embeddingService.runExclusive(async () => {
      // Checked under the lock: a model switch queued ahead of this cannot slip in between.
      if (!usesBuiltInModel()) return undefined;
      if (!embeddingService.isLoaded()) await embeddingService.load();
      return embeddingService.embed(question);
    });
  } catch (error) {
    logger.warn(`[Guide] question not embedded, matching by words: ${String(error)}`);
    return undefined;
  }
}
