/**
 * Regression: Download Manager "Remove" on an in-flight STT download was a silent no-op.
 * The View dispatched an id the download owner did not list, so the remove was refused and
 * the row survived. Shared now owns download state (`models.snapshot().control.downloads`)
 * and routes `cancel-download` by the durable `downloadId` the projection carries. This
 * drives the REAL Mobile composition root over the REAL Shared coordinator, with fakes only
 * at the native boundary, through the exact id the View row (`facadeDownloadToActiveItem`)
 * produces, and asserts on the Shared projection the screen renders.
 */
import type { PersistedModelDownload } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../harness/nativeBoundary';

const MODEL_ID = 'whisper-medium.en';
const FILE_NAME = 'ggml-medium.en.bin';
const DOWNLOAD_ID = `${MODEL_ID}/${FILE_NAME}`;
const TRANSFER_ID = 'native-stt-medium';
let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

const record = (
  phase: PersistedModelDownload['phase'],
  transferId?: string,
): PersistedModelDownload => ({
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
        sizeBytes: 1000,
      },
    ],
  },
  phase,
  artifacts: [
    {
      artifactId: 'primary',
      phase,
      ...(transferId ? { transferId } : {}),
      bytesDownloaded: 500,
      totalBytes: 1000,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
  attempt: 1,
});

async function startInFlight() {
  const boundary = installNativeBoundary({ download: true, fs: true });
  boundary.download!.seedActive({
    downloadId: TRANSFER_ID,
    modelId: MODEL_ID,
    fileName: FILE_NAME,
    modelType: 'stt',
    status: 'running',
    bytesDownloaded: 500,
    totalBytes: 1000,
  });
  const { seedMobileDownloadJournal, startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal([record('downloading', TRANSFER_ID)]);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
  return boundary;
}

/** The exact rows the Download Manager builds from the Shared snapshot (same mapping as useDownloadManager). */
function viewActiveItems() {
  const { facadeDownloadToActiveItem } =
    require('../../../src/screens/DownloadManagerScreen/downloadItemMapping') as typeof import('../../../src/screens/DownloadManagerScreen/downloadItemMapping');
  return fixture!.application.models
    .snapshot()
    .control.downloads.filter(
      e => e.status !== 'completed' && e.status !== 'cancelled',
    )
    .map(facadeDownloadToActiveItem);
}

describe('STT Remove routing (real composition root + Shared-owned download state)', () => {
  it('removes and clears the in-flight entry through the View-derived Shared id', async () => {
    const boundary = await startInFlight();
    const [item] = viewActiveItems();
    expect(item).toEqual(
      expect.objectContaining({
        downloadId: DOWNLOAD_ID,
        modelId: MODEL_ID,
        fileName: FILE_NAME,
        modelType: 'stt',
        status: 'downloading',
        progress: 0.5,
      }),
    );

    const outcome = await fixture!.application.models.control({
      type: 'cancel-download',
      modelId: item.downloadId ?? item.modelId,
    });
    expect(outcome).toEqual(expect.objectContaining({ ok: true }));
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(
      TRANSFER_ID,
      false,
    );
    expect(boundary.download!.active()).toEqual([]);
    expect(viewActiveItems()).toEqual([]);
    expect(fixture!.application.models.snapshot().control.downloads).toEqual([
      expect.objectContaining({ downloadId: DOWNLOAD_ID, status: 'cancelled' }),
    ]);

    const cleared = await fixture!.application.models.control({
      type: 'clear-download',
      modelId: DOWNLOAD_ID,
    });
    expect(cleared).toEqual(expect.objectContaining({ ok: true }));
    expect(fixture!.application.models.snapshot().control.downloads).toEqual(
      [],
    );
  });
});
