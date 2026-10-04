import type { PersistedModelDownload } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

const MODEL_ID = 'whisper-small.en';
const FILE_NAME = 'ggml-small.en.bin';
const DOWNLOAD_ID = `${MODEL_ID}/${FILE_NAME}`;
const TRANSFER_ID = 'native-whisper-small';
let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
  jest.restoreAllMocks();
});

const persistedDownload: PersistedModelDownload = {
  manifest: {
    id: DOWNLOAD_ID,
    modelId: MODEL_ID,
    kind: 'transcription',
    revision: 'main',
    artifacts: [
      {
        id: 'primary',
        name: FILE_NAME,
        role: 'primary',
        required: true,
        localName: FILE_NAME,
        url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${FILE_NAME}`,
        sizeBytes: 1_000,
      },
    ],
  },
  phase: 'downloading',
  artifacts: [
    {
      artifactId: 'primary',
      phase: 'downloading',
      transferId: TRANSFER_ID,
      bytesDownloaded: 400,
      totalBytes: 1_000,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
  attempt: 1,
};

describe('Download Manager cancellation through the real application', () => {
  it('removes the visible in-flight row and stops its native transfer after confirmation', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: TRANSFER_ID,
      modelId: MODEL_ID,
      fileName: FILE_NAME,
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: 400,
      totalBytes: 1_000,
    });
    const { seedMobileDownloadJournal, startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    await seedMobileDownloadJournal([persistedDownload]);
    fixture = await startMobileApplicationFixture();
    await fixture.refreshModels();

    const { renderHook, act, waitFor } = requireRTL();
    const { useDownloadManager } =
      require('../../../src/screens/DownloadManagerScreen/useDownloadManager') as typeof import('../../../src/screens/DownloadManagerScreen/useDownloadManager');
    const view = renderHook(() => useDownloadManager());

    await waitFor(() =>
      expect(view.result.current.activeItems).toEqual([
        expect.objectContaining({
          downloadId: DOWNLOAD_ID,
          modelId: MODEL_ID,
          status: 'downloading',
        }),
      ]),
    );
    act(() => view.result.current.handleRemoveDownload(view.result.current.activeItems[0]!));
    const confirm = (view.result.current.alertState.buttons ?? []).find(
      button => button.text === 'Yes',
    );
    expect(confirm).toBeDefined();
    await act(async () => confirm!.onPress?.());

    await waitFor(() => expect(view.result.current.activeItems).toEqual([]));
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(
      TRANSFER_ID,
      false,
    );
    expect(boundary.download!.active()).toEqual([]);
    expect(fixture.application.models.snapshot().control.downloads).toEqual([
      expect.objectContaining({ downloadId: DOWNLOAD_ID, status: 'cancelled' }),
    ]);
  });

  it('deletes a downloaded text model from public inventory and native storage after confirmation', async () => {
    const boundary = installNativeBoundary({
      download: true,
      fs: true,
      llama: true,
    });
    const { seedMobileDownloadJournal, startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    await seedMobileDownloadJournal([]);
    fixture = await startMobileApplicationFixture();

    const file = {
      name: 'manager-delete.Q4_K_M.gguf',
      size: 1_024,
      quantization: 'Q4_K_M',
      downloadUrl:
        'https://huggingface.co/author/manager-delete/resolve/main/manager-delete.Q4_K_M.gguf',
    };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        siblings: [{ rfilename: file.name, lfs: { size: file.size } }],
      }),
    } as Response);
    const { startModelDownload } =
      require('../../../src/services/startModelDownload') as typeof import('../../../src/services/startModelDownload');
    await startModelDownload('author/manager-delete', file);
    const transfer = boundary.download!.active()[0];
    expect(transfer).toBeDefined();
    boundary.download!.complete(transfer!.downloadId);

    const { renderHook, act, waitFor } = requireRTL();
    await waitFor(() =>
      expect(
        fixture!.application.models.snapshot().inventory.some(model =>
          model.id.includes('author/manager-delete'),
        ),
      ).toBe(true),
    );
    const { useDownloadManager } =
      require('../../../src/screens/DownloadManagerScreen/useDownloadManager') as typeof import('../../../src/screens/DownloadManagerScreen/useDownloadManager');
    const view = renderHook(() => useDownloadManager());
    const item = await waitFor(() => {
      const match = view.result.current.completedItems.find(
        candidate => candidate.modelType === 'text' &&
          candidate.fileName === file.name,
      );
      expect(match).toBeDefined();
      return match!;
    });
    const path = `${boundary.fs!.DocumentDirectoryPath}/models/${file.name}`;
    expect(await boundary.fs!.exists(path)).toBe(true);

    act(() => view.result.current.handleDeleteItem(item));
    const confirm = (view.result.current.alertState.buttons ?? []).find(
      button => button.text === 'Delete',
    );
    expect(confirm).toBeDefined();
    await act(async () => confirm!.onPress?.());

    await waitFor(() =>
      expect(
        fixture!.application.models.snapshot().inventory.some(
          model => model.id === item.modelId,
        ),
      ).toBe(false),
    );
    expect(await boundary.fs!.exists(path)).toBe(false);
    expect(
      view.result.current.completedItems.some(
        candidate => candidate.modelId === item.modelId,
      ),
    ).toBe(false);
  });
});
