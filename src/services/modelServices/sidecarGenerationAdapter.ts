import {
  classifierNativeLoadRequest,
  classifierNativeUnloadRequest,
  type GenerationAdapter,
  type GenerationChunk,
  type GenerationRequest,
  type RuntimeModel,
} from '@offgrid/models';
import { classifierExecution } from '../composition/generation';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { embeddingService } from '../adapters/native/embeddingRuntimeAdapter';

function operation(request: GenerationRequest) {
  if (!request.operation) throw new TypeError('A sidecar operation is required');
  return request.operation;
}

async function* embeddingChunks(request: GenerationRequest): AsyncIterable<GenerationChunk> {
  const input = operation(request);
  if (input.type !== 'embedding') throw new TypeError('An embedding operation is required');
  yield {
    output: { type: 'embedding', vectors: await embeddingService.embedBatch(input.inputs) },
    finishReason: 'stop',
  };
}


async function* classifierChunks(request: GenerationRequest): AsyncIterable<GenerationChunk> {
  const input = operation(request);
  if (input.type !== 'classifier') throw new TypeError('A classifier operation is required');
  yield {
    output: await classifierExecution().classify({
      text: input.input,
      labels: input.labels,
      signal: request.signal,
    }),
    finishReason: 'stop',
  };
}

function adapter(id: string): GenerationAdapter {
  return {
    id,
    async load(model) {
      if (model.modality === 'embedding') {
        await embeddingService.load();
      } else if (model.modality === 'classifier') {
        const request = classifierNativeLoadRequest(model.id);
        await nativeModelLifecycle.loadTextModel(request.modelId, request.timeoutMs, request.force);
      }
    },
    async unload(model) {
      if (model.modality === 'embedding') {
        await embeddingService.unload();
      } else if (model.modality === 'classifier') {
        await nativeModelLifecycle.unloadTextModel(classifierNativeUnloadRequest().force);
      }
    },
    generate(model, request) {
      if (model.modality === 'embedding') return embeddingChunks(request);
      if (model.modality === 'classifier') return classifierChunks(request);
      throw new Error(`Unsupported Mobile sidecar modality: ${model.modality}`);
    },
  };
}

export function reconcileMobileSidecarAdapters(
  service: { registerAdapter(adapter: GenerationAdapter): () => void },
  inventory: readonly RuntimeModel[],
  registrations: Map<string, () => void>,
): void {
  const modalities = new Set(['embedding', 'classifier']);
  const supported = new Set(inventory
    .filter(model => modalities.has(model.modality))
    .map(model => model.adapterId));
  for (const [id, unregister] of registrations) {
    if (supported.has(id)) continue;
    unregister();
    registrations.delete(id);
  }
  for (const id of supported) {
    if (!registrations.has(id)) registrations.set(id, service.registerAdapter(adapter(id)));
  }
}
