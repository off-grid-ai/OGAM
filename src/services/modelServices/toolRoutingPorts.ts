import type { PersistentToolEmbeddingCache, ToolRoutingService } from '@offgrid/models';
import { mobileToolEmbeddingPort } from '../adapters/native/toolEmbeddingAdapter';
import { executeMobileText } from '../mobileSidecarGeneration';
import { clearMobileEphemeralTextState } from './generationAdapters';

/** Route selection runs on the sidecar text profile and leaves no ephemeral state behind. */
async function generateToolRoutingText(system: string, user: string): Promise<string> {
  try {
    return await executeMobileText([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { profile: 'tool-routing' });
  } finally {
    await clearMobileEphemeralTextState();
  }
}

/**
 * Embedding engine, cache, and model-selection text ports. Shared owns routing.
 * The cache is the composition root's own instance, injected so this module never
 * reaches back into the composition.
 */
export function mobileToolRoutingPorts(
  embeddingCache: PersistentToolEmbeddingCache,
): ConstructorParameters<typeof ToolRoutingService>[0] {
  return {
    embedding: mobileToolEmbeddingPort,
    embeddingCache,
    modelSelection: generateToolRoutingText,
  };
}
