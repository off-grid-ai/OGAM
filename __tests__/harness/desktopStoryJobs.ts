/**
 * Off Grid AI Desktop rendering a whole film, at the network boundary (fetch + the RNFS download),
 * layered over the other Desktop fakes (serveDesktopVideoJobs / serveDesktopModelPulls).
 *
 * Wire shapes are Desktop's own (desktop/pro/main/video/studio/gateway.ts, storyGatewayRoute):
 * POST /v1/stories answers 202 { request_id: story.id, object: 'story', status: 'queued', poll_url };
 * GET /v1/stories/{id} is { request_id, object: 'story', status, story, progress? , error? , content_url? }
 * where status is the shared VideoStoryStatus ('queued' | 'rendering' | 'done' | 'failed' | 'cancelled'),
 * `story.shots[].status` the shared VideoShotStatus ('pending' … 'final'), `progress` Desktop's
 * StudioProgress ({ phase, shot, fraction }) and `error` { message, type };
 * POST /v1/stories/{id}/cancel answers { cancelled }; GET /v1/stories/{id}/content is the MP4.
 *
 * A film really runs: each poll moves it one shot on, until every shot is final and the film is done.
 * `hold()` keeps it where it is, so a test can see it in flight; `release()` lets it go on.
 * `failNext(message)` makes the next film fail on the computer, the way Desktop reports a failure.
 * `goSilent()` is a computer that stops answering: every film request waits until the phone closes it (a
 * cancel, sent with nothing to close it, never ends). `answer()` brings it back.
 */
import type { NativeFileSystemBoundary } from './nativeFileSystem';
import { DESKTOP_VIDEO_ENDPOINT } from './desktopVideoServer';

interface Film {
  story: { id: string; shots: Array<Record<string, unknown>> } & Record<string, unknown>;
  done: number;
  status: 'queued' | 'rendering' | 'done' | 'failed' | 'cancelled';
  error?: string;
}

export interface DesktopStoryJobs {
  /** Every story body the phone sent (POST /v1/stories). */
  submissions: Array<Record<string, unknown>>;
  /** Every film the phone asked Desktop to stop. */
  cancels: string[];
  hold: () => void;
  release: () => void;
  failNext: (message: string) => void;
  goSilent: () => void;
  answer: () => void;
  restore: () => void;
  /** After a relaunch: film downloads are served to the new launch's disk too. Films carry on. */
  useDisk: (fs: NativeFileSystemBoundary) => void;
  /** When the phone last asked this fake anything (ms since epoch), so a test can end once it is quiet. */
  lastRequestAt: () => number;
}

export function serveDesktopStoryJobs(disk: NativeFileSystemBoundary): DesktopStoryJobs {
  const inner = globalThis.fetch;
  // Every launch's disk: a launch the test closed still finishes what it was downloading, as a
  // killed process would simply never ask; serving it keeps that stale launch from failing loudly.
  const disks = [disk];
  let lastRequest = 0;
  const films = new Map<string, Film>();
  let held = false;
  let failure: string | null = null;
  let silent = false;
  const state: DesktopStoryJobs = {
    submissions: [],
    cancels: [],
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
    },
    failNext: message => {
      failure = message;
    },
    goSilent: () => {
      silent = true;
    },
    answer: () => {
      silent = false;
    },
    restore: () => {
      globalThis.fetch = inner;
    },
    useDisk: next => {
      disks.push(next);
    },
    lastRequestAt: () => lastRequest,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const errBody = (message: string, type = 'invalid_request_error') => ({ error: { message, type } });
  const advance = (film: Film) => {
    if (held || film.status === 'done' || film.status === 'failed' || film.status === 'cancelled') return;
    if (failure) {
      film.status = 'failed';
      film.error = failure;
      failure = null;
      return;
    }
    film.status = 'rendering';
    film.done = Math.min(film.story.shots.length, film.done + 1);
    if (film.done === film.story.shots.length) film.status = 'done';
  };
  const view = (film: Film) => ({
    ...film.story,
    status: film.status,
    shots: film.story.shots.map((shot, index) => ({ ...shot, status: index < film.done ? 'final' : 'pending' })),
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== DESKTOP_VIDEO_ENDPOINT) return inner(input, init);
    lastRequest = Date.now();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (silent && url.pathname.startsWith('/v1/stories')) {
      if (url.pathname.endsWith('/cancel')) state.cancels.push(url.pathname.split('/')[3]);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      });
    }
    if (url.pathname === '/v1/stories' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { story: Film['story'] };
      state.submissions.push(body as unknown as Record<string, unknown>);
      const id = body.story.id;
      if (!films.has(id) || films.get(id)!.status !== 'rendering') films.set(id, { story: body.story, done: 0, status: 'queued' });
      return json({ request_id: id, object: 'story', status: 'queued', poll_url: `/v1/stories/${id}` }, 202);
    }
    const match = /^\/v1\/stories\/([A-Za-z0-9_-]{8,100})(?:\/(content|captions|cancel))?$/.exec(url.pathname);
    if (!match) return inner(input, init);
    const film = films.get(match[1]);
    if (!film) return json(errBody('Story not found.', 'not_found'), 404);
    const action = match[2];
    if (!action && method === 'GET') {
      advance(film);
      const contentUrl = `/v1/stories/${film.story.id}/content`;
      if (film.status === 'done') for (const fs of disks) fs.serveRemoteFile(`${DESKTOP_VIDEO_ENDPOINT}${contentUrl}`, { body: 'film-mp4-bytes' });
      const running = film.status === 'queued' || film.status === 'rendering';
      return json({
        request_id: film.story.id,
        object: 'story',
        status: film.status,
        story: view(film),
        ...(running
          ? { progress: { phase: 'clips', shot: film.done, fraction: film.done / film.story.shots.length } }
          : {}),
        ...(film.error ? { error: { message: film.error, type: 'server_error' } } : {}),
        ...(film.status === 'done' ? { content_url: contentUrl } : {}),
      });
    }
    if (action === 'cancel' && method === 'POST') {
      state.cancels.push(film.story.id);
      const cancelled = film.status === 'queued' || film.status === 'rendering';
      if (cancelled) film.status = 'cancelled';
      return json({ cancelled });
    }
    return inner(input, init);
  }) as typeof globalThis.fetch;
  return state;
}
