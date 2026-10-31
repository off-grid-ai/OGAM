/**
 * Off Grid AI Desktop as the video server, at the network boundary (fetch + the RNFS download).
 *
 * Wire shapes are Desktop's own (desktop/pro/main/video/gateway.ts): OpenAI's video API with Off
 * Grid's extras. POST /v1/videos answers the Video object { id, object: 'video', status, progress,
 * ... }; GET /v1/videos/{id} is the same object, with stage, step_progress and preview while it
 * runs and `result` (the shared VideoGenerationResultContract plus `url`) once completed. The MP4 is
 * GET /v1/videos/{id}/content, the decoded frame ?variant=thumbnail. DELETE /v1/videos/{id} stops a
 * job, which then fails with error.code 'cancelled'. GET /v1/videos/models lists the model's limits.
 * The model switcher is /v1/models/catalog, /installed, /active and /activate.
 */
import { videoModelInfo } from '@offgrid/models';
import type { NativeFileSystemBoundary } from './nativeFileSystem';

export const DESKTOP_VIDEO_ENDPOINT = 'http://192.168.1.62:7878'; // NOSONAR - private LAN test fixture
export const DESKTOP_VIDEO_MODEL = { id: 'wan2.1-1.3b', name: 'Wan 2.1 1.3B' };

export interface DesktopVideoJobs {
  /** Every video submission Desktop received: the JSON body the phone sent. */
  submissions: Array<Record<string, unknown>>;
  /** Every job the phone asked Desktop to stop (DELETE /v1/videos/:id). */
  cancels: string[];
  /** From now on a running job carries Desktop's live preview (its poll's `preview`, and the thumbnail). */
  showPreviews: () => void;
  /** Every job running now ends failed with this reason, as Desktop reports a failed job. */
  failRunning: (message: string) => void;
  /** Keep every job running (polls answer `running`) until release(). */
  hold: () => void;
  release: () => void;
  restore: () => void;
  /** After a relaunch: content downloads are served to the new launch's disk too. Jobs carry on. */
  useDisk: (fs: NativeFileSystemBoundary) => void;
  /** When the phone last asked this fake anything (ms since epoch), so a test can end once it is quiet. */
  lastRequestAt: () => number;
}

/** Desktop's Video object for a job: OpenAI's fields from the clip the phone asked for, then `extra`. */
function videoObject(id: string, body: Record<string, unknown>, extra: Record<string, unknown>) {
  return {
    id,
    object: 'video',
    created_at: 1_700_000_000,
    completed_at: null,
    expires_at: null,
    model: body.model,
    prompt: body.prompt,
    seconds: body.seconds,
    size: body.size,
    remixed_from_video_id: null,
    error: null,
    result: null,
    ...extra,
  };
}

export function serveDesktopVideoJobs(disk: NativeFileSystemBoundary): DesktopVideoJobs {
  const original = globalThis.fetch;
  // Every launch's disk: a launch the test closed still finishes what it was downloading, as a
  // killed process would simply never ask; serving it keeps that stale launch from failing loudly.
  const disks = [disk];
  let lastRequest = 0;
  const jobs = new Map<string, { body: Record<string, unknown>; polls: number; cancelled?: boolean; failed?: string }>();
  let activeVideo: string | null = null;
  let held = false;
  let previews = false;
  const state: DesktopVideoJobs = {
    submissions: [],
    cancels: [],
    showPreviews: () => {
      previews = true;
    },
    failRunning: message => {
      for (const job of jobs.values()) if (!job.cancelled) job.failed = message;
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
    useDisk: next => {
      disks.push(next);
    },
    lastRequestAt: () => lastRequest,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== DESKTOP_VIDEO_ENDPOINT) return original(input, init);
    lastRequest = Date.now();
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = `${method} ${url.pathname}`;
    if (route === 'GET /v1/models') return json({ object: 'list', data: [] });
    if (route === 'GET /v1/models/catalog') {
      return json({
        kinds: ['text', 'vision', 'image', 'video', 'speech', 'transcription'],
        models: [{ ...DESKTOP_VIDEO_MODEL, kind: 'video', org: 'Wan-AI', tags: [], files: [] }],
      });
    }
    if (route === 'GET /v1/models/installed') return json({ installed: [DESKTOP_VIDEO_MODEL.id] });
    if (route === 'GET /v1/models/active') {
      return json({ text: null, image: null, video: activeVideo, speech: null, transcription: null });
    }
    if (route === 'POST /v1/models/activate') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { id?: string; kind?: string };
      const known = body.kind === 'video' && body.id === DESKTOP_VIDEO_MODEL.id;
      if (known) activeVideo = DESKTOP_VIDEO_MODEL.id;
      return json({ success: known });
    }
    if (route === 'GET /v1/videos/models') {
      // Desktop publishes each installed model's limits; this one can start from a picture.
      return json({ object: 'list', data: [{ ...videoModelInfo(DESKTOP_VIDEO_MODEL.id), supported_frame_images: ['first_frame'] }] });
    }
    if (route === 'POST /v1/videos') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      state.submissions.push(body);
      const id = String(body.client_job_id);
      // The same client_job_id recovers the job Desktop already has; it never starts a second clip.
      if (!jobs.has(id)) jobs.set(id, { body, polls: 0 });
      return json(videoObject(id, body, { status: 'queued', progress: 0 }));
    }
    const thumbnail = url.pathname.match(/^\/v1\/videos\/([^/]+)\/content$/);
    if (thumbnail && method === 'GET' && url.searchParams.get('variant') === 'thumbnail') {
      // Desktop streams the running job's first decoded frame as a PNG (gateway.ts, variant thumbnail).
      const job = jobs.get(decodeURIComponent(thumbnail[1]));
      if (!job || !previews || job.cancelled || job.failed)
        return json({ error: { message: 'Video preview is not available.', type: 'invalid_request_error' } }, 404);
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
      });
    }
    const poll = url.pathname.match(/^\/v1\/videos\/([^/]+)$/);
    if (poll && method === 'DELETE') {
      const id = decodeURIComponent(poll[1]);
      const job = jobs.get(id);
      if (!job) return json({ error: { message: `No video with id '${id}'.`, type: 'not_found' } }, 404);
      job.cancelled = true;
      state.cancels.push(id);
      return json({ id, object: 'video.deleted', deleted: true });
    }
    if (poll && method === 'GET') {
      const id = decodeURIComponent(poll[1]);
      const job = jobs.get(id);
      if (!job) return json({ error: { message: 'Video job was not found.', type: 'not_found' } }, 404);
      job.polls += 1;
      // Desktop reports a stop as a failed video whose error code is `cancelled`.
      if (job.failed) {
        return json(videoObject(id, job.body, { status: 'failed', error: { code: 'server_error', message: job.failed } }));
      }
      if (job.cancelled) {
        return json(videoObject(id, job.body, { status: 'failed', error: { code: 'cancelled', message: 'Video generation stopped.' } }));
      }
      if (job.polls === 1 || held) {
        return json(videoObject(id, job.body, {
          status: 'in_progress',
          progress: 25,
          stage: 'generating',
          step_progress: { step: 1, total: 4 },
          preview: previews ? { width: 320, height: 192 } : null,
        }));
      }
      const contentUrl = `${DESKTOP_VIDEO_ENDPOINT}/v1/videos/${id}/content`;
      for (const fs of disks) fs.serveRemoteFile(contentUrl, { body: 'mp4-bytes' });
      // Desktop returns its job output without the local path (VideoGenerationOutputContract).
      const { prompt, negative_prompt: negativePrompt, frames, fps, steps, guidance, seed } = job.body;
      const [width, height] = String(job.body.size).split('x').map(Number);
      return json(videoObject(id, job.body, {
        status: 'completed',
        progress: 100,
        completed_at: Math.floor(Date.now() / 1000),
        result: {
          prompt, negativePrompt, width, height, frames, fps, steps, guidance, seed,
          model: DESKTOP_VIDEO_MODEL.id,
          durationSeconds: Number(frames) / Number(fps),
          syncId: `desktop-video-${id}`,
          durationMs: 4200,
          url: `/v1/videos/${id}/content`,
        },
      }));
    }
    return json({ error: { message: 'Unknown endpoint', type: 'not_found' } }, 404);
  }) as typeof globalThis.fetch;
  return state;
}
