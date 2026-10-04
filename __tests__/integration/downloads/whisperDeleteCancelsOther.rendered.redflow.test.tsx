/**
 * RED-FLOW (UI, rendered) — deleting one whisper model must NOT cancel an unrelated in-flight download.
 *
 * On the REAL DownloadManagerScreen: `small.en` is installed on disk, `base.en` is mid-download. The user
 * taps delete on the small.en card and confirms. The base.en progress card must survive.
 *
 * A CONTROL asserts the same base.en card survives a refresh with NO delete, so a green here cannot come
 * from "the refresh empties the list anyway".
 *
 * Real screen + real hooks + real Shared model coordinator; fakes ONLY at the native boundary
 * (filesystem, native download transfer, whisper).
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

let applicationFixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = null;
});

const MB = 1024 * 1024;

async function arriveAtDownloadManager() {
  const boundary = installNativeBoundary({ fs: true, download: true, whisper: true });

  const React = require('react');
  const rtl = requireRTL();
  const {
    seedMobileDownloadJournal,
    startMobileApplicationFixture,
  } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');

  // small.en is fully installed on disk (>= WHISPER_MIN_BYTES, so Shared verification keeps it).
  const dir = `${boundary.fs!.DocumentDirectoryPath}/whisper-models`;
  boundary.fs!.seedFile(`${dir}/ggml-small.en.bin`, 466 * MB);

  // base.en is mid-flight: a live native transfer plus the durable journal row the coordinator recovers.
  boundary.download!.seedActive({
    downloadId: 'dl-base',
    fileName: 'ggml-base.en.bin',
    modelId: 'base.en',
    modelType: 'stt',
    status: 'running',
    bytesDownloaded: 40 * MB,
    totalBytes: 142 * MB,
  });
  await seedMobileDownloadJournal([
    {
      manifest: {
        id: 'dl-base', modelId: 'base.en', kind: 'transcription', revision: 'main',
        artifacts: [{ id: 'primary', name: 'ggml-base.en.bin', role: 'primary', required: true, localName: 'ggml-base.en.bin', url: 'https://example.com/ggml-base.en.bin' }],
      },
      phase: 'downloading',
      artifacts: [{ artifactId: 'primary', phase: 'downloading', bytesDownloaded: 40 * MB, totalBytes: 142 * MB, transferId: 'dl-base' }],
      createdAt: 1, updatedAt: 1, attempt: 1,
    },
  ]);

  applicationFixture = await startMobileApplicationFixture();
  await applicationFixture.refreshModels();

  const view = rtl.render(React.createElement(DownloadManagerScreen, {}));
  // The in-flight card is on screen — this also proves the async inventory refresh finished.
  await rtl.waitFor(() => {
    expect(view.queryByText(/ggml-base\.en\.bin/)).not.toBeNull();
  });
  return { rtl, view, fixture: applicationFixture };
}

describe('deleting a whisper model must not cancel an unrelated download', () => {
  it('keeps the in-flight base.en download card after deleting the unrelated small.en', async () => {
    const { rtl, view, fixture } = await arriveAtDownloadManager();

    // The installed small.en card is the only completed card — delete it by REAL gesture.
    await rtl.waitFor(() => {
      expect(view.queryByTestId('delete-model-button')).not.toBeNull();
    });
    rtl.fireEvent.press(view.getByTestId('delete-model-button'));

    // Confirm in the real destructive-confirm alert.
    await rtl.waitFor(() => {
      expect(view.queryByText('Delete Transcription Model')).not.toBeNull();
    });
    rtl.fireEvent.press(view.getByText('Delete'));

    // Foreground/refresh so the screen reflects whatever the delete did to native transfer state.
    await rtl.waitFor(() => {
      expect(view.queryByText('Delete Transcription Model')).toBeNull();
    });
    await fixture.refreshModels();

    await rtl.waitFor(() => {
      expect(view.queryByText('Download Manager')).not.toBeNull();
    });
    // Deleting small.en touches nothing of base.en: its download card is still on screen.
    expect(view.queryByText(/ggml-base\.en\.bin/)).not.toBeNull();
  });

  it('control: without a delete, the base.en download card survives the same refresh', async () => {
    const { rtl, view, fixture } = await arriveAtDownloadManager();

    await fixture.refreshModels();

    await rtl.waitFor(() => {
      expect(view.queryByText('Download Manager')).not.toBeNull();
    });
    expect(view.queryByText(/ggml-base\.en\.bin/)).not.toBeNull();
  });
});
