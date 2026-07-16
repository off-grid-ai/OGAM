/**
 * DEVICE 2026-07-13 (offgrid-debug.log 18:43:55→18:44:06) — the startup loader sat for ~10s
 * because app boot AWAITS the download-recovery chain, and with 9 WorkManager downloads hammering
 * the native Room DB the `getActiveDownloads` read stalled ~9.5s behind write-lock contention.
 * The whole app was hostage to the download subsystem's disk.
 *
 * SPEC (OGAM user's view): the app opens promptly no matter what the download DB is doing.
 * Download rows/badges are reactive — they fill in when recovery lands.
 *
 * Journey: mount the REAL App over the native boundary, with the download DB WEDGED
 * (getActiveDownloads never resolves — the contention case taken to its limit). Terminal
 * artifact: the boot loader ('app-loading') CLEARS anyway. RED on HEAD: the loader stays
 * forever because initializeApp awaits hydrateDownloadStore/reattach before first paint.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });

describe('app boot is not blocked by the download DB (rendered)', () => {
  it('clears the boot loader while getActiveDownloads never resolves (wedged download DB)', async () => {
    const boundary = installNativeBoundary();

    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const rtl = requireRTL();
    const { NativeModules } = require('react-native');
    // WEDGE the download DB: the native read never resolves (the device's 9-writer contention,
    // taken to the limit). Everything else on the boundary behaves normally.
    NativeModules.DownloadManagerModule = {
      ...NativeModules.DownloadManagerModule,
      getActiveDownloads: jest.fn(() => new Promise(() => {})),
    };
    const App = require('../../../App').default;
    /* eslint-enable @typescript-eslint/no-var-requires */

    const view = rtl.render(React.createElement(App));

    // Precondition (anti-false-green): the boot loader genuinely renders first.
    expect(view.queryByTestId('app-loading')).not.toBeNull();

    // Terminal artifact: the loader clears even though the download DB never answered.
    await rtl.waitFor(() => { expect(view.queryByTestId('app-loading')).toBeNull(); }, { timeout: 8000 });

    view.unmount();
    void boundary;
  }, 20000);
});
