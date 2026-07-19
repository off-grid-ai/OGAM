/**
 * RED-FLOW (UI, rendered) — T022 / DEV-B1: downloading an STT (whisper) model AUTO-LOADS it resident,
 * even though the user never transcribed anything. A mere download should not consume 1.5GB of RAM.
 *
 * ROOT: `whisperStore.downloadModel` (`whisperStore.ts:96`) does `await get().loadModel()` right after the
 * download completes ("Auto-load after download"), and `loadModel` registers the model with
 * `modelResidencyManager` (key/type 'whisper'). So a download-only flow leaves whisper resident.
 *
 * Real stack over the download + FS + whisper native fakes: mount the REAL TranscriptionModelsTab, tap the
 * REAL download button, drive the REAL native DownloadComplete, and observe the real Models sheet's
 * Speech RAM chip. Product-correct: after a download the user never used, Whisper is NOT shown in
 * memory. RED on the broken implementation: the Speech row gains a RAM chip.
 *
 * Native residue the HUMAN confirms manually (no Provit): that the resident 1.5GB actually causes memory
 * pressure on device. The fake test proves the JS auto-load leak — the necessary condition.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

describe('T022 (rendered) — whisper resident after download-only (DEV-B1)', () => {
  it('does NOT leave whisper resident just from downloading it (never transcribed)', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const {
      TranscriptionModelsTab,
    } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
    const {
      ModelsManagerSheet,
    } = require('../../../src/components/models/ModelsManagerSheet');

    const ui = render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(TranscriptionModelsTab, {}),
        React.createElement(ModelsManagerSheet, {
          visible: true,
          onClose: () => {},
          labels: { text: '—', image: '—', voice: '—', speech: '—' },
          loadingState: { isLoading: false },
          isEjecting: false,
          hasActiveModel: false,
          onOpenRow: () => {},
          onEject: () => {},
        }),
      ),
    );

    // Precondition: the real user-facing Speech row exists with no resident-RAM chip.
    expect(ui.getByTestId('models-row-speech')).toBeTruthy();
    expect(ui.queryByTestId('models-row-speech-ram')).toBeNull();

    // Gesture: tap the download button on the first whisper model card.
    await act(async () => {
      fireEvent.press(ui.getByTestId('transcription-model-card-0-download'));
      await Promise.resolve();
    });

    // The real service started a native download — wait for the native row + the onComplete
    // listener to be wired, THEN complete it the way the OS does.
    await waitFor(() => {
      expect(boundary.download!.active().length).toBeGreaterThan(0);
    });
    const row = boundary.download!.active()[0];
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    }); // let onComplete register
    await act(async () => {
      // A completed native download has WRITTEN the model file to disk — mirror that at the boundary
      // so the auto-load (whisperService.loadModel) finds it (the fake move is a no-op like the OS move).
      boundary.fs!.seedFile(
        '/docs/whisper-models/ggml-tiny.en.bin',
        75 * 1024 * 1024,
      );
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: row.downloadId,
        fileName: row.fileName,
        modelId: row.modelId,
        bytesDownloaded: row.totalBytes ?? 1,
        totalBytes: row.totalBytes ?? 1,
        status: 'running',
      });
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: row.downloadId,
        fileName: row.fileName,
        modelId: row.modelId,
        bytesDownloaded: row.totalBytes ?? 1,
        totalBytes: row.totalBytes ?? 1,
        status: 'completed',
        localUri: '/docs/whisper-models/ggml-tiny.en.bin',
      });
      // let the download promise resolve → whisperStore auto-loads → residency registers
      await new Promise(r => setTimeout(r, 0));
      await new Promise(r => setTimeout(r, 0));
    });

    // P0 download outcome: the real card leaves progress state and no longer offers Download.
    await waitFor(() => {
      expect(ui.getByTestId('transcription-model-card-0')).toBeTruthy();
      expect(
        ui.queryByTestId('transcription-model-card-0-download'),
      ).toBeNull();
    });

    // SPEC: a downloaded-but-never-used STT model is not shown in memory.
    await waitFor(() => {
      expect(ui.queryByTestId('models-row-speech-ram')).toBeNull();
    });
  });
});
