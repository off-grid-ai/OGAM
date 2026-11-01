/**
 * ModelDownloadService — the single owner of downloads across all model types.
 * Verifies: merged listing, transition detection + [DL-SM] logging, capability-gated
 * ops (refuse, never a dead op), id→provider routing, and subscribe aggregation.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import type { DownloadProvider, ModelDownload, ModelDownloadType } from '../../../src/services/modelDownloadService/types';

type ServiceModule = typeof import('../../../src/services/modelDownloadService');
type BackgroundModule = typeof import('../../../src/services/backgroundDownloadService');

// The service and the queue owner (backgroundDownloadService) run for real over the fake native
// downloader. The registered providers below are test providers of the DownloadProvider contract.
// What the service logs is read where the device shows it: console.log (a jest.fn in jest.setup).
let modelDownloadService: ServiceModule['modelDownloadService'];
let backgroundDownloadService: BackgroundModule['backgroundDownloadService'];

const logLines = (): string[] => (console.log as jest.Mock).mock.calls.map(c => String(c[0]));

/** Three downloads hold every slot, so the next start waits in the queue. Returns how that start ends. */
async function queueTextDownload(modelId = 'm/a', fileName = 'a.gguf') {
  for (let i = 0; i < 3; i += 1) {
    await backgroundDownloadService.startDownload({
      url: `https://huggingface.co/busy/${i}/resolve/main/busy-${i}.gguf`, fileName: `busy-${i}.gguf`,
      modelId: `busy/${i}`, modelKey: `busy/${i}/busy-${i}.gguf`, modelType: 'text', totalBytes: 100,
    });
  }
  const queued = backgroundDownloadService.startDownload({
    url: `https://huggingface.co/${modelId}/resolve/main/${fileName}`, fileName, modelId,
    modelKey: `${modelId}/${fileName}`, modelType: 'text', totalBytes: 100,
  });
  const outcome = queued.then(() => 'started', (e: Error) => `refused: ${e.message}`);
  expect(backgroundDownloadService.getQueuedItems().map(q => q.modelKey)).toEqual([`${modelId}/${fileName}`]);
  return { outcome };
}

const CAPS_FULL = { cancel: true, retry: true, remove: true, resumable: true, determinateProgress: true };

function makeProvider(modelType: ModelDownloadType, initial: ModelDownload[]): DownloadProvider & {
  _set: (d: ModelDownload[]) => void; _onChange?: () => void;
  retry: jest.Mock; cancel: jest.Mock; remove: jest.Mock;
} {
  let items = initial;
  const p: any = {
    modelType,
    list: jest.fn(async () => items),
    retry: jest.fn(async () => {}),
    cancel: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
    subscribe: (cb: () => void) => { p._onChange = cb; return () => { p._onChange = undefined; }; },
    _set: (d: ModelDownload[]) => { items = d; },
  };
  return p;
}

const dl = (id: string, modelType: ModelDownloadType, over: Partial<ModelDownload> = {}): ModelDownload => ({
  id, modelType, name: id, sizeBytes: 100, bytesDownloaded: 0, progress: 0,
  status: 'downloading', capabilities: CAPS_FULL, ...over,
});

beforeEach(() => {
  installNativeBoundary({ download: true });
  ({ modelDownloadService } = require('../../../src/services/modelDownloadService') as ServiceModule);
  ({ backgroundDownloadService } = require('../../../src/services/backgroundDownloadService') as BackgroundModule);
  modelDownloadService._reset();
  (console.log as jest.Mock).mockClear();
});

describe('ModelDownloadService', () => {
  it('merges downloads from every registered provider', async () => {
    modelDownloadService.register(makeProvider('text', [dl('text:a', 'text')]));
    modelDownloadService.register(makeProvider('stt', [dl('stt:b', 'stt')]));
    const list = await modelDownloadService.list();
    expect(list.map(d => d.id).sort()).toEqual(['stt:b', 'text:a']);
  });

  it('logs a [DL-SM] line on each status transition', async () => {
    const p = makeProvider('text', [dl('text:a', 'text', { status: 'downloading' })]);
    modelDownloadService.register(p);
    await modelDownloadService.list(); // new → downloading
    p._set([dl('text:a', 'text', { status: 'completed', progress: 1, bytesDownloaded: 100 })]);
    await modelDownloadService.list(); // downloading → completed

    const lines = logLines().filter(l => l.includes('[DL-SM] text:a'));
    expect(lines.some((l: string) => l.includes('new → downloading'))).toBe(true);
    expect(lines.some((l: string) => l.includes('downloading → completed'))).toBe(true);
  });

  it('logs when a download disappears (removed)', async () => {
    const p = makeProvider('text', [dl('text:a', 'text')]);
    modelDownloadService.register(p);
    await modelDownloadService.list();
    p._set([]);
    await modelDownloadService.list();
    const lines = logLines();
    expect(lines.some((l: string) => l.includes('text:a') && l.includes('gone (removed)'))).toBe(true);
  });

  it('routes retry/cancel/remove to the owning provider by id prefix', async () => {
    const text = makeProvider('text', [dl('text:a', 'text')]);
    const stt = makeProvider('stt', [dl('stt:b', 'stt')]);
    modelDownloadService.register(text);
    modelDownloadService.register(stt);
    await modelDownloadService.list();
    await modelDownloadService.retry('text:a');
    await modelDownloadService.remove('stt:b');
    expect(text.retry).toHaveBeenCalledWith('text:a');
    expect(stt.remove).toHaveBeenCalledWith('stt:b');
    expect(text.remove).not.toHaveBeenCalled();
  });

  it('dispatches even with a cold cache (refreshes list, routes by the download modelType)', async () => {
    const text = makeProvider('text', [dl('text:a', 'text')]);
    modelDownloadService.register(text);
    // No list() called first — dispatch must refresh authoritatively, then route.
    await modelDownloadService.retry('text:a');
    expect(text.retry).toHaveBeenCalledWith('text:a');
  });

  it('REFUSES an op when the capability is false (no dead op), and logs it', async () => {
    const tts = makeProvider('tts', [dl('tts:k', 'tts', { capabilities: { ...CAPS_FULL, cancel: false } })]);
    modelDownloadService.register(tts);
    await modelDownloadService.list();
    await modelDownloadService.cancel('tts:k');
    expect(tts.cancel).not.toHaveBeenCalled();
    const lines = logLines();
    expect(lines.some((l: string) => l.includes('cancel tts:k REFUSED'))).toBe(true);
  });

  it('refuses (no throw) when no provider owns the id', async () => {
    await expect(modelDownloadService.retry('image:zzz')).resolves.toBeUndefined();
  });

  it('cancels a queued text download using the SAME id the View dispatches (text:<modelKey>, not text:<repo>)', async () => {
    // A queued text start carries modelId=<repo> but modelKey=<repo/file>. Its started-row
    // id is text:<modelKey> (textProvider.list keys on modelKey), so the View dispatches
    // text:m/a/a.gguf — NOT text:m/a. cancelQueuedStart must match on the modelKey-derived
    // id via queuedUniformId, or cancelling a Queued text row silently no-ops and it
    // downloads anyway. (Before the fix cancelQueuedStart derived text:m/a and missed.)
    const { outcome } = await queueTextDownload();
    modelDownloadService.register(makeProvider('text', [dl('text:other', 'text')]));

    await modelDownloadService.cancel('text:m/a/a.gguf');

    // Routed to the queue owner by the SAME uniform id: the queued start is gone and never begins.
    expect(backgroundDownloadService.getQueuedItems()).toEqual([]);
    expect(await outcome).toMatch(/^refused/);
    expect(logLines().some(l => l.includes('cancel text:m/a/a.gguf → cancelled queued start'))).toBe(true);
  });

  it('does NOT match a queued text download by its bare-repo id (text:<repo>)', async () => {
    // The bare-repo id is never what the View dispatches; matching it would be the old bug.
    await queueTextDownload();
    await modelDownloadService.cancel('text:m/a');
    expect(backgroundDownloadService.getQueuedItems().map(q => q.modelKey)).toEqual(['m/a/a.gguf']);
  });

  it('does NOT route retry to the queue (a not-yet-started item cannot be retried)', async () => {
    await queueTextDownload();
    await modelDownloadService.retry('text:m/a/a.gguf');
    expect(backgroundDownloadService.getQueuedItems().map(q => q.modelKey)).toEqual(['m/a/a.gguf']);
  });

  it('reconcile() lets a provider strand an un-resumable in-flight download as error (app-kill), logged', async () => {
    // iOS-style backend: was downloading when the app was killed, can't resume.
    const p = makeProvider('stt', [dl('stt:base', 'stt', { status: 'downloading', capabilities: { ...CAPS_FULL, resumable: false } })]);
    (p as any).reconcile = jest.fn(async () => {
      p._set([dl('stt:base', 'stt', { status: 'error', error: 'interrupted — retry', capabilities: { ...CAPS_FULL, resumable: false } })]);
    });
    modelDownloadService.register(p);
    await modelDownloadService.list();      // new → downloading
    await modelDownloadService.reconcile(); // provider strands it → downloading → error

    expect((p as any).reconcile).toHaveBeenCalled();
    const lines = logLines();
    expect(lines.some((l: string) => l.includes('stt:base') && l.includes('downloading → error'))).toBe(true);
    expect(lines.some((l: string) => l.includes('reconcile start'))).toBe(true);
  });

  it('reconcile() tolerates a provider without a reconcile hook (resumable backend)', async () => {
    const p = makeProvider('text', [dl('text:a', 'text', { status: 'downloading' })]);
    modelDownloadService.register(p); // no reconcile() defined
    await expect(modelDownloadService.reconcile()).resolves.toBeUndefined();
  });

  it('self-drives transition logging on a provider change WHEN a consumer is subscribed', async () => {
    const p = makeProvider('text', [dl('text:a', 'text', { status: 'downloading' })]);
    modelDownloadService.register(p);
    modelDownloadService.subscribe(() => {}); // a consumer is observing → self-list runs
    p._onChange?.();                           // a progress/status change fires
    await new Promise(r => setTimeout(r, 360));
    const lines = logLines();
    expect(lines.some((l: string) => l.includes('text:a') && l.includes('new → downloading'))).toBe(true);
  });

  it('does NOT self-list (no disk scan) when NO consumer is subscribed — avoids download-time lag', async () => {
    const p = makeProvider('text', [dl('text:a', 'text', { status: 'downloading' })]);
    modelDownloadService.register(p); // no subscriber
    (p.list as jest.Mock).mockClear();
    p._onChange?.(); // progress tick
    await new Promise(r => setTimeout(r, 360));
    expect(p.list).not.toHaveBeenCalled();
  });

  it('notifies subscribers when a provider reports a change', async () => {
    const p = makeProvider('text', [dl('text:a', 'text')]);
    modelDownloadService.register(p);
    const listener = jest.fn();
    modelDownloadService.subscribe(listener);
    p._onChange?.();
    expect(listener).toHaveBeenCalled();
  });

  it('keeps a newer registration when an old cleanup handle runs', async () => {
    const provider = makeProvider('text', [dl('text:a', 'text')]);
    const oldCleanup = modelDownloadService.register(provider);
    const currentCleanup = modelDownloadService.register(provider);
    oldCleanup();
    expect((await modelDownloadService.list()).map(item => item.id)).toEqual(['text:a']);
    currentCleanup();
    expect(await modelDownloadService.list()).toEqual([]);
  });
});
