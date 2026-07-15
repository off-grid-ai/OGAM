/**
 * RED-FLOW (UI, rendered) — V1 at the pixel: on the REAL DownloadManagerScreen, deleting an unrelated
 * (already-downloaded) whisper model aborts an in-flight download, whose card then vanishes after the
 * next foreground re-hydrate.
 *
 * Native cancel emits no terminal event, so the card only reflects the abort on the next
 * hydrateDownloadStore (foregrounding). To avoid a false-green from "re-hydrate just empties everything",
 * a CONTROL asserts an uncancelled download SURVIVES the same re-hydrate. Real DownloadManagerScreen +
 * real whisperService + real hydrate over the download-native + memfs fakes.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

async function setup() {
  const boundary = installNativeBoundary({ download: true, fs: true });
  /* eslint-disable @typescript-eslint/no-var-requires */
  const React = require('react');
  const rtl = requireRTL();
  const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
  const { whisperService } = require('../../../src/services/whisperService');
  const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
  /* eslint-enable @typescript-eslint/no-var-requires */

  // base.en is downloading (native active row); the service tracks its downloadId.
  boundary.download!.seedActive({ downloadId: 'dl-base', fileName: 'ggml-base.en.bin', modelId: 'base.en', modelType: 'stt', status: 'running', bytesDownloaded: 40 * 1024 * 1024, totalBytes: 142 * 1024 * 1024 });
  (whisperService as unknown as { activeDownloadId: string }).activeDownloadId = 'dl-base';
  // small.en is already downloaded on disk (a completed voice model).
  boundary.fs!.seedFile('/docs/whisper-models/ggml-small.en.bin', 466 * 1024 * 1024);
  await hydrateDownloadStore();
  return { React, rtl, whisperService, hydrateDownloadStore, DownloadManagerScreen };
}

describe('V1 (rendered) — deleting a whisper model aborts an unrelated download', () => {
  it('keeps the in-flight base.en download card after deleting the unrelated small.en', async () => {
    const t = await setup();
    const before = t.rtl.render(t.React.createElement(t.DownloadManagerScreen, {}));
    await t.rtl.waitFor(() => { expect(before.queryByText(/ggml-base\.en\.bin/)).not.toBeNull(); });
    before.unmount();

    // User deletes the already-downloaded small.en in the Download Manager.
    await t.whisperService.deleteModel('small.en');
    await t.hydrateDownloadStore(); // foreground re-hydrate reflects native state

    const after = t.rtl.render(t.React.createElement(t.DownloadManagerScreen, {}));
    await t.rtl.waitFor(() => { expect(after.queryByText('Download Manager')).not.toBeNull(); });

    // Correct: deleting small.en does not touch base.en — its download card is still there.
    // Today deleteModel cancels the single activeDownloadId (base.en's) → its card vanishes → RED.
    expect(after.queryByText(/ggml-base\.en\.bin/)).not.toBeNull();
  });

  it('control: without a delete, the base.en download card SURVIVES the re-hydrate', async () => {
    const t = await setup();
    // No delete — just a foreground re-hydrate.
    await t.hydrateDownloadStore();
    const view = t.rtl.render(t.React.createElement(t.DownloadManagerScreen, {}));
    await t.rtl.waitFor(() => { expect(view.queryByText(/ggml-base\.en\.bin/)).not.toBeNull(); });
    // Proves the RED above is caused by the delete-induced cancel, not re-hydrate emptying the list.
    expect(view.queryByText(/ggml-base\.en\.bin/)).not.toBeNull();
  });
});
