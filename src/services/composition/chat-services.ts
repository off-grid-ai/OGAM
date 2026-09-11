// Composition root for the chat services that need NOTHING from the chat host port: context
// compaction, generation intent, and per-request prompt enhancement. They live apart from
// `composition/chat` because their consumer facades sit BELOW the host port, and pulling them
// from the full chat composition made every one of those facades depend on it.
import {
  ContextCompactionService,
  GenerationIntentService,
  ImagePromptEnhancementService,
  once,
  type CompactableGenerationMessage,
} from '@offgrid/models';
import { mobileContextCompactionPorts } from '../contextCompactionPorts';

export const contextCompaction = once(
  () => new ContextCompactionService<CompactableGenerationMessage>(mobileContextCompactionPorts()),
);

export const generationIntent = once(() => new GenerationIntentService());

/** One enhancement service per request; its ports carry that request's chat card. */
export function imagePromptEnhancement(
  ports: ConstructorParameters<typeof ImagePromptEnhancementService>[0],
): ImagePromptEnhancementService {
  return new ImagePromptEnhancementService(ports);
}
