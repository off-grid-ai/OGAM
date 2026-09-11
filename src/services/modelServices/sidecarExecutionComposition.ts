import { classifierIntent } from '@offgrid/models';
import type { GenerationMessage, WorkspaceGenerationPort } from '@offgrid/models';
import { EMBEDDING_MODEL_FILENAME } from '../adapters/native/embeddingRuntimeAdapter';
import {
  registerMobileSidecarExecutionPort,
} from '../mobileSidecarGeneration';
import { mobileRouteId } from './mobileRoute';

function embeddingRoute(modality: 'embedding'): string {
  return mobileRouteId({
    source: 'local',
    hostId: 'llama.rn-sidecar',
    modality,
    modelId: EMBEDDING_MODEL_FILENAME,
  });
}

export function composeMobileSidecarExecution(
  service: WorkspaceGenerationPort,
  refresh: () => Promise<unknown>,
): () => void {
  return registerMobileSidecarExecutionPort({
    async text(messages: GenerationMessage[], options) {
      await refresh();
      const result = await service.generate({
        profile: options.profile,
        operation: { type: 'text' }, messages,
        reasoning: { enabled: false }, maxTokens: options.maxTokens,
      }, { chunk: chunk => { if (chunk.content) options.onText?.(chunk.content); } });
      return result.content;
    },
    async embedding(inputs) {
      await refresh();
      const result = await service.generate({
        operation: { type: 'embedding', inputs },
        routeId: embeddingRoute('embedding'), profile: 'embedding',
      });
      if (result.output.type !== 'embedding') throw new TypeError('Embedding returned an invalid result');
      return result.output.vectors;
    },
    async classification(input, routeId) {
      await refresh();
      const result = await service.generate({
        operation: { type: 'classifier', input, labels: ['image', 'text'] },
        routeId, profile: 'structured-step',
      });
      if (result.output.type !== 'classification') throw new TypeError('Classification returned an invalid result');
      return classifierIntent(result.output);
    },
  });
}
