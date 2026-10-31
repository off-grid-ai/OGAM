/**
 * Off Grid AI Desktop's model manager, at the network boundary (fetch), layered over another Desktop
 * fake (serveDesktopVideoJobs) that keeps the video job routes.
 *
 * Wire shapes are Desktop's own (desktop/src/main/model-server.ts and models-manager.ts):
 * GET /v1/models/catalog is { kinds, memoryGb, models } (memoryGb absent on an older Desktop);
 * GET /v1/models/installed is { installed }; POST /v1/models/pull { id } answers 202 and starts one
 * download; GET /v1/models/pull/status?id= is the last progress { status, percent, totalBytes } or
 * { status: 'idle' }; POST /v1/models/activate { id, kind } succeeds for an installed model.
 * POST /v1/stories/storyboard { sentence } is the storyboard Desktop writes with no text model loaded
 * (desktop/pro/main/video/studio/gateway.ts): the shared template, marked `source: 'template'`.
 *
 * A download really runs: each status read moves it on, until it completes and its model is installed.
 * `hold()` keeps it where it is, so a test can see it in flight, and `release()` lets it go on.
 * `goSilent()` is a computer that stops answering (asleep, off the network): every request waits until the
 * phone closes it, as a real fetch does, and `answer()` brings it back. `aborted` lists what the phone closed.
 */
import { CATALOG, templateStoryboard } from '@offgrid/models';
import { DESKTOP_VIDEO_ENDPOINT, DESKTOP_VIDEO_MODEL } from './desktopVideoServer';

interface Progress {
  status: 'queued' | 'downloading' | 'completed' | 'failed';
  percent: number;
  totalBytes: number;
}

export interface DesktopModelPulls {
  /** Every POST /v1/models/pull body Desktop received. */
  pulls: Array<{ id: string }>;
  /** What Desktop activated, in order. */
  activations: string[];
  hold: () => void;
  release: () => void;
  /** A model installed on the computer itself (its own Models screen), after the phone last asked. */
  install: (id: string) => void;
  goSilent: () => void;
  answer: () => void;
  /** Requests the phone closed while the computer was silent, as `METHOD /path`. */
  aborted: string[];
  restore: () => void;
}

const PERCENT_PER_READ = 50;

export function serveDesktopModelPulls(options: {
  /** The computer's memory as its catalog reports it; undefined is an older Desktop. */
  memoryGb?: number;
  /** Catalog ids already on the computer. */
  installed?: string[];
  /** A download already running on the computer when the phone first asks. */
  downloading?: { id: string; percent: number };
}): DesktopModelPulls {
  const inner = globalThis.fetch;
  const installed = new Set<string>([DESKTOP_VIDEO_MODEL.id, ...(options.installed ?? [])]);
  const downloads = new Map<string, Progress>();
  let held = false;
  let silent = false;
  let activeVideo: string | null = DESKTOP_VIDEO_MODEL.id;
  const videoEntries = CATALOG.filter(model => model.kind === 'video');
  const sizeOf = (id: string) =>
    videoEntries.find(model => model.id === id)?.files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0) ?? 0;
  if (options.downloading) {
    downloads.set(options.downloading.id, {
      status: 'downloading',
      percent: options.downloading.percent,
      totalBytes: sizeOf(options.downloading.id),
    });
  }
  const state: DesktopModelPulls = {
    pulls: [],
    activations: [],
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
    },
    install: (id: string) => {
      installed.add(id);
    },
    goSilent: () => {
      silent = true;
    },
    answer: () => {
      silent = false;
    },
    aborted: [],
    restore: () => {
      globalThis.fetch = inner;
    },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const advance = (id: string): Progress | undefined => {
    const progress = downloads.get(id);
    if (!progress || held || progress.status === 'completed' || progress.status === 'failed') return progress;
    const percent = Math.min(100, progress.percent + PERCENT_PER_READ);
    const next: Progress = { ...progress, status: percent >= 100 ? 'completed' : 'downloading', percent };
    if (next.status === 'completed') installed.add(id);
    downloads.set(id, next);
    return next;
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== DESKTOP_VIDEO_ENDPOINT) return inner(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = `${method} ${url.pathname}`;
    if (silent) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          state.aborted.push(route);
          reject(new Error('Aborted'));
        }, { once: true });
      });
    }
    if (route === 'GET /v1/models/catalog') {
      return json({
        kinds: ['text', 'vision', 'image', 'video', 'speech', 'transcription'],
        ...(options.memoryGb === undefined ? {} : { memoryGb: options.memoryGb }),
        models: [
          { ...DESKTOP_VIDEO_MODEL, kind: 'video', org: 'Wan-AI', tags: [], files: [] },
          ...videoEntries.map(model => ({ id: model.id, name: model.name, kind: 'video', files: model.files })),
        ],
      });
    }
    if (route === 'GET /v1/models/installed') return json({ installed: [...installed] });
    if (route === 'GET /v1/models/active') {
      return json({ text: null, image: null, video: activeVideo, speech: null, transcription: null });
    }
    if (route === 'POST /v1/models/activate') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { id?: string; kind?: string };
      const known = body.kind === 'video' && !!body.id && installed.has(body.id);
      if (known) {
        activeVideo = body.id!;
        state.activations.push(body.id!);
      }
      return json(known ? { success: true } : { success: false, error: 'Model is not installed.' }, known ? 200 : 400);
    }
    if (route === 'POST /v1/models/pull') {
      const { id } = JSON.parse(String(init?.body ?? '{}')) as { id: string };
      state.pulls.push({ id });
      if (!downloads.has(id) || downloads.get(id)!.status === 'failed')
        downloads.set(id, { status: 'queued', percent: downloads.get(id)?.percent ?? 0, totalBytes: sizeOf(id) });
      return json({ status: 'started', id, poll: `/v1/models/pull/status?id=${encodeURIComponent(id)}` }, 202);
    }
    if (route === 'POST /v1/stories/storyboard') {
      const { sentence } = JSON.parse(String(init?.body ?? '{}')) as { sentence: string };
      return json({ ...templateStoryboard(sentence.trim()), source: 'template' });
    }
    if (route === 'GET /v1/models/pull/status') {
      const progress = advance(url.searchParams.get('id') ?? '');
      return json(progress ?? { status: 'idle' });
    }
    return inner(input, init);
  }) as typeof globalThis.fetch;
  return state;
}
