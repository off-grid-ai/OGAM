/**
 * ModelDownloadService — the single owner of downloads across all model types.
 * Verifies: merged listing, transition detection + [DL-SM] logging, capability-gated
 * ops (refuse, never a dead op), id→provider routing, and subscribe aggregation.
 */
import logger from '../../../src/utils/logger';
import { modelDownloadService } from '../../../src/services/modelDownloadService';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';
import type { DownloadProvider, ModelDownload, ModelDownloadType } from '../../../src/services/modelDownloadService/types';

// The queue of not-yet-started downloads is owned by backgroundDownloadService; the
// service maps a uniform id onto it to cancel a "Queued" row that no provider lists.
jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    getQueuedItems: jest.fn(() => []),
    cancelQueued: jest.fn(() => false),
  },
}));
const mockBg = backgroundDownloadService as unknown as {
  getQueuedItems: jest.Mock;
  cancelQueued: jest.Mock;
};

jest.spyOn(logger, 'log').mockImplementation(() => {});

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
  modelDownloadService._reset();
  (logger.log as jest.Mock).mockClear();
  mockBg.getQueuedItems.mockReset().mockReturnValue([]);
  mockBg.cancelQueued.mockReset().mockReturnValue(false);
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

    const lines = (logger.log as jest.Mock).mock.calls.map(c => c[0]).filter((l: string) => l.includes('[DL-SM] text:a'));
    expect(lines.some((l: string) => l.includes('new → downloading'))).toBe(true);
    expect(lines.some((l: string) => l.includes('downloading → completed'))).toBe(true);
  });

  it('logs when a download disappears (removed)', async () => {
    const p = makeProvider('text', [dl('text:a', 'text')]);
    modelDownloadService.register(p);
    await modelDownloadService.list();
    p._set([]);
    await modelDownloadService.list();
    const lines = (logger.log as jest.Mock).mock.calls.map(c => c[0]);
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
    const lines = (logger.log as jest.Mock).mock.calls.map(c => c[0]);
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
    mockBg.getQueuedItems.mockReturnValue([
      { modelKey: 'm/a/a.gguf', modelId: 'm/a', fileName: 'a.gguf', modelType: 'text', totalBytes: 100 },
    ]);
    mockBg.cancelQueued.mockReturnValue(true);
    modelDownloadService.register(makeProvider('text', [dl('text:other', 'text')]));

    await modelDownloadService.cancel('text:m/a/a.gguf');

    // Routed to the queue owner by the SAME uniform id, using the queued item's modelKey.
    expect(mockBg.cancelQueued).toHaveBeenCalledWith('m/a/a.gguf');
    const lines = (logger.log as jest.Mock).mock.calls.map(c => c[0]);
    expect(lines.some((l: string) => l.includes('cancel text:m/a/a.gguf → cancelled queued start'))).toBe(true);
  });

  it('does NOT match a queued text download by its bare-repo id (text:<repo>)', async () => {
    // The bare-repo id is never what the View dispatches; matching it would be the old bug.
    mockBg.getQueuedItems.mockReturnValue([
      { modelKey: 'm/a/a.gguf', modelId: 'm/a', fileName: 'a.gguf', modelType: 'text', totalBytes: 100 },
    ]);
    mockBg.cancelQueued.mockReturnValue(true);
    await modelDownloadService.cancel('text:m/a');
    expect(mockBg.cancelQueued).not.toHaveBeenCalled();
  });

  it('does NOT route retry to the queue (a not-yet-started item cannot be retried)', async () => {
    mockBg.getQueuedItems.mockReturnValue([
      { modelKey: 'm/a/a.gguf', modelId: 'm/a', fileName: 'a.gguf', modelType: 'text', totalBytes: 100 },
    ]);
    await modelDownloadService.retry('text:m/a/a.gguf');
    expect(mockBg.cancelQueued).not.toHaveBeenCalled();
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
    const lines = (logger.log as jest.Mock).mock.calls.map(c => c[0]);
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
    const lines = (logger.log as jest.Mock).mock.calls.map(c => c[0]);
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
});
