import type { DownloadedModelRecord } from '@offgrid/models';
import { installNativeBoundary } from '../../../harness/nativeBoundary';

describe('Mobile downloaded-model registry adapter', () => {
  it('registers a finalized transcription artifact through the Whisper disk owner', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const { createMobileDownloadedModelRegistryAdapter } =
      require('../../../../src/services/adapters/downloads/downloadedModelRegistryAdapter') as typeof import('../../../../src/services/adapters/downloads/downloadedModelRegistryAdapter');
    const adapter = createMobileDownloadedModelRegistryAdapter();
    const record: DownloadedModelRecord = {
      id: 'whisper-base-en-package',
      familyId: 'ggerganov/whisper.cpp',
      name: 'Whisper Base English',
      kind: 'transcription',
      files: ['whisper-models/ggml-base.en.bin'],
    };
    boundary.fs!.seedFile(
      '/docs/whisper-models/ggml-base.en.bin',
      75 * 1024 * 1024,
    );
    if (!('capture' in adapter))
      throw new Error('Expected the rich Mobile registry adapter.');

    const snapshot = await adapter.capture({
      familyId: record.familyId!,
      kind: record.kind,
    });
    await adapter.apply({ record });

    await expect(adapter.contains({ record })).resolves.toBe(true);
    await expect(adapter.restore(snapshot)).resolves.toBeUndefined();
  });
});
