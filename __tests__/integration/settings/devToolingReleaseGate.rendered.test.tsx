/**
 * Developer tooling never reaches a release build.
 *
 * SPEC (OGAM user's view): someone running the shipped app (a release build, __DEV__ = false)
 * never sees the developer sync strip pinned to the bottom of the screen, and the Settings
 * screen offers no "Load demo data" button and no "Show sync status bar" switch. A developer
 * build (__DEV__ = true) shows all three.
 *
 * The sync strip's visibility preference DEFAULTS TO ON, so the release gate is the only thing
 * keeping it off a user's screen. Both sides run the REAL App over the native boundary, as a
 * returning user whose persisted state (onboarding done) is already on disk, then tap the real
 * Settings tab.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

// The real navigation library (jest.setup stubs useNavigation globally).
jest.unmock('@react-navigation/native');

jest.mock(
  'react-native-bootsplash',
  () => ({ hide: jest.fn(async () => {}) }),
  { virtual: true },
);

type DevGlobal = { __DEV__?: boolean };
const originalDev = (global as DevGlobal).__DEV__;

afterEach(() => {
  (global as DevGlobal).__DEV__ = originalDev;
});

async function bootReturningUser(isDev: boolean) {
  installNativeBoundary();
  (global as DevGlobal).__DEV__ = isDev;

  const React = require('react');
  const rtl = requireRTL();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  // Device disk: a returning user who finished onboarding on an earlier launch.
  await AsyncStorage.setItem(
    'local-llm-app-storage',
    JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
  );

  const App = require('../../../App').default;
  const view = rtl.render(React.createElement(App));
  await rtl.waitFor(() => expect(view.queryByTestId('app-loading')).toBeNull(), {
    timeout: process.env.CI === 'true' ? 45_000 : 10_000,
  });
  // With no model on disk the app offers setup first; the user skips it to reach the main tabs.
  await rtl.waitFor(() => expect(view.getByTestId('auto-setup-skip')).toBeTruthy());
  rtl.fireEvent.press(view.getByTestId('auto-setup-skip'));
  await rtl.waitFor(() => expect(view.getByTestId('settings-tab')).toBeTruthy());
  return { view, rtl };
}

describe('developer tooling release gate (rendered, real App)', () => {
  it('a release build shows no sync strip and no demo-data or sync-strip controls in Settings', async () => {
    const { view, rtl } = await bootReturningUser(false);

    // BEFORE the Settings tap: the user is on Home, the Settings screen is not yet shown.
    expect(view.queryByText('Privacy First')).toBeNull();
    expect(view.queryByTestId('dev-sync-strip')).toBeNull();

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    await rtl.waitFor(() => expect(view.getByText('Privacy First')).toBeTruthy());

    expect(view.queryByTestId('seed-demo-data')).toBeNull();
    expect(view.queryByText('Load demo data')).toBeNull();
    expect(view.queryByLabelText('Show sync status bar')).toBeNull();
    expect(view.queryByText('Show sync status bar')).toBeNull();
    expect(view.queryByText('Reset Onboarding')).toBeNull();
    expect(view.queryByTestId('dev-sync-strip')).toBeNull();

    view.unmount();
  });

  it('a developer build shows the sync strip and both developer controls in Settings', async () => {
    const { view, rtl } = await bootReturningUser(true);

    expect(view.queryByText('Privacy First')).toBeNull();
    expect(view.getByTestId('dev-sync-strip')).toBeTruthy();

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    await rtl.waitFor(() => expect(view.getByText('Privacy First')).toBeTruthy());

    expect(view.getByTestId('seed-demo-data')).toBeTruthy();
    expect(view.getByText('Load demo data')).toBeTruthy();
    expect(view.getByLabelText('Show sync status bar')).toBeTruthy();

    // The switch really drives the strip: turning it off removes the strip from the screen.
    await rtl.act(async () => {
      rtl.fireEvent(view.getByLabelText('Show sync status bar'), 'valueChange', false);
    });
    await rtl.waitFor(() => expect(view.queryByTestId('dev-sync-strip')).toBeNull());

    view.unmount();
  });
});
