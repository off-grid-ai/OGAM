/**
 * ModelDownloadService — the single owner of downloads across all model types.
 * Verifies: merged listing, transition detection + [DL-SM] logging, capability-gated
 * ops (refuse, never a dead op), id→provider routing, and subscribe aggregation.
 */
import logger from '../../../src/utils/logger';
import { modelDownloadService } from '../../../src/services/modelDownloadService';
import type { DownloadProvider, ModelDownload, ModelDownloadType } from '../../../src/services/modelDownloadService/types';

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

  it('notifies subscribers when a provider reports a change', async () => {
    const p = makeProvider('text', [dl('text:a', 'text')]);
    modelDownloadService.register(p);
    const listener = jest.fn();
    modelDownloadService.subscribe(listener);
    p._onChange?.();
    expect(listener).toHaveBeenCalled();
  });
});
