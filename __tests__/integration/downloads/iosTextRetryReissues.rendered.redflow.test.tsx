/**
 * Rendered red-flow (iOS) — text-download RETRY on the REAL Download Manager. Two device findings
 * (2026-07-15), both fixed in textProvider.retry / restartIosTextDownload:
 *
 *   (a) NO-OP: an app-kill mid-download left a failed card whose STORE entry had lost its
 *       downloadId. retry() bailed on `if (!entry?.downloadId) return` BEFORE the iOS re-issue
 *       path, so downloadModelBackground never fired — every tap was a silent no-op (the device
 *       log showed ~40 retry dispatches and 0 re-downloads). iOS re-issues from scratch and never
 *       needs the old id, so the guard is now Android-only.
 *
 *   (b) FEEDBACK: after retry, an item queued behind the 3-download cap kept showing "failed" with
 *       no signal it was actually queued. iOS retry now marks the entry pending immediately.
 *
 * Mounts the real DownloadManagerScreen over the download-native fake; the jest RN preset reports
 * Platform.OS = 'ios', so retry() takes the iOS (re-issue) branch. Seeding the store directly is the
 * one sanctioned shortcut: the failed/no-downloadId row is a rehydrated-after-app-kill leaf, not a
 * state a user reaches by tapping this session.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

const MB = 1024 ** 2;
const failedTextEntry = (over: Record<string, unknown> = {}) => ({
  modelKey: 'author/model.gguf',
  downloadId: 'dl-main',
  modelId: 'author/model',
  fileName: 'model.gguf',
  quantization: 'Q4_K_M',
  modelType: 'text' as const,
  status: 'failed' as const,
  bytesDownloaded: 100 * MB,
  totalBytes: 1000 * MB,
  combinedTotalBytes: 1000 * MB,
  progress: 0.1,
  createdAt: 1,
  errorMessage: 'The network connection was lost.',
  ...over,
});

describe('iOS text retry (rendered, red-flow)', () => {
  it('re-issues the download on retry even when the store entry lost its downloadId (app-kill)', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true, ram: { platform: 'ios', totalBytes: 8 * 1024 ** 3, availBytes: 6 * 1024 ** 3 } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, waitFor, fireEvent } = requireRTL();
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
    const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
    /* eslint-enable @typescript-eslint/no-var-requires */
    // The service routes retry() to the owning provider — register it (app boot does this; a bare
    // screen render does not, which is why retry was silently REFUSED: not found).
    registerCoreDownloadProviders();

    // The rehydrated app-kill state: a failed text card whose downloadId is gone.
    useDownloadStore.getState().add(failedTextEntry({ downloadId: '' }));

    const view = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => { expect(view.queryByText(/model\.gguf/)).not.toBeNull(); });

    // Pre-condition: nothing is downloading at the native boundary yet (so a false green can't hide).
    expect(boundary.download!.active().length).toBe(0);

    fireEvent.press(view.getByTestId('failed-retry-button'));

    // The retry RE-ISSUES the download: a fresh native transfer now exists at the boundary.
    // RED before the fix: retry() bailed on the missing downloadId → 0 native starts → this never
    // becomes non-empty.
    await waitFor(() => { expect(boundary.download!.active().length).toBeGreaterThan(0); });
  });

  it('marks a retried download as no-longer-failed immediately (queued feedback)', async () => {
    installNativeBoundary({ download: true, fs: true, ram: { platform: 'ios', totalBytes: 8 * 1024 ** 3, availBytes: 6 * 1024 ** 3 } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, waitFor, fireEvent } = requireRTL();
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
    const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
    /* eslint-enable @typescript-eslint/no-var-requires */
    // The service routes retry() to the owning provider — register it (app boot does this; a bare
    // screen render does not, which is why retry was silently REFUSED: not found).
    registerCoreDownloadProviders();

    useDownloadStore.getState().add(failedTextEntry({ downloadId: 'dl-main' }));

    const view = render(React.createElement(DownloadManagerScreen, {}));
    // The failed card renders with a "N failed" count on the Download Manager header.
    await waitFor(() => { expect(view.queryByTestId('dm-active-failed-count')).not.toBeNull(); });

    fireEvent.press(view.getByTestId('failed-retry-button'));

    // After retry the item leaves the failed state (queued/pending) so the user sees it is working
    // again, instead of a card that still reads "failed". RED before the feedback fix: iOS retry set
    // no status, so the card stayed failed until native events that never arrive here.
    await waitFor(() => { expect(view.queryByTestId('dm-active-failed-count')).toBeNull(); });
  });
});
