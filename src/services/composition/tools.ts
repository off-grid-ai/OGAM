// Composition root: shared tool routing over Mobile's embedding ports.
import { PersistentToolEmbeddingCache, ToolRoutingService, once } from '@offgrid/models';
import { mobileToolEmbeddingStorage } from '../adapters/native/toolEmbeddingAdapter';
import { mobileToolRoutingPorts } from '../modelServices/toolRoutingPorts';

/** The persisted tool-embedding cache over React Native storage. Shared owns identity and eviction. */
export const mobileToolEmbeddingCache = once(() => new PersistentToolEmbeddingCache({
  read: () => mobileToolEmbeddingStorage.read(),
  write: entries => mobileToolEmbeddingStorage.write(entries),
}));

export const toolRouting = once(
  () => new ToolRoutingService(mobileToolRoutingPorts(mobileToolEmbeddingCache())),
);

export function resetMobileToolEmbeddingCache(): void {
  mobileToolEmbeddingCache().clear();
}
