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
import { proIsPresent } from '../../pro/helpers/requirePro';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

jest.mock(
  'react-native-bootsplash',
  () => ({ hide: jest.fn(async () => {}) }),
  { virtual: true },
);

describe('app boot is not blocked by the download DB (rendered)', () => {
  it('clears the boot loader while getActiveDownloads remains wedged', async () => {
    installNativeBoundary();

    const React = require('react');
    const rtl = requireRTL();
    const { NativeModules } = require('react-native');
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    // WEDGE the download DB through first paint. The boundary is released only after the visible
    // boot outcome is proved, so the test remains faithful without leaking an immortal Promise.
    let releaseDownloadDb!: (rows: unknown[]) => void;
    const pendingDownloadDb = new Promise<unknown[]>(resolve => {
      releaseDownloadDb = resolve;
    });
    NativeModules.DownloadManagerModule = {
      ...NativeModules.DownloadManagerModule,
      getActiveDownloads: jest.fn(() => pendingDownloadDb),
    };
    const App = require('../../../App').default;

    const view = rtl.render(React.createElement(App));

    // Precondition (anti-false-green): the boot loader genuinely renders first.
    expect(view.queryByTestId('app-loading')).not.toBeNull();
    expect(view.getByTestId('startup-loading-dots')).toBeTruthy();

    // Terminal artifact: the loader clears even though the download DB never answered.
    await rtl.waitFor(
      () => {
        expect(view.queryByTestId('app-loading')).toBeNull();
      },
      // Preserve the responsive local contract. Serial hosted coverage can pause
      // the shared process for GC, so it receives only a load-tolerant assertion
      // budget; nativeBoundary still owns the complete CI test ceiling.
      { timeout: process.env.CI === 'true' ? 45_000 : 8_000 },
    );

    await rtl.act(async () => {
      releaseDownloadDb([]);
      await pendingDownloadDb;
    });
    // The core boot reads the download DB twice; with Pro checked out, Pro's video downloads
    // reconcile at launch too (pro 6fb3b12e), one read more.
    await rtl.waitFor(() => {
      expect(
        NativeModules.DownloadManagerModule.getActiveDownloads,
      ).toHaveBeenCalledTimes(proIsPresent() ? 3 : 2);
    });

    view.unmount();
  });
});
