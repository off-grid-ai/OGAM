import { installNativeBoundary } from '../../harness/nativeBoundary';

// G6 (docs/RELEASE_571_GAP_FINDINGS.md): a zip image download whose native transfer has completed
// enters a JS-driven unzip/register window ('processing'). Its native row is consumed, so on a
// foreground resume the hydration reconcile would strand the still-processing entry to 'failed'
// (then contradict it with a success alert). The fix marks the in-process registry for the duration
// of the finalize window so the reconcile carries the live entry forward instead of failing it (the
// carry-forward→UI behavior itself is proven end-to-end by the multi-file G5 test — this asserts the
// zip-finalize WIRING that feeds it).

describe('G6 zip finalize marks the in-process registry', () => {
  it('marks the model in-process for the whole unzip/register window and clears it after', async () => {
    const boundary = installNativeBoundary({ download: true });
    // Require post-install so we get the instances wired to this boundary.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { wireZipFinalization } = require('../../../src/screens/ModelsScreen/imageZipFinalization');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isDownloadInProcess } = require('../../../src/services/inProcessDownloadRegistry');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { makeImageModelKey } = require('../../../src/utils/modelKey');

    const MODEL_ID = 'offgrid/sdxl-zip';
    const DOWNLOAD_ID = 'zip-dl-1';
    const KEY = makeImageModelKey(MODEL_ID);

    let inProcessDuringFinalize = false;
    let releaseFinalize: () => void = () => {};
    const finalizeGate = new Promise<void>(resolve => {
      releaseFinalize = resolve;
    });

    wireZipFinalization(
      { downloadId: DOWNLOAD_ID, modelId: MODEL_ID, deps: { setAlertState: () => {} } as never },
      async () => {
        // The unzip/register work is running now — the registry MUST show the model as live.
        inProcessDuringFinalize = isDownloadInProcess(KEY);
        await finalizeGate; // hold the window open, as a real unzip would
      },
    );

    expect(isDownloadInProcess(KEY)).toBe(false); // not yet — native transfer still running

    // Native transfer completes → the finalize window opens.
    boundary.download!.events.emit('DownloadComplete', { downloadId: DOWNLOAD_ID });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(inProcessDuringFinalize).toBe(true); // live for the whole unzip window (survives a resume)

    releaseFinalize();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(isDownloadInProcess(KEY)).toBe(false); // cleared once finalize finished
  });
});
