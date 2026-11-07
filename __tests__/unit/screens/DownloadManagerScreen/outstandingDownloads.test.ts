/**
 * outstandingDownloadItems: the ONE rule for "which downloads still need you", rendered by the
 * Download Manager's Active list and counted by the Models tab badge. Pure: real inputs, real output.
 */
import { outstandingDownloadItems } from '../../../../src/screens/DownloadManagerScreen/outstandingDownloads';
import { videoCompletedItems } from '../../../../src/screens/DownloadManagerScreen/downloadItemMapping';
import type { DownloadEntry } from '../../../../src/stores/downloadStore';
import type { DownloadItem } from '../../../../src/screens/DownloadManagerScreen/items';

const entry = (modelKey: string, status: DownloadEntry['status'], over: Partial<DownloadEntry> = {}): DownloadEntry => ({
  modelKey, downloadId: `dl-${modelKey}`, modelId: modelKey.split('/').slice(0, 2).join('/'),
  fileName: modelKey.split('/').pop()!, quantization: 'Q4_K_M', modelType: 'text', status,
  bytesDownloaded: 0, totalBytes: 100, combinedTotalBytes: 100, progress: 0, createdAt: 1, ...over,
});

const row = (over: Partial<DownloadItem>): DownloadItem => ({
  type: 'active', modelType: 'text', modelId: 'x', fileName: 'x', author: '', quantization: '',
  fileSize: 1, bytesDownloaded: 0, progress: 0, status: 'pending', ...over,
});

const ids = (items: DownloadItem[]) => items.map(i => `${i.modelType}:${i.modelId}`);

describe('outstandingDownloadItems', () => {
  it('lists running, paused and failed rows, and drops completed, cancelled and already-downloaded ones', () => {
    const items = outstandingDownloadItems({
      downloads: {
        'o/run/a.gguf': entry('o/run/a.gguf', 'running'),
        'o/pause/b.gguf': entry('o/pause/b.gguf', 'paused'),
        'o/fail/c.gguf': entry('o/fail/c.gguf', 'failed'),
        'o/done/d.gguf': entry('o/done/d.gguf', 'completed'),
        'o/gone/e.gguf': entry('o/gone/e.gguf', 'cancelled'),
        'o/stale/f.gguf': entry('o/stale/f.gguf', 'failed'),
      },
      completed: [{ modelType: 'text', modelId: 'o/stale/f.gguf' }],
    });
    expect(ids(items)).toEqual(['text:o/run/a.gguf', 'text:o/pause/b.gguf', 'text:o/fail/c.gguf']);
  });

  it('adds queued, voice and search rows once per model, never one already started or downloaded', () => {
    const items = outstandingDownloadItems({
      downloads: { 'o/run/a.gguf': entry('o/run/a.gguf', 'running') },
      completed: [
        { modelType: 'text', modelId: 'o/have/q.gguf' },
        { modelType: 'stt', modelId: 'base.en' },
      ],
      queued: [
        row({ modelKey: 'o/run/a.gguf', modelId: 'o/run/a.gguf' }),
        row({ modelKey: 'o/have/q.gguf', modelId: 'o/have/q.gguf' }),
        row({ modelKey: 'o/wait/w.gguf', modelId: 'o/wait/w.gguf' }),
      ],
      voice: [
        row({ modelType: 'tts', modelId: 'kokoro', status: 'downloading' }),
        row({ modelType: 'stt', modelId: 'whisper-base.en', status: 'failed' }),
        row({ type: 'completed', modelType: 'stt', modelId: 'tiny.en', status: 'completed' }),
      ],
      search: [
        row({ modelType: 'embedding', modelId: 'minilm', status: 'running' }),
        row({ type: 'completed', modelType: 'embedding', modelId: 'bge', status: 'completed' }),
      ],
    });
    expect(ids(items)).toEqual(['text:o/run/a.gguf', 'text:o/wait/w.gguf', 'tts:kokoro', 'embedding:minilm']);
  });

  it('counts a downloaded video model as completed, so its stale row is not listed', () => {
    const video = {
      id: 'wan-1.3b', name: 'Wan 1.3B', kind: 'video', downloadedAt: '2026-11-01T00:00:00.000Z',
      files: [{ sizeBytes: 300 }, {}],
    } as unknown as Parameters<typeof videoCompletedItems>[0][number];
    const completed = videoCompletedItems([video]);
    expect(completed[0]).toMatchObject({ modelType: 'video', modelId: 'wan-1.3b', fileSize: 300, author: '', quantization: '' });

    const items = outstandingDownloadItems({
      downloads: { 'video:wan-1.3b': entry('video:wan-1.3b', 'failed', { modelType: 'video', modelId: 'video:wan-1.3b' }) },
      completed,
    });
    expect(items).toEqual([]);
  });

  it('holds back voice and transcription store rows until the models on disk are read (hand test 48)', () => {
    const downloads = {
      'o/run/a.gguf': entry('o/run/a.gguf', 'running'),
      'w/whisper/ggml-base.en.bin': entry('w/whisper/ggml-base.en.bin', 'failed', { modelType: 'stt' as never }),
      't/kokoro/voice.pte': entry('t/kokoro/voice.pte', 'failed', { modelType: 'tts' as never }),
    };
    const unread = outstandingDownloadItems({ downloads, completed: [], voiceKnown: false });
    expect(unread.map(i => i.modelType)).toEqual(['text']);

    const read = outstandingDownloadItems({ downloads, completed: [], voiceKnown: true });
    expect(read.map(i => i.modelType).sort()).toEqual(['stt', 'text', 'tts']);

    // Not told (an older caller): rows show, as before.
    expect(outstandingDownloadItems({ downloads, completed: [] })).toHaveLength(3);
  });

  it('drops a stale failed Whisper row for a model on the phone, whatever kind the old row gave it (hand test 50)', () => {
    const downloads = {
      'ggerganov/whisper.cpp/ggml-tiny.en.bin': entry('ggerganov/whisper.cpp/ggml-tiny.en.bin', 'failed'),
      'ggerganov/whisper.cpp/ggml-base.en.bin': entry('ggerganov/whisper.cpp/ggml-base.en.bin', 'failed'),
    };
    const items = outstandingDownloadItems({
      downloads,
      completed: [{ modelType: 'stt', modelId: 'tiny.en' }],
      voiceKnown: true,
    });
    // Tiny is on the phone: its leftover row goes. Base is not: it stays, as a Speech row keyed by its Whisper id.
    expect(ids(items)).toEqual(['stt:base.en']);
  });
});

