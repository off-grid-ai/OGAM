import { isRecordProvenance, type RecordProvenance } from '@offgrid/sync';
import { generateId } from '../utils/generateId';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import type {
  ResolvedVideoRequest,
  VideoGenerationResultContract,
  VideoGenerationProgressContract,
  VideoGenerationStage,
  VideoGenerationUpdateContract,
} from '@offgrid/models';
import { remoteServerManager } from './remoteServerManager';
import type { RemoteMediaModelIds, RemoteServer } from '../types';
import { REMOTE_FETCH_REDIRECT_POLICY, remoteAuthorizationHeaders } from './remoteTransportPolicy';
import { remoteHttpErrorMessage } from './httpClient';
import { OverridableMemoryError } from './modelLoadErrors';

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
  override?: boolean;
  onImageProgress?: (step: number, total: number) => void;
}

function endpoint(server: RemoteServer, path: string): string {
  let base = server.endpoint;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}${base.endsWith('/v1') && path.startsWith('/v1/') ? path.slice(3) : path}`;
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
    if (signal?.aborted) controller.abort();
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
      const message = remoteHttpErrorMessage(detail, response.status);
      try {
        const body = JSON.parse(detail) as { error?: { code?: unknown }; code?: unknown };
        const marker = 'OFFGRID_IMAGE_MEMORY_LIMIT:';
        if (
          (body.error?.code ?? body.code) === 'OFFGRID_IMAGE_MEMORY_LIMIT' ||
          message.includes(marker)
        ) {
          throw Object.assign(
            new OverridableMemoryError(message.replace(marker, '').trim()),
            { remote: true },
          );
        }
      } catch (error) {
        if (error instanceof OverridableMemoryError) throw error;
      }
      throw new Error(message);
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
  const model = server.mediaModels?.[kind]?.trim();
  if (!model) throw new Error(`No remote ${kind} model is configured`);
  return model;
}

/** Thin OpenAI-compatible adapters. The server record owns every endpoint and model choice. */
export const remoteMediaRuntime = {
  async generateVideo(
    server: RemoteServer,
    input: ResolvedVideoRequest,
    outputPath: string,
    options: {
      signal: AbortSignal;
      model?: string;
      jobId?: string;
      onJobStarted: (id: string) => Promise<unknown>;
      onProgress: (
        progress: VideoGenerationProgressContract | null,
        stage?: VideoGenerationStage,
      ) => void;
      onPreview?: (preview: NonNullable<VideoGenerationUpdateContract['preview']>) => void;
    },
  ): Promise<
    VideoGenerationResultContract & { provenance?: RecordProvenance }
  > {
    if (server.modelManagement !== 'offgrid-desktop-v1')
      throw new Error('Remote video requires an OGAD server.');
    const clientJobId = options.jobId ?? generateId();
    await options.onJobStarted(clientJobId);
    const job = await request(
      {
        server,
        path: '/v1/videos',
        signal: options.signal,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...input,
            model: options.model ?? requiredModel(server, 'video'),
            enhancePrompt: false,
            client_job_id: clientJobId,
          }),
        },
      },
      response => response.json() as Promise<{ request_id: string }>,
    );
    if (!job.request_id) throw new Error('The server returned no video job.');
    await options.onJobStarted(job.request_id);
    const cancel = () => {
      void request(
        {
          server,
          path: `/v1/videos/${encodeURIComponent(job.request_id)}/cancel`,
          init: { method: 'POST' },
        },
        async response => {
          await response.text();
        },
      ).catch(() => {});
    };
    options.signal.addEventListener('abort', cancel, { once: true });
    const previewController = new AbortController();
    const stopPreview = () => previewController.abort();
    options.signal.addEventListener('abort', stopPreview, { once: true });
    let previewRequest: Promise<void> | undefined;
    try {
      if (options.signal.aborted) {
        cancel();
        throw new Error('Video generation stopped.');
      }
      while (true) {
        const state = await request(
          {
            server,
            path: `/v1/videos/${encodeURIComponent(job.request_id)}`,
            signal: options.signal,
            init: { method: 'GET' },
          },
          response =>
            response.json() as Promise<{
              status: string;
              stage?: VideoGenerationStage;
              progress?: { step: number; total: number };
              preview?: { width: number; height: number };
              error?: { message: string };
              result?: VideoGenerationResultContract & {
                provenance?: RecordProvenance;
              };
            }>,
        );
        const progress =
          state.progress && Number.isFinite(state.progress.step) && Number.isFinite(state.progress.total)
            ? state.progress
            : null;
        const stage =
          state.stage && ['enhancing', 'preparing', 'conditioning', 'generating', 'decoding', 'encoding'].includes(state.stage)
            ? state.stage
            : undefined;
        if (progress || stage) options.onProgress(progress, stage);
        if (!previewRequest && options.onPreview && state.preview &&
          Number.isFinite(state.preview.width) && state.preview.width > 0 &&
          Number.isFinite(state.preview.height) && state.preview.height > 0) {
          const dimensions = state.preview;
          // Fetch only this job's authenticated route, never a URL from server metadata.
          // Preview transfer must not delay job polling or final video delivery.
          const timeout = setTimeout(stopPreview, 5000);
          previewRequest = request({
            server,
            path: `/v1/videos/${encodeURIComponent(job.request_id)}/preview`,
            signal: previewController.signal,
            init: { method: 'GET', headers: { Accept: 'image/png' } },
          }, async response => {
            const bytes = await response.arrayBuffer();
            if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) return;
            const path = `${outputPath}.preview.png`;
            await RNFS.writeFile(path, Buffer.from(bytes).toString('base64'), 'base64');
            if (!previewController.signal.aborted) options.onPreview?.({ path, width: dimensions.width, height: dimensions.height });
          }).catch(() => {
            // A missing or expired preview must not fail video generation.
          }).finally(() => clearTimeout(timeout));
        }
        if (state.status === 'failed' || state.status === 'cancelled')
          throw Object.assign(
            new Error(
              state.error?.message ?? 'Remote video generation failed.',
            ),
            { code: 'VIDEO_REMOTE_FAILED' },
          );
        if (state.status === 'completed') {
          if (!state.result?.syncId)
            throw new Error('The server returned an invalid video result.');
          const apiKey = await remoteServerManager.getApiKey(server.id);
          const transfer = RNFS.downloadFile({
            fromUrl: endpoint(
              server,
              `/v1/videos/${encodeURIComponent(job.request_id)}/content`,
            ),
            toFile: outputPath,
            headers: remoteAuthorizationHeaders(server.endpoint, apiKey),
            connectionTimeout: 15000,
            readTimeout: 60000,
          });
          const stopTransfer = () => RNFS.stopDownload(transfer.jobId);
          options.signal.addEventListener('abort', stopTransfer, {
            once: true,
          });
          try {
            if (options.signal.aborted) {
              stopTransfer();
              throw new Error('Video generation stopped.');
            }
            const result = await transfer.promise;
            if (result.statusCode !== 200 || result.bytesWritten <= 0)
              throw new Error('Could not download the generated video.');
          } finally {
            options.signal.removeEventListener('abort', stopTransfer);
          }
          return {
            ...state.result,
            provenance: isRecordProvenance(state.result.provenance)
              ? state.result.provenance
              : undefined,
            path: outputPath,
          };
        }
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new Error('Video generation stopped.'));
          };
          const timer = setTimeout(() => {
            options.signal.removeEventListener('abort', abort);
            resolve();
          }, 1000);
          options.signal.addEventListener('abort', abort, { once: true });
          if (options.signal.aborted) abort();
        });
      }
    } finally {
      stopPreview();
      await previewRequest;
      options.signal.removeEventListener('abort', stopPreview);
      options.signal.removeEventListener('abort', cancel);
    }
  },

  async generateImage(
    server: RemoteServer,
    input: { prompt: string; size?: string },
    options: RemoteMediaRequestOptions = {},
  ): Promise<RemoteImageResult> {
    const openRouter = new URL(server.endpoint).hostname === 'openrouter.ai';
    const desktop = server.modelManagement === 'offgrid-desktop-v1';
    type ImagePayload = {
      data?: Array<{ b64_json?: string; url?: string }>;
      choices?: Array<{
        message?: { images?: Array<{ image_url?: { url?: string } }> };
      }>;
    };
    const payload = await request(
      {
        server,
        path: openRouter ? '/v1/chat/completions' : '/v1/images/generations',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            openRouter
              ? {
                  model: requiredModel(server, 'image'),
                  messages: [{ role: 'user', content: input.prompt }],
                  modalities: ['image', 'text'],
                  stream: false,
                }
              : {
                  model: requiredModel(server, 'image'),
                  prompt: input.prompt,
                  size: input.size ?? '1024x1024',
                  response_format: 'b64_json',
                  ...(desktop ? { async: true } : {}),
                  ...(options.override
                    ? { allow_unsafe_memory_override: true }
                    : {}),
                },
          ),
        },
        signal: options.signal,
      },
      response =>
        response.json() as Promise<ImagePayload & { request_id?: string }>,
    );
    let result: ImagePayload = payload;
    if (desktop && payload.request_id) {
      while (true) {
        if (options.signal?.aborted) throw new Error('Remote request cancelled');
        const state = await request({
          server,
          path: `/v1/requests/${encodeURIComponent(payload.request_id)}`,
          init: { method: 'GET' },
          signal: options.signal,
        }, response => response.json() as Promise<{
          status: string;
          result?: ImagePayload;
          error?: { message?: string };
          progress?: { step: number; total: number };
        }>);
        if (state.progress) options.onImageProgress?.(state.progress.step, state.progress.total);
        if (state.status === 'completed') {
          result = state.result ?? {};
          break;
        }
        if (state.status === 'failed') throw new Error(state.error?.message ?? 'Remote image generation failed');
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            options.signal?.removeEventListener('abort', abort);
            resolve();
          }, 1000);
          const abort = () => {
            clearTimeout(timer);
            reject(new Error('Remote request cancelled'));
          };
          options.signal?.addEventListener('abort', abort, { once: true });
        });
      }
    }
    const image = result.data?.[0];
    const imageUrl = image?.url ?? result.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!image?.b64_json && !imageUrl) throw new Error('Remote server returned no image');
    return { base64: image?.b64_json, url: imageUrl };
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
    const openRouter = new URL(server.endpoint).hostname === 'openrouter.ai';
    const voice =
      input.voice ||
      (openRouter
        ? (await remoteMediaRuntime.listVoices(server, options))[0]
        : undefined);
    if (openRouter && !voice)
      throw new Error('This remote model has no available speakers.');
    return request(
      {
        server,
        path: '/v1/audio/speech',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: requiredModel(server, 'voice'),
            input: input.text,
            ...(voice ? { voice } : {}),
            ...(openRouter ? { response_format: 'mp3' } : {}),
          }),
        },
        signal: options.signal,
      },
      async response => ({
        audio: await response.arrayBuffer(),
        contentType: response.headers.get('content-type') ?? 'audio/mpeg',
      }),
    );
  },

  async listVoices(
    server: RemoteServer,
    options: RemoteMediaRequestOptions = {},
  ): Promise<string[]> {
    try {
      const modelId = requiredModel(server, 'voice');
      const catalog = await request({
        server,
        path: '/v1/models?output_modalities=speech',
        init: { method: 'GET' },
        signal: options.signal,
      }, response => response.json() as Promise<{
        data?: Array<{ id?: string; supported_voices?: unknown; voices?: unknown }>;
      }>);
      const model = catalog.data?.find(entry => entry.id === modelId);
      const listed = model?.supported_voices ?? model?.voices;
      if (Array.isArray(listed)) {
        return listed.filter((voice): voice is string => typeof voice === 'string');
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
    }
    const payload = await request({
      server,
      path: '/v1/audio/voices',
      init: { method: 'GET' },
      signal: options.signal,
    }, response => response.json() as Promise<{ voices?: unknown }>);
    return Array.isArray(payload.voices)
      ? payload.voices.filter(
          (voice): voice is string => typeof voice === 'string',
        )
      : [];
  },
};
