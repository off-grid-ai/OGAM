/**
 * Home's carousel: a card for something that lives on the Mac opens the Off Grid AI Desktop page,
 * tagged so the visit is counted as coming from this card (utm_medium home-showcase). A phone Pro
 * card, for someone without Pro, opens the Pro checkout sheet instead.
 *
 * The real App on Home. The OS's link opener (Linking.openURL) is the device boundary: the test
 * records the URL the app hands it.
 */
import { launchApp, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';
import { websiteReach } from '../../harness/websiteReach';

jest.unmock('@react-navigation/native');

let app: AnalyticsApp | null = null;
let undoReach = (): void => undefined;
afterEach(async () => {
  undoReach();
  app?.view.unmount();
  app?.endpoint.restore();
  app = null;
  restoreBuildFlavor();
});

it('a Mac card opens the Desktop page with the carousel\'s utm; a phone Pro card opens the checkout sheet', async () => {
  // A store build without a licence: Pro is off (a dev build unlocks Pro, so the Pro card would open video).
  app = await launchApp({ release: true, returningUser: true });
  // Our site answers, so the sheets open.
  undoReach = websiteReach(true);
  const { view, rtl } = app;
  await view.findByTestId('home-screen');
  const { Linking } = require('react-native');
  const opened: string[] = [];
  Linking.openURL = async (url: string) => { opened.push(url); };

  rtl.fireEvent.press(await view.findByTestId('feature-showcase-mac-models'));
  await rtl.waitFor(() => expect(opened).toHaveLength(1));
  expect(opened[0]).toBe(
    'https://getoffgridai.co/desktop?utm_source=off-grid-mobile-app&utm_medium=home-showcase&utm_campaign=in-app',
  );

  rtl.fireEvent.press(view.getByTestId('feature-showcase-video'));
  // No in-app browser module under jest, so the checkout sheet opens through the system browser.
  await rtl.waitFor(() => expect(opened).toHaveLength(2));
  expect(opened[1]).toMatch(/^https:\/\/getoffgridai\.co\/pro\/app\/\?theme=(dark|light)&.*utm_medium=home-showcase/);

  // The private cloud card opens its offer page, tagged as coming from Home.
  rtl.fireEvent.press(view.getByTestId('feature-showcase-boost'));
  await rtl.waitFor(() => expect(opened).toHaveLength(3));
  expect(opened[2]).toBe(
    'https://getoffgridai.co/boost?utm_source=off-grid-mobile-app&utm_medium=boost-home&utm_campaign=in-app',
  );
});
