/**
 * RED-FLOW (UI, rendered) — an orphaned projector sidecar must NOT hydrate as a phantom model card.
 *
 * A `*-projector.gguf` (equally `*-clip.gguf`) is a multimodal PROJECTOR that rides with a text/vision
 * model — it is never a standalone downloadable model. On relaunch, hydrateDownloadStore rebuilds the
 * download list from the native rows. If a projector sidecar row survives with NO parent back-link
 * (mmProjDownloadId), downloadHydration must classify it as a projector (via the canonical isMMProjFile,
 * which matches mmproj/projector/clip) and DROP it — so the user never sees a bogus model row for it.
 *
 * The old isMmProjFileName only matched 'mmproj', so a '-projector.gguf' sidecar slipped past the
 * projector filter, hydrated as a real DownloadEntry, and rendered as a phantom ActiveDownloadCard on
 * the Download Manager. Revert the fix (match only 'mmproj') and the phantom card reappears → RED.
 *
 * Mounts the real DownloadManagerScreen over the download-native + fs harness (fakes ONLY at the device
 * boundary), calls the real hydrateDownloadStore, and asserts the rendered surface: no card for the
 * projector filename. Modeled on imageExtractLostRelaunch.rendered.redflow.test.tsx.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('orphaned projector sidecar (rendered) — no phantom model on hydrate', () => {
  it('does not surface a `-projector.gguf` sidecar as a model card on the Download Manager', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const React = require('react');
    const { render, waitFor } = requireRTL();
    const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');

    // A projector sidecar left in the native active set with NO parent back-link (mmProjDownloadId):
    // an orphan a relaunch reconcile finds. It is a projector, not a model — must be dropped by hydrate.
    const projectorFileName = 'gemma-4-E2B-it-projector.gguf';
    boundary.download!.seedActive({
      downloadId: 'dl-proj',
      fileName: projectorFileName,
      modelId: 'unsloth/gemma-4-E2B-it-GGUF',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 300 * 1024 * 1024,
      totalBytes: 300 * 1024 * 1024,
    });
    boundary.fs!.seedFile('/docs/models/gemma-4-E2B-it-projector.gguf', 300 * 1024 * 1024);

    await hydrateDownloadStore();

    const view = render(React.createElement(DownloadManagerScreen, {}));
    // Re-render proof: the screen mounted (its title is on screen) before we assert an absence.
    await waitFor(() => { expect(view.queryByText('Download Manager')).not.toBeNull(); });

    // Correct: the projector is classified as a projector, not a model, so NO card shows its filename.
    // Before the fix (isMmProjFileName matched only 'mmproj') the sidecar leaked in as a phantom card → RED.
    expect(view.queryByText(projectorFileName)).toBeNull();
  });
});
