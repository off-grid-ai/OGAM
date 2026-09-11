/**
 * RED-FLOW (UI, rendered) — V2 at the pixel: the REAL DownloadManagerScreen shows a truncated whisper
 * file as a downloaded-model card the user can tap. Mounts the real screen over the stateful in-memory
 * filesystem; the REAL whisperService + useVoiceDownloadItems + the screen's cards render.
 *
 * Method note: waitFor a VALID card first (proves the async list actually loaded), THEN assert the
 * truncated file is absent — otherwise asserting absence passes instantly for the wrong reason.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

let applicationFixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = null;
});

describe('V2 (rendered) — truncated whisper file shows as a downloaded card', () => {
  it('renders no downloaded-model card for a truncated whisper file (but does for a valid one)', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const dir = `${boundary.fs!.DocumentDirectoryPath}/whisper-models`;
    boundary.fs!.seedFile(`${dir}/ggml-tiny.en.bin`, 75 * 1024 * 1024); // valid
    boundary.fs!.seedFile(`${dir}/ggml-base.en.bin`, 5 * 1024 * 1024); // truncated (< MIN_MODEL_FILE_SIZE)

    const React = require('react');
    const { render, waitFor } = requireRTL();
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    const {
      DownloadManagerScreen,
    } = require('../../../src/screens/DownloadManagerScreen');

    applicationFixture = await startMobileApplicationFixture({ pro: true });
    await applicationFixture.refreshModels();

    const view = render(React.createElement(DownloadManagerScreen, {}));

    // The valid catalog model renders. This also proves the async Shared inventory refresh finished.
    await waitFor(() => {
      expect(view.queryByText('Tiny')).not.toBeNull();
    });

    // The truncated Base artifact never becomes an installed catalog row, so no corrupt card appears.
    expect(view.queryByText('Base')).toBeNull();
  });
});
