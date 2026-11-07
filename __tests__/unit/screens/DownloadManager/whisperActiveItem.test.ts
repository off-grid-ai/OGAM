import { entryToActiveItem } from '../../../../src/screens/DownloadManagerScreen/downloadItemMapping';
import { downloadDisplayName } from '../../../../src/screens/DownloadManagerScreen/items';

const entry = (fileName: string, modelType: string) =>
  ({ modelKey: `k/${fileName}`, modelId: 'm', fileName, modelType, status: 'failed', progress: 0.2, totalBytes: 75, bytesDownloaded: 15, combinedTotalBytes: 0 }) as any;

describe('a Whisper download in Downloads (hand test 14)', () => {
  it('is a speech model with its name, even when an older record said "text"', () => {
    const item = entryToActiveItem(entry('ggml-tiny.en.bin', 'text'));
    expect(item.modelType).toBe('stt');
    expect(downloadDisplayName(item)).toBe('Whisper Tiny (English)');
  });

  it('leaves other files as they are', () => {
    const item = entryToActiveItem(entry('Qwen3.5-0.8B-Q4_K_M.gguf', 'text'));
    expect(item.modelType).toBe('text');
    expect(downloadDisplayName(item)).toBe('Qwen3.5-0.8B-Q4_K_M');
  });
});
