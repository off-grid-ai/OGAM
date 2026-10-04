/**
 * Projector sidecars belong to their vision-model download. They must never
 * appear as independent downloads in the Mobile projection.
 *
 * This journey enters through the native and durable boundaries, refreshes
 * the public Shared application facade, and observes the real Mobile store.
 */
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary, MB } from '../../harness/nativeBoundary';

let applicationFixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = null;
});

describe('vision download projection', () => {
  it.each(['vision-Q4_K_M-projector.gguf', 'vision-Q4_K_M-clip.gguf'])(
    'does not project %s as a standalone model download',
    async projectorFileName => {
      const boundary = installNativeBoundary({ download: true, fs: true });
      const { seedMobileDownloadJournal, startMobileApplicationFixture } =
        require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');

      boundary.download!.seedActive({
        downloadId: 'dl-model',
        modelId: 'author/vision-model',
        fileName: 'vision-Q4_K_M.gguf',
        modelType: 'text',
        status: 'running',
        bytesDownloaded: 500 * MB,
        totalBytes: 1000 * MB,
      });
      boundary.download!.seedActive({
        downloadId: 'dl-projector',
        modelId: 'author/vision-model',
        fileName: projectorFileName,
        modelType: 'text',
        status: 'running',
        bytesDownloaded: 100 * MB,
        totalBytes: 200 * MB,
      });

      await seedMobileDownloadJournal([
        {
          manifest: {
            id: 'author/vision-model',
            modelId: 'author/vision-model',
            kind: 'text',
            revision: 'main',
            artifacts: [
              {
                id: 'primary',
                name: 'vision-Q4_K_M.gguf',
                role: 'primary',
                required: true,
                localName: 'vision-Q4_K_M.gguf',
                url: 'https://example.test/vision-Q4_K_M.gguf',
              },
            ],
          },
          phase: 'downloading',
          artifacts: [
            {
              artifactId: 'primary',
              phase: 'downloading',
              transferId: 'dl-model',
              bytesDownloaded: 500 * MB,
              totalBytes: 1000 * MB,
            },
          ],
          createdAt: 1,
          updatedAt: 1,
          attempt: 1,
        },
      ]);

      applicationFixture = await startMobileApplicationFixture();
      await applicationFixture.refreshModels();

      const { useDownloadStore } =
        require('../../../src/stores/downloadStore') as typeof import('../../../src/stores/downloadStore');
      const downloads = useDownloadStore.getState().downloads;
      const projectedFiles = Object.values(downloads).map(
        download => download.fileName,
      );
      expect(projectedFiles).toContain('vision-Q4_K_M.gguf');
      expect(projectedFiles).not.toContain(projectorFileName);
      expect(Object.keys(downloads)).toHaveLength(1);
    },
  );
});
