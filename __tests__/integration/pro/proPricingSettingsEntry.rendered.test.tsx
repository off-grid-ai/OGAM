/**
 * Pro pricing on screen, reached from Settings.
 *
 * SPEC (OGAM user's view): for someone without Pro, both Pro entries in Settings open the checkout
 * sheet (getoffgridai.co/pro/app/), which shows the live price. The app itself shows no dollar
 * price and no yearly plan ("/yr", "year"): Pro is a lifetime purchase or a monthly subscription.
 *
 * Journey: the REAL App boots over the native boundary as a returning user (onboarding done on an
 * earlier launch, persisted on disk), skips model setup, taps the real Settings tab, then opens Pro
 * through each of Settings' two Pro entry points: the "Off Grid AI Pro" row and the upsell banner's
 * "Get Pro" button.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import { websiteReach } from '../../harness/websiteReach';

// The real navigation library, so a Settings row really pushes its screen (jest.setup stubs
// useNavigation globally).
jest.unmock('@react-navigation/native');

jest.mock(
  'react-native-bootsplash',
  () => ({ hide: jest.fn(async () => {}) }),
  { virtual: true },
);

const PRICE_OR_YEARLY = [/\$\s?\d/, /\/yr/i, /year/i];

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
  await rtl.waitFor(() => expect(view.getByLabelText(/^Off Grid AI Pro\. /)).toBeTruthy());
  return { view, rtl };
}

type View = Awaited<ReturnType<typeof openSettingsAsReturningUser>>['view'];

function expectNoPriceInApp(view: View) {
  for (const stale of PRICE_OR_YEARLY) {
    expect(view.queryAllByText(stale)).toHaveLength(0);
  }
}

/** BOUNDARY: no in-app browser module under jest, so checkout opens through the system browser. */
function watchOpenedUrls(): string[] {
  const { Linking } = require('react-native');
  const opened: string[] = [];
  Linking.openURL = async (url: string) => { opened.push(url); };
  return opened;
}

const checkoutFrom = (medium: string) =>
  new RegExp(`^https://getoffgridai\\.co/pro/app/\\?theme=(dark|light)&.*utm_medium=${medium}(&|$)`);


// The checkout opens only once our site answers: online here.
let undoReach = (): void => undefined;
beforeEach(() => {
  undoReach = websiteReach(true);
});
afterEach(() => undoReach());

describe('Pro pricing reached from Settings (rendered, real App)', () => {
  it('the "Off Grid AI Pro" row opens the checkout sheet, and the app shows no price or yearly plan', async () => {
    const { view, rtl } = await openSettingsAsReturningUser();
    const opened = watchOpenedUrls();
    expectNoPriceInApp(view);

    rtl.fireEvent.press(view.getByLabelText(/^Off Grid AI Pro\. /));
    await rtl.waitFor(() => expect(opened).toHaveLength(1));

    expect(opened[0]).toMatch(checkoutFrom('settings'));
    expect(view.queryByText('Intelligence, democratized.')).toBeNull();
    view.unmount();
  });

  it('the upsell banner "Get Pro" button opens the same checkout sheet', async () => {
    const { view, rtl } = await openSettingsAsReturningUser();
    const opened = watchOpenedUrls();

    // The Settings upsell banner carries its own "Get Pro" button.
    // Home stays mounted behind the tabs with a "Get Pro" of its own, so scope to the banner.
    let banner = view.getByText('Keep your work in context with memory, Sync, and actions you approve.').parent;
    while (banner && rtl.within(banner).queryAllByText('Get Pro').length === 0) {
      banner = banner.parent;
    }
    expect(banner).not.toBeNull();
    rtl.fireEvent.press(rtl.within(banner!).getByText('Get Pro'));
    await rtl.waitFor(() => expect(opened).toHaveLength(1));

    expect(opened[0]).toMatch(checkoutFrom('settings-banner'));
    expectNoPriceInApp(view);
    view.unmount();
  });
});
