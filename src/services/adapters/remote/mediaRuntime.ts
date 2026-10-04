import type { RemoteMediaModelIds, RemoteServer } from '../../../types';
import {
  DEFAULT_REMOTE_SPEECH_MIME,
  REMOTE_FETCH_REDIRECT_POLICY,
  parseRemoteImageResponse,
  remoteAuthorizationHeaders,
  remoteErrorBodyMessage,
  remoteImageRequest,
  remoteMediaEndpoint,
  remoteTranscriptionUpload,
  remoteVoicePayload,
  resolveRemoteRoute,
} from '@offgrid/models';
import type { RemoteMediaModality } from '@offgrid/models';
import { getApiKeyImpl } from './serverRuntime';


export interface RemoteImageResult {
  base64?: string;
  url?: string;
}

export interface RemoteVoiceResult {
  audio: ArrayBuffer;
  contentType: string;
}

export interface RemoteMediaRequestOptions {
  signal?: AbortSignal;
}

async function request<T>(
  input: {
    server: RemoteServer;
    modality: RemoteMediaModality;
    /** A full URL chosen by shared policy; otherwise the shared endpoint rule for `modality` decides. */
    url?: string;
    init: RequestInit;
    signal?: AbortSignal;
  },
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const { server, modality, init, signal } = input;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const apiKey = await getApiKeyImpl(server.id);
    if (controller.signal.aborted) throw new Error('Remote request cancelled');
    const response = await fetch(input.url ?? remoteMediaEndpoint(server.endpoint, modality), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
        ...remoteAuthorizationHeaders(server.endpoint, apiKey),
      },
      signal: controller.signal,
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(remoteErrorBodyMessage(detail, response.status));
    }
    // Keep caller cancellation attached until the response body is
    // consumed. A successful header is not a completed image/audio transfer.
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Remote request cancelled');
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

function requiredModel(
  server: RemoteServer,
  kind: keyof RemoteMediaModelIds,
): string {
  const resolved = resolveRemoteRoute(
    server,
    kind,
    { status: 'unknown' },
    { strict: true },
  );
  if (!resolved.ready) throw new Error(`No remote ${kind} model is configured`);
  return resolved.route.modelId;
}

/** Thin OpenAI-compatible adapters. The server record owns every endpoint and model choice. */
export const remoteMediaRuntime = {
  async generateImage(
    server: RemoteServer,
    input: {
      prompt: string;
      model?: string;
      width?: number;
      height?: number;
      allowUnsafeMemoryOverride?: boolean;
    },
    options: RemoteMediaRequestOptions = {},
  ): Promise<RemoteImageResult> {
    const plan = remoteImageRequest({
      provider: server.provider,
      endpoint: server.endpoint,
      model: input.model ?? requiredModel(server, 'image'),
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      allowUnsafeMemoryOverride: input.allowUnsafeMemoryOverride,
    });
    const artifact = await request({
      server,
      modality: 'image',
      url: plan.url,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan.body),
      },
      signal: options.signal,
    }, async response => parseRemoteImageResponse(await response.json(), plan.transport));
    return { base64: artifact.base64, url: artifact.url };
  },

  async transcribe(
    server: RemoteServer,
    input: { fileUri: string; language?: string; model?: string },
    options: RemoteMediaRequestOptions = {},
  ): Promise<string> {
    const upload = remoteTranscriptionUpload({
      model: input.model ?? requiredModel(server, 'transcription'),
      language: input.language,
    });
    const body = new FormData();
    for (const [field, value] of Object.entries(upload.fields)) body.append(field, value);
    body.append(upload.file.field, {
      uri: input.fileUri,
      name: upload.file.name,
      type: upload.file.type,
    } as unknown as Blob);
    const payload = await request({
      server,
      modality: 'transcription',
      init: { method: 'POST', body },
      signal: options.signal,
    }, response => response.json() as Promise<{ text?: unknown }>);
    if (typeof payload.text !== 'string') {
      throw new TypeError('Remote server returned no transcript');
    }
    return payload.text.trim();
  },

  async synthesizeVoice(
    server: RemoteServer,
    input: { text: string; voice?: string; model?: string },
    options: RemoteMediaRequestOptions = {},
  ): Promise<RemoteVoiceResult> {
    return request({
      server,
      modality: 'voice',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(remoteVoicePayload({
          model: input.model ?? requiredModel(server, 'voice'),
          text: input.text,
          voice: input.voice,
        })),
      },
      signal: options.signal,
    }, async response => ({
      audio: await response.arrayBuffer(),
      contentType: response.headers.get('content-type') ?? DEFAULT_REMOTE_SPEECH_MIME,
    }));
  },
};
