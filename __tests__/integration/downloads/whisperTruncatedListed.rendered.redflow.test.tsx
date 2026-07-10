/**
 * RED-FLOW (UI, rendered) — V2 at the pixel: the REAL DownloadManagerScreen shows a truncated whisper
 * file as a downloaded-model card the user can tap. Mounts the real screen over the stateful in-memory
 * filesystem; the REAL whisperService + useVoiceDownloadItems + the screen's cards render.
 *
 * Method note: waitFor a VALID card first (proves the async list actually loaded), THEN assert the
 * truncated file is absent — otherwise asserting absence passes instantly for the wrong reason.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('V2 (rendered) — truncated whisper file shows as a downloaded card', () => {
  it('renders no downloaded-model card for a truncated whisper file (but does for a valid one)', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const dir = `${boundary.fs!.DocumentDirectoryPath}/whisper-models`;
    boundary.fs!.seedFile(`${dir}/ggml-tiny.en.bin`, 75 * 1024 * 1024); // valid
    boundary.fs!.seedFile(`${dir}/ggml-base.en.bin`, 5 * 1024 * 1024);  // truncated (< MIN_MODEL_FILE_SIZE)
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, waitFor } = requireRTL();
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    const view = render(React.createElement(DownloadManagerScreen, {}));

    // The valid model renders — this also flushes the async list load.
    await waitFor(() => { expect(view.queryByText(/ggml-tiny\.en\.bin/)).not.toBeNull(); });

    // Correct: the truncated file is NOT surfaced as a downloaded model. Today the DM renders it too
    // (whisperService.listDownloadedModels has no size floor) → the user sees a corrupt "downloaded"
    // card that then fails to load → RED.
    expect(view.queryByText(/ggml-base\.en\.bin/)).toBeNull();
  });
});
