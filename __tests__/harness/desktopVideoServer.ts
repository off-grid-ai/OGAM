/**
 * Off Grid AI Desktop as the video server, at the network boundary (fetch + the RNFS download).
 *
 * Wire shapes are Desktop's own (desktop/src/main/model-server.ts, startGatewayVideoJob and
 * gatewayVideoJob): POST /v1/videos answers { request_id, status, poll_url }; GET /v1/videos/{id}
 * is the poll { request_id, status, stage, progress, result, error }; a completed result is the
 * shared VideoGenerationResultContract plus `url: /v1/videos/{id}/content`, which the phone
 * downloads. The model switcher is /v1/models/catalog, /installed, /active and /activate.
 */
import type { NativeFileSystemBoundary } from './nativeFileSystem';

export const DESKTOP_VIDEO_ENDPOINT = 'http://192.168.1.62:7878'; // NOSONAR - private LAN test fixture
export const DESKTOP_VIDEO_MODEL = { id: 'wan2.1-1.3b', name: 'Wan 2.1 1.3B' };

export interface DesktopVideoJobs {
  /** Every video submission Desktop received: the JSON body the phone sent. */
  submissions: Array<Record<string, unknown>>;
  /** Every job the phone asked Desktop to stop (POST /v1/videos/:id/cancel). */
  cancels: string[];
  /** Keep every job running (polls answer `running`) until release(). */
  hold: () => void;
  release: () => void;
  restore: () => void;
  /** After a relaunch: content downloads are served to the new launch's disk too. Jobs carry on. */
  useDisk: (fs: NativeFileSystemBoundary) => void;
}

export function serveDesktopVideoJobs(disk: NativeFileSystemBoundary): DesktopVideoJobs {
  const original = globalThis.fetch;
  // Every launch's disk: a launch the test closed still finishes what it was downloading, as a
  // killed process would simply never ask; serving it keeps that stale launch from failing loudly.
  const disks = [disk];
  const jobs = new Map<string, { body: Record<string, unknown>; polls: number; cancelled?: boolean }>();
  let activeVideo: string | null = null;
  let held = false;
  const state: DesktopVideoJobs = {
    submissions: [],
    cancels: [],
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
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== DESKTOP_VIDEO_ENDPOINT) return original(input, init);
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
    if (route === 'POST /v1/videos') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      state.submissions.push(body);
      const id = String(body.client_job_id);
      // The same client_job_id recovers the job Desktop already has; it never starts a second clip.
      if (!jobs.has(id)) jobs.set(id, { body, polls: 0 });
      return json({ request_id: id, object: 'request', kind: 'video', status: 'queued', poll_url: `/v1/videos/${id}` }, 202);
    }
    const cancel = url.pathname.match(/^\/v1\/videos\/([^/]+)\/cancel$/);
    if (cancel && method === 'POST') {
      const id = decodeURIComponent(cancel[1]);
      const job = jobs.get(id);
      if (!job) return json({ error: { message: 'Video job was not found.', type: 'not_found' } }, 404);
      job.cancelled = true;
      state.cancels.push(id);
      return json({ request_id: id, status: 'running', poll_url: `/v1/videos/${id}` });
    }
    const poll = url.pathname.match(/^\/v1\/videos\/([^/]+)$/);
    if (poll && method === 'GET') {
      const id = decodeURIComponent(poll[1]);
      const job = jobs.get(id);
      if (!job) return json({ error: { message: 'Video job was not found.', type: 'not_found' } }, 404);
      job.polls += 1;
      const base = { request_id: id, poll_url: `/v1/videos/${id}` };
      // Desktop records a stop as a failed request whose error type is `cancelled` (pro/main/video/gateway.ts).
      if (job.cancelled) {
        return json({ ...base, status: 'failed', error: { message: 'Video generation stopped.', type: 'cancelled' } });
      }
      if (job.polls === 1 || held) {
        return json({ ...base, status: 'running', stage: 'generating', progress: { step: 1, total: 4 } });
      }
      const contentUrl = `${DESKTOP_VIDEO_ENDPOINT}/v1/videos/${id}/content`;
      for (const fs of disks) fs.serveRemoteFile(contentUrl, { body: 'mp4-bytes' });
      // Desktop returns its job output without the local path (VideoGenerationOutputContract).
      const { prompt, negativePrompt, width, height, frames, fps, steps, guidance, seed } = job.body;
      return json({
        ...base,
        status: 'completed',
        stage: 'encoding',
        result: {
          prompt, negativePrompt, width, height, frames, fps, steps, guidance, seed,
          model: DESKTOP_VIDEO_MODEL.id,
          durationSeconds: Number(frames) / Number(fps),
          syncId: `desktop-video-${id}`,
          durationMs: 4200,
          url: `/v1/videos/${id}/content`,
        },
      });
    }
    return json({ error: { message: 'Unknown endpoint', type: 'not_found' } }, 404);
  }) as typeof globalThis.fetch;
  return state;
}
