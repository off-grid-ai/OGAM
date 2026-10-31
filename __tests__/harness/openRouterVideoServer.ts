/**
 * OpenRouter as the video server, at the network boundary (fetch + the RNFS download).
 *
 * Wire shapes are OpenRouter's own (openrouter.ai/docs/guides/overview/multimodal/video-generation):
 * POST /api/v1/videos answers 202 { id, polling_url, status: 'pending' }; GET /api/v1/videos/{id} is
 * the poll { id, generation_id, polling_url, status, unsigned_urls, usage, error? } with status
 * pending | in_progress | completed | failed; the MP4 is GET /api/v1/videos/{id}/content?index=0 with
 * the API key. GET /api/v1/videos/models lists each video model's supported durations, aspect ratios,
 * resolutions and frame images. GET /api/v1/models lists text models only unless `output_modalities`
 * asks for more. Every call without `Authorization: Bearer <key>` is refused with 401.
 */
import type { NativeFileSystemBoundary } from './nativeFileSystem';

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1';
export const OPENROUTER_KEY = 'sk-or-v1-test-key';
export const OPENROUTER_TEXT_MODEL = { id: 'qwen/qwen3-8b', name: 'Qwen: Qwen3 8B' };
/** A video model that can start from a picture. */
export const OPENROUTER_VIDEO_MODEL = { id: 'google/veo-3.1-fast', name: 'Google: Veo 3.1 Fast' };
/** A video model that makes clips from words only (its frame images list no first_frame). */
export const OPENROUTER_WORDS_ONLY_VIDEO_MODEL = { id: 'example/words-to-video', name: 'Example: Words to Video' };
export const OPENROUTER_DURATIONS = [4, 6, 8];
export const OPENROUTER_ASPECTS = ['16:9', '9:16'];
export const OPENROUTER_RESOLUTIONS = ['720p', '1080p'];

const VIDEO_INFO = [
  {
    ...OPENROUTER_VIDEO_MODEL,
    supported_durations: OPENROUTER_DURATIONS,
    supported_aspect_ratios: OPENROUTER_ASPECTS,
    supported_resolutions: OPENROUTER_RESOLUTIONS,
    supported_frame_images: ['first_frame', 'last_frame'],
    // As OpenRouter publishes Veo 3.1 Fast: it takes generate_audio, so clips can be asked silent.
    generate_audio: true,
  },
  {
    ...OPENROUTER_WORDS_ONLY_VIDEO_MODEL,
    supported_durations: OPENROUTER_DURATIONS,
    supported_aspect_ratios: OPENROUTER_ASPECTS,
    supported_resolutions: OPENROUTER_RESOLUTIONS,
    supported_frame_images: [] as string[],
    // Like HeyGen Video 1: always renders sound and refuses the field.
    generate_audio: false,
  },
];

const MODELS = [
  {
    ...OPENROUTER_TEXT_MODEL,
    context_length: 131072,
    supported_parameters: ['tools', 'reasoning'],
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  },
  ...VIDEO_INFO.map(model => ({
    id: model.id,
    name: model.name,
    context_length: 0,
    supported_parameters: [],
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['video'] },
  })),
];

export interface OpenRouterVideoJobs {
  /** Every video submission OpenRouter received: the JSON body the phone sent. */
  submissions: Array<Record<string, unknown>>;
  /** Every poll of a job (its id), in order. */
  polls: string[];
  /** Every job running now ends failed with this reason, as OpenRouter reports a failed job. */
  failRunning: (message: string) => void;
  /** Keep every job in progress (polls answer `in_progress`) until release(). */
  hold: () => void;
  release: () => void;
  restore: () => void;
}

export function serveOpenRouterVideo(disk: NativeFileSystemBoundary): OpenRouterVideoJobs {
  const original = globalThis.fetch;
  const jobs = new Map<string, { failed?: string; done?: boolean }>();
  let held = false;
  let next = 0;
  const state: OpenRouterVideoJobs = {
    submissions: [],
    polls: [],
    failRunning: message => {
      for (const job of jobs.values()) if (!job.done) job.failed = message;
    },
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const pollUrl = (id: string) => `${OPENROUTER_ENDPOINT}/videos/${id}`;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== 'https://openrouter.ai') return original(input, init);
    if (init?.signal?.aborted) throw new Error('Aborted');
    const authorization = new Headers(init?.headers).get('authorization');
    if (authorization !== `Bearer ${OPENROUTER_KEY}`)
      return json({ error: { message: 'No auth credentials found', code: 401 } }, 401);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const route = `${method} ${path}`;
    if (route === 'GET /models') {
      // Text models only, unless output_modalities asks for others.
      const wanted = url.searchParams.get('output_modalities')?.split(',') ?? ['text'];
      return json({
        data: MODELS.filter(model => model.architecture.output_modalities.some(item => wanted.includes(item))),
      });
    }
    if (route === 'GET /videos/models') return json({ data: VIDEO_INFO });
    if (route === 'POST /videos') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (!VIDEO_INFO.some(model => model.id === body.model))
        return json({ error: { message: `${String(body.model)} is not a valid model ID`, code: 400 } }, 400);
      state.submissions.push(body);
      next += 1;
      const id = `vgen-${next}`;
      jobs.set(id, {});
      return json({ id, polling_url: pollUrl(id), status: 'pending' }, 202);
    }
    const poll = path.match(/^\/videos\/([^/]+)$/);
    if (poll && method === 'GET') {
      const id = decodeURIComponent(poll[1]);
      const job = jobs.get(id);
      if (!job) return json({ error: { message: 'Video generation not found', code: 404 } }, 404);
      state.polls.push(id);
      const base = { id, generation_id: `gen-${id}`, polling_url: pollUrl(id) };
      if (job.failed) return json({ ...base, status: 'failed', error: job.failed });
      if (held) return json({ ...base, status: 'in_progress' });
      job.done = true;
      const content = `${OPENROUTER_ENDPOINT}/videos/${id}/content?index=0`;
      disk.serveRemoteFile(content, { body: 'mp4-bytes', headers: { 'Content-Type': 'video/mp4' } });
      return json({ ...base, status: 'completed', unsigned_urls: [content], usage: { cost: 0.4, is_byok: false } });
    }
    return json({ error: { message: 'Not Found', code: 404 } }, 404);
  }) as typeof globalThis.fetch;
  return state;
}
