/**
 * Pro pricing on screen, reached from Settings.
 *
 * SPEC (OGAM user's view): the Pro screen states the current founder price - $119 for a lifetime
 * licence or $7.99 a month - and never an older tier ($49, $69) or a yearly plan ("/yr", "year").
 * Pro has no yearly plan; it has a lifetime purchase and a monthly subscription.
 *
 * Journey: the REAL App boots over the native boundary as a returning user (onboarding done on an
 * earlier launch, persisted on disk), skips model setup, taps the real Settings tab, then opens Pro
 * through each of Settings' two Pro entry points: the "Off Grid AI PRO" row and the upsell banner's
 * "Get Pro" button.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

// The real navigation library, so a Settings row really pushes its screen (jest.setup stubs
// useNavigation globally).
jest.unmock('@react-navigation/native');

jest.mock(
  'react-native-bootsplash',
  () => ({ hide: jest.fn(async () => {}) }),
  { virtual: true },
);

const STALE_PRICE_COPY = [/\$49/, /\$69/, /\/yr/i, /year/i];

type DevGlobal = { __DEV__?: boolean };
const originalDev = (global as DevGlobal).__DEV__;
afterEach(() => {
  (global as DevGlobal).__DEV__ = originalDev;
});

async function openSettingsAsReturningUser() {
  installNativeBoundary();
  // A shipped build: the pricing a customer sees, without development-only Pro access.
  (global as DevGlobal).__DEV__ = false;
  const React = require('react');
  const rtl = requireRTL();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  await AsyncStorage.setItem(
    'local-llm-app-storage',
    JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
  );

  const App = require('../../../App').default;
  const view = rtl.render(React.createElement(App));
  await rtl.waitFor(() => expect(view.queryByTestId('app-loading')).toBeNull(), {
    timeout: process.env.CI === 'true' ? 45_000 : 10_000,
  });
  await rtl.waitFor(() => expect(view.getByTestId('auto-setup-skip')).toBeTruthy());
  rtl.fireEvent.press(view.getByTestId('auto-setup-skip'));
  await rtl.waitFor(() => expect(view.getByTestId('settings-tab')).toBeTruthy());
  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  await rtl.waitFor(() => expect(view.getByText('Off Grid AI PRO')).toBeTruthy());
  return { view, rtl };
}

type View = Awaited<ReturnType<typeof openSettingsAsReturningUser>>['view'];

function expectCurrentPricingOnly(view: View) {
  expect(view.getByText(/\$119 lifetime/)).toBeTruthy();
  expect(view.getByText(/\$7\.99\/month/)).toBeTruthy();
  for (const stale of STALE_PRICE_COPY) {
    expect(view.queryAllByText(stale)).toHaveLength(0);
  }
}

describe('Pro pricing reached from Settings (rendered, real App)', () => {
  it('the "Off Grid AI PRO" row opens Pro showing $119 lifetime and $7.99 a month, no yearly or old tier', async () => {
    const { view, rtl } = await openSettingsAsReturningUser();

    // BEFORE: on Settings, no price is shown yet.
    expect(view.queryByText(/\$119/)).toBeNull();
    expect(view.queryByText(/\$7\.99/)).toBeNull();

    rtl.fireEvent.press(view.getByText('Off Grid AI PRO'));
    await rtl.waitFor(() => expect(view.getByText('Intelligence, democratized.')).toBeTruthy());

    expectCurrentPricingOnly(view);
    view.unmount();
  });

  it('the upsell banner "Get Pro" button opens Pro showing the same current pricing', async () => {
    const { view, rtl } = await openSettingsAsReturningUser();

    expect(view.queryByText(/\$119/)).toBeNull();
    expect(view.queryByText('Intelligence, democratized.')).toBeNull();

    // The Settings upsell banner (its LIVE SYNC feature grid) carries its own "Get Pro" button.
    // Home stays mounted behind the tabs with a "Get Pro" of its own, so scope to the banner.
    let banner = view.getByText('LIVE SYNC').parent;
    while (banner && rtl.within(banner).queryAllByText('Get Pro').length === 0) {
      banner = banner.parent;
    }
    expect(banner).not.toBeNull();
    rtl.fireEvent.press(rtl.within(banner!).getByText('Get Pro'));
    await rtl.waitFor(() => expect(view.getByText('Intelligence, democratized.')).toBeTruthy());

    expectCurrentPricingOnly(view);
    view.unmount();
  });
});
