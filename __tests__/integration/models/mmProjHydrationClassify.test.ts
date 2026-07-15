/**
 * DRY / single-owner — the "is this download row a projector?" predicate in downloadHydration must be the
 * canonical isMMProjFile (src/services/mmproj.ts), not a divergent copy.
 *
 * downloadHydration.isMmProjFileName only matched 'mmproj' — it MISSED the 'projector' and 'clip' names the
 * canonical isMMProjFile (introduced by #510 c815752f) also recognises. getParentRows uses that predicate as
 * the belt-and-suspenders filter that drops an ORPHANED projector sidecar row (one whose parent lost its
 * mmProjDownloadId back-link after a retry — see modelManager/restore.ts). With the divergent predicate a
 * '*-projector.gguf' / '*-clip.gguf' sidecar slips through and hydrates as a PHANTOM standalone model entry
 * in the Download Manager.
 *
 * Real hydrateDownloadStore + real downloadStore; only the native backgroundDownloadService snapshot (the
 * device boundary) is faked. Asserts the observable outcome: no phantom projector entry appears in the store.
 */
import { hydrateDownloadStore } from '../../../src/services/downloadHydration';
import { useDownloadStore } from '../../../src/stores/downloadStore';

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: jest.fn(() => true),
    getActiveDownloads: jest.fn(),
  },
}));

const { backgroundDownloadService } = jest.requireMock('../../../src/services/backgroundDownloadService');

beforeEach(() => {
  jest.clearAllMocks();
  backgroundDownloadService.isAvailable.mockReturnValue(true);
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} });
});

describe('downloadHydration classifies a projector sidecar via the canonical isMMProjFile', () => {
  // A vision model download whose projector sidecar row has NO mmProjDownloadId back-link (the post-retry
  // orphan case restore.ts documents) and is named with 'projector' rather than 'mmproj'.
  const snapshotWith = (projectorFileName: string) => [
    {
      downloadId: 'dl-model',
      modelId: 'author/vision-model',
      modelKey: 'author/vision-model/vision-Q4_K_M.gguf',
      fileName: 'vision-Q4_K_M.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 500,
      totalBytes: 1000,
      combinedTotalBytes: 1000,
      createdAt: 1000,
      // no mmProjDownloadId — the back-link was lost, so ONLY the filename predicate can catch the sidecar
    },
    {
      downloadId: 'dl-proj',
      modelId: 'author/vision-model',
      modelKey: `author/vision-model/${projectorFileName}`,
      fileName: projectorFileName,
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 100,
      totalBytes: 200,
      combinedTotalBytes: 200,
      createdAt: 1001,
    },
  ];

  it('a *-projector.gguf sidecar is NOT hydrated as a standalone model entry', async () => {
    backgroundDownloadService.getActiveDownloads.mockResolvedValue(snapshotWith('vision-Q4_K_M-projector.gguf'));

    await hydrateDownloadStore();

    const downloads = useDownloadStore.getState().downloads;
    // The real model row is present…
    expect(downloads['author/vision-model/vision-Q4_K_M.gguf']).toBeDefined();
    // …but the projector sidecar must NOT appear as its own entry.
    expect(downloads['author/vision-model/vision-Q4_K_M-projector.gguf']).toBeUndefined();
  });

  it('a *-clip.gguf sidecar is NOT hydrated as a standalone model entry', async () => {
    backgroundDownloadService.getActiveDownloads.mockResolvedValue(snapshotWith('vision-Q4_K_M-clip.gguf'));

    await hydrateDownloadStore();

    const downloads = useDownloadStore.getState().downloads;
    expect(downloads['author/vision-model/vision-Q4_K_M.gguf']).toBeDefined();
    expect(downloads['author/vision-model/vision-Q4_K_M-clip.gguf']).toBeUndefined();
  });
});
