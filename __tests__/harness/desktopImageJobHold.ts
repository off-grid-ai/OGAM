/**
 * Off Grid AI Desktop's image gateway with ONE job that stays running until the test lets it end.
 *
 * Model management (catalog, installed, active, activate) is answered by serveDesktopImageJobs, so the
 * real remote-model picker works unchanged (chooseDesktopImageModel). This layer owns the job itself:
 *  - POST /v1/images/generations (async) answers 202 { request_id } and records the submission;
 *  - the FIRST poll GET /v1/requests/{id} answers `running` with progress 1/4;
 *  - every later poll is held open: the job is still running on Desktop;
 *  - DELETE /v1/requests/{id} is Desktop's cancel: it records the id and answers
 *    { request_id, status: 'failed', cancelled: true } (Desktop's own cancel shape).
 *
 * `honorsStop: true` — a held poll ends when the phone aborts it, as a real socket does.
 * `honorsStop: false` — the held poll ignores the abort; `finish()` then answers it `completed` with an
 * image, which is the job finishing at the same moment the user pressed Stop.
 */
import { DESKTOP_IMAGE_ENDPOINT, serveDesktopImageJobs } from './remoteImageServer';

/** A real 1x1 PNG, as Desktop returns it in a completed job's `result.data[0].b64_json`. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export interface HeldDesktopImageJob {
  /** Every request Desktop received for image jobs, as `METHOD /path`, in order. */
  requests: string[];
  /** Job ids Desktop received a cancel (DELETE) for. */
  cancels: string[];
  /** True while a poll is held open on Desktop. */
  held: () => boolean;
  /** Answer the held poll: the job completed with an image. */
  finish: () => void;
  restore: () => void;
}

export function holdDesktopImageJob(options: { honorsStop: boolean }): HeldDesktopImageJob {
  const management = serveDesktopImageJobs({ memoryReason: 'unused' });
  const underlying = globalThis.fetch;
  const polls = new Map<string, number>();
  const waiting: Array<() => void> = [];
  let submissions = 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const state: HeldDesktopImageJob = {
    requests: [],
    cancels: [],
    held: () => waiting.length > 0,
    finish: () => { waiting.splice(0).forEach(answer => answer()); },
    restore: () => { globalThis.fetch = underlying; management.restore(); },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    const method = (init?.method ?? 'GET').toUpperCase();
    const job = url.pathname.match(/^\/v1\/requests\/([^/]+)$/);
    const isSubmit = method === 'POST' && url.pathname === '/v1/images/generations';
    if (url.origin !== DESKTOP_IMAGE_ENDPOINT || (!isSubmit && !job)) return underlying(input, init);
    if (init?.signal?.aborted) throw new Error('Aborted');
    state.requests.push(`${method} ${url.pathname}`);

    if (isSubmit) {
      submissions += 1;
      const id = `img-${submissions}`;
      return json({ request_id: id, object: 'request', kind: 'image', status: 'queued', poll_url: `/v1/images/${id}` }, 202);
    }
    const id = decodeURIComponent(job![1]);
    const base = { request_id: id, object: 'request', kind: 'image', poll_url: `/v1/images/${id}` };
    if (method === 'DELETE') {
      state.cancels.push(id);
      return json({ request_id: id, status: 'failed', cancelled: true });
    }
    const count = (polls.get(id) ?? 0) + 1;
    polls.set(id, count);
    if (count === 1) return json({ ...base, status: 'running', progress: { step: 1, total: 4 } });
    return new Promise<Response>((resolve, reject) => {
      const answer = () => resolve(json({ ...base, status: 'completed', result: { data: [{ b64_json: PNG_1X1 }] } }));
      if (options.honorsStop) {
        init?.signal?.addEventListener('abort', () => {
          const at = waiting.indexOf(answer);
          if (at >= 0) waiting.splice(at, 1);
          reject(new Error('Aborted'));
        }, { once: true });
      }
      waiting.push(answer);
    });
  }) as typeof globalThis.fetch;
  return state;
}
