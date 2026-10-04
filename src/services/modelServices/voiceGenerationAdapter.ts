import {
  type GenerationAdapter,
  type GenerationChunk,
  type GenerationRequest,
  type ModelInventoryAdapter,
  type RuntimeModel,
  classifyStreamingRuntimeError,
} from '@offgrid/models';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { synthesizeRemoteVoiceFile } from '../adapters/remote/voicePlayback';

export interface MobileLocalVoicePort {
  listModels(): RuntimeModel[] | Promise<RuntimeModel[]>;
  selectedRouteId(): string | null;
  selectRouteId?(routeId: string | null): void | Promise<void>;
  generate(
    model: RuntimeModel,
    request: GenerationRequest,
  ): AsyncIterable<GenerationChunk>;
}

let localVoicePort: MobileLocalVoicePort | null = null;

/** Pro installs the local voice boundary without making core depend on Pro. */
export function registerMobileLocalVoicePort(port: MobileLocalVoicePort): () => void {
  localVoicePort = port;
  return () => {
    if (localVoicePort === port) localVoicePort = null;
  };
}

export function selectedMobileLocalVoiceRoute(): string | null {
  return localVoicePort?.selectedRouteId() ?? null;
}

export async function selectMobileLocalVoiceRoute(routeId: string | null): Promise<void> {
  if (routeId && !localVoicePort?.selectRouteId) throw new Error('Local voice selection is unavailable');
  await localVoicePort?.selectRouteId?.(routeId);
}

export const mobileLocalVoiceInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-voice-inventory',
  async listModels() {
    return localVoicePort ? localVoicePort.listModels() : [];
  },
};

function voiceOperation(request: GenerationRequest) {
  if (request.operation?.type !== 'voice') {
    throw new TypeError('The voice adapter requires a voice operation');
  }
  return request.operation;
}

async function* remoteVoiceChunks(
  model: RuntimeModel,
  request: GenerationRequest,
): AsyncIterable<GenerationChunk> {
  const operation = voiceOperation(request);
  const server = useRemoteServerStore.getState().servers.find(
    candidate => candidate.id === model.serverId,
  );
  if (!server) throw new Error(`Remote voice server is unavailable: ${model.serverId}`);
  const messageId = request.identity?.turnId ?? `voice-${Date.now()}`;
  const path = await synthesizeRemoteVoiceFile({
    server,
    model: model.id,
    text: operation.text,
    messageId,
    voice: operation.voice,
    signal: request.signal,
  });
  yield {
    output: {
      type: 'voice',
      audio: { mimeType: path.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg', uri: path },
      text: operation.text,
      language: operation.language,
    },
    finishReason: 'stop',
  };
}

function voiceAdapter(id: string): GenerationAdapter {
  return {
    id,
    generate(model, request) {
      if (model.source === 'local') {
        if (!localVoicePort) throw new Error('Local voice execution is unavailable');
        return localVoicePort.generate(model, request);
      }
      return remoteVoiceChunks(model, request);
    },
    classifyError: classifyStreamingRuntimeError,
  };
}

/** Keep voice execution adapters aligned with the routes published by inventory. */
export function reconcileMobileVoiceAdapters(
  service: { registerAdapter(adapter: GenerationAdapter): () => void },
  inventory: readonly RuntimeModel[],
  registrations: Map<string, () => void>,
): void {
  const supported = new Set(
    inventory
      .filter(model => model.modality === 'voice')
      .map(model => model.adapterId),
  );
  for (const [id, unregister] of registrations) {
    if (supported.has(id)) continue;
    unregister();
    registrations.delete(id);
  }
  for (const id of supported) {
    if (registrations.has(id)) continue;
    registrations.set(id, service.registerAdapter(voiceAdapter(id)));
  }
}
