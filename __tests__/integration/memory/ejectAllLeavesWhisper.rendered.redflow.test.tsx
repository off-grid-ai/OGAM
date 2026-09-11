/**
 * GUARD (UI, rendered) — T023 / DEV-B1 (FIXED): "Eject All" MUST free the whisper (STT) sidecar. On device
 * it used to report "Unloaded 1 model" (the text model) while whisper stayed resident at ~1.5GB.
 *
 * HISTORY: `activeModelService.ejectAll()` called `unloadAllModels(true)` and counted/unloaded only text +
 * image (`count = (textUnloaded?1:0)+(imageUnloaded?1:0)`); the whisper/tts SIDECARS registered with
 * modelResidencyManager were never unloaded → they survived an "eject all". FIXED by iterating the remaining
 * residents through modelResidencyManager.evictByKey after unloadAllModels. This guard locks the fix — revert
 * the eviction loop and whisper stays resident → red. (The Home button's own guard `useHomeScreen.ts:166`
 * also ignores sidecars — it only fires when a text/image model is active — which both masks and compounds
 * this.)
 *
 * Arrival is REAL: whisper is made resident by the SAME real download gesture as T022 (tap the download
 * button on the real TranscriptionModelsTab, drive the native DownloadComplete, then select and load through
 * the Models facade. The TRIGGER is the same Shared `models.eject()` command used by the Home "Eject All"
 * button. Driving the owning application command directly (documented arrival-heavy exception)
 * isolates the residency invariant: the button's `activeModelId||activeImageModelId` guard would otherwise
 * force us to co-load a second model that is irrelevant to the sidecar-eviction bug.
 *
 * Assertion is on the UI (ResidentsProbe over the real Shared residency projection): after eject, whisper is NO
 * LONGER resident → GREEN. Product-correct: eject frees ALL resident models incl. sidecars. Falsify: remove
 * ejectAll's sidecar-eviction loop → whisper survives → red.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

let applicationFixture: import('../../harness/mobileApplicationFixture').MobileApplicationFixture | undefined;
afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = undefined;
});

describe('T023 (rendered) — Eject All frees the whisper sidecar (DEV-B1, fixed)', () => {
  it('frees the whisper sidecar on ejectAll', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true, whisper: true });
    const { startMobileApplicationFixture } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    applicationFixture = await startMobileApplicationFixture({ pro: true });
     
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { TranscriptionModelsTab } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
    const { ResidentsProbe } = require('../../harness/ResidentsProbe');
    const { loadTranscriptionModel, refreshTranscriptionModels, selectTranscriptionModel } = require('../../../src/services/transcriptionModelApplication') as typeof import('../../../src/services/transcriptionModelApplication');
     

    const ui = render(
      React.createElement(React.Fragment, null,
        React.createElement(TranscriptionModelsTab, {}),
        React.createElement(ResidentsProbe, {})),
    );

    // Arrive at whisper-resident the real way (T023's DEV-B1 precondition), via the download gesture.
    await act(async () => { fireEvent.press(ui.getByTestId('transcription-model-card-0-download')); await Promise.resolve(); });
    await waitFor(() => { expect(boundary.download!.active().length).toBeGreaterThan(0); });
    const row = boundary.download!.active()[0];
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {
      boundary.fs!.seedFile('/docs/whisper-models/ggml-tiny.en.bin', 75 * 1024 * 1024);
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
        bytesDownloaded: 75 * 1024 * 1024,
        totalBytes: 75 * 1024 * 1024,
        status: 'completed', localUri: '/docs/whisper-models/ggml-tiny.en.bin',
      });
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    // Post-T022 fix a download no longer AUTO-LOADS whisper (that phantom-on-download was the bug). Whisper
    // now becomes resident on-demand — the transcribe path (ensureWhisperForTranscription) or the launch
    // preload both call the Models facade. Drive that same real load to reach the resident precondition.
    // (Arrival-heavy exception — this test's focus is ejectAll freeing the sidecar, not the load path, which
    // is exactly why it also drives the Shared eject command directly below.)
    await act(async () => {
      const refreshed = await refreshTranscriptionModels();
      expect(refreshed.ok).toBe(true);
      const selected = await selectTranscriptionModel('tiny.en');
      expect(selected.ok).toBe(true);
      const loaded = await loadTranscriptionModel();
      expect(loaded.ok).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
    });

    // Precondition: whisper is resident (so the post-eject check is meaningful).
    await waitFor(() => { expect(ui.getByTestId('probe-residents').props.children).toContain('transcription'); });

    // Trigger the REAL Eject All (the exact function the Home button's onPress calls).
    await act(async () => {
      const ejected = await applicationFixture!.application.models.eject();
      expect(ejected.ok).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
    });

    // SPEC: eject frees ALL resident models, sidecars included. The fix makes whisper drop → GREEN.
    await waitFor(() => {
      expect(ui.getByTestId('probe-residents').props.children).not.toContain('transcription');
    });
  }, 60_000);
});
