/**
 * Render the real Whisper picker over the real Mobile application and Shared download owner.
 * Native download and filesystem behavior are the only faked boundaries.
 */
import type { PersistedModelDownload } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

const TOTAL = 142 * 1024 * 1024;
const MODEL_ID = 'base.en';
const FILE_NAME = 'ggml-base.en.bin';
const TRANSFER_ID = 'native-whisper-base';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

function record(
  phase: PersistedModelDownload['phase'],
  options: {
    readonly bytesDownloaded?: number;
    readonly modelId?: string;
    readonly transferId?: string;
  } = {},
): PersistedModelDownload {
  const modelId = options.modelId ?? MODEL_ID;
  const fileName = `ggml-${modelId}.bin`;
  return {
    manifest: {
      id: `whisper-${modelId}/${fileName}`,
      modelId,
      kind: 'transcription',
      revision: 'main',
      artifacts: [
        {
          id: 'primary',
          name: fileName,
          role: 'primary',
          required: true,
          localName: fileName,
          url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${fileName}`,
          sizeBytes: TOTAL,
        },
      ],
    },
    phase,
    artifacts: [
      {
        artifactId: 'primary',
        phase,
        ...(options.transferId ? { transferId: options.transferId } : {}),
        bytesDownloaded: options.bytesDownloaded ?? 0,
        totalBytes: TOTAL,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
  };
}

async function start(
  records: readonly PersistedModelDownload[],
): Promise<void> {
  const { seedMobileDownloadJournal, startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal(records);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
}

function renderPicker() {
  const React = require('react') as typeof import('react');
  const { render } = requireRTL();
  const { WhisperPickerSheet } =
    require('../../../src/components/models/WhisperPickerSheet') as typeof import('../../../src/components/models/WhisperPickerSheet');
  return render(
    React.createElement(WhisperPickerSheet, {
      visible: true,
      onClose: () => undefined,
    }),
  );
}

describe('WhisperPickerSheet uses the Shared transcription download projection', () => {
  it('shows measured transfer progress for the matching model', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: TRANSFER_ID,
      modelId: MODEL_ID,
      fileName: FILE_NAME,
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: Math.round(0.42 * TOTAL),
      totalBytes: TOTAL,
    });
    await start([
      record('downloading', {
        bytesDownloaded: Math.round(0.42 * TOTAL),
        transferId: TRANSFER_ID,
      }),
    ]);

    const view = renderPicker();

    expect(view.getByTestId('whisper-row-progress')).toBeTruthy();
    expect(view.getByText('42%')).toBeTruthy();
  });

  it('uses the explicit queued phase instead of inferring it from bytes', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const active = ['tiny.en', 'small.en', 'medium.en'].map(
      (modelId, index) => {
        const fileName = `ggml-${modelId}.bin`;
        const transferId = `native-whisper-${index}`;
        boundary.download!.seedActive({
          downloadId: transferId,
          modelId,
          fileName,
          modelType: 'stt',
          status: 'running',
          bytesDownloaded: 1,
          totalBytes: TOTAL,
        });
        return record('downloading', {
          bytesDownloaded: 1,
          modelId,
          transferId,
        });
      },
    );
    await start([...active, record('queued')]);

    const view = renderPicker();

    expect(view.getByTestId('whisper-row-queued')).toBeTruthy();
  });

  it('renders the canonical transcription failure when disk reconciliation fails', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    await start([]);
    boundary.fs!.module.exists.mockRejectedValueOnce(
      new Error('Model storage is unavailable'),
    );
    const { waitFor } = requireRTL();

    const view = renderPicker();

    await waitFor(() => {
      expect(view.getByTestId('model-failure-stt')).toBeTruthy();
      expect(
        view.getByText('Transcription models are unavailable'),
      ).toBeTruthy();
    });
  });
});
