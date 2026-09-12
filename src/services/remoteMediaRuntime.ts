import { remoteServerManager } from './remoteServerManager';
import type { RemoteMediaModelIds, RemoteServer } from '../types';
import { REMOTE_FETCH_REDIRECT_POLICY, remoteAuthorizationHeaders } from './remoteTransportPolicy';

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

function endpoint(server: RemoteServer, path: string): string {
  let base = server.endpoint;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}${path}`;
}

async function request<T>(
  input: {
    server: RemoteServer;
    path: string;
    init: RequestInit;
    signal?: AbortSignal;
  },
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const { server, path, init, signal } = input;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const apiKey = await remoteServerManager.getApiKey(server.id);
    if (controller.signal.aborted) throw new Error('Remote request cancelled');
    const response = await fetch(endpoint(server, path), {
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
      throw new Error(detail || `Remote server returned HTTP ${response.status}`);
    }
    // Keep timeout and caller cancellation attached until the response body is
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
  const model = server.mediaModels?.[kind]?.trim();
  if (!model) throw new Error(`No remote ${kind} model is configured`);
  return model;
}

/** Thin OpenAI-compatible adapters. The server record owns every endpoint and model choice. */
export const remoteMediaRuntime = {
  async generateImage(
    server: RemoteServer,
    input: { prompt: string; size?: string },
    options: RemoteMediaRequestOptions = {},
  ): Promise<RemoteImageResult> {
    const payload = await request({
      server,
      path: '/v1/images/generations',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: requiredModel(server, 'image'),
          prompt: input.prompt,
          size: input.size ?? '1024x1024',
          response_format: 'b64_json',
        }),
      },
      signal: options.signal,
    }, response => response.json() as Promise<{
      data?: Array<{ b64_json?: string; url?: string }>;
    }>);
    const image = payload.data?.[0];
    if (!image?.b64_json && !image?.url) throw new Error('Remote server returned no image');
    return { base64: image.b64_json, url: image.url };
  },

  async transcribe(
    server: RemoteServer,
    input: { fileUri: string; language?: string },
    options: RemoteMediaRequestOptions = {},
  ): Promise<string> {
    const body = new FormData();
    body.append('model', requiredModel(server, 'transcription'));
    if (input.language) body.append('language', input.language);
    body.append('file', {
      uri: input.fileUri,
      name: 'recording.wav',
      type: 'audio/wav',
    } as unknown as Blob);
    const payload = await request({
      server,
      path: '/v1/audio/transcriptions',
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
    input: { text: string; voice?: string },
    options: RemoteMediaRequestOptions = {},
  ): Promise<RemoteVoiceResult> {
    return request({
      server,
      path: '/v1/audio/speech',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: requiredModel(server, 'voice'),
          input: input.text,
          voice: input.voice ?? 'alloy',
          response_format: 'mp3',
        }),
      },
      signal: options.signal,
    }, async response => ({
      audio: await response.arrayBuffer(),
      contentType: response.headers.get('content-type') ?? 'audio/mpeg',
    }));
  },
};
