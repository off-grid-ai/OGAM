/**
 * Home's carousel: a card for something that lives on the Mac opens the Off Grid AI Desktop page,
 * tagged so the visit is counted as coming from this card (utm_medium home-showcase). A phone Pro
 * card, for someone without Pro, opens Pro instead.
 *
 * The real App on Home. The OS's link opener (Linking.openURL) is the device boundary: the test
 * records the URL the app hands it.
 */
import { launchApp, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';

jest.unmock('@react-navigation/native');

let app: AnalyticsApp | null = null;
afterEach(async () => {
  app?.view.unmount();
  app?.endpoint.restore();
  app = null;
  restoreBuildFlavor();
});

it('a Mac card opens the Desktop page with the carousel\'s utm; a phone Pro card opens Pro', async () => {
  // A store build without a licence: Pro is off (a dev build unlocks Pro, so the Pro card would open video).
  app = await launchApp({ release: true, returningUser: true });
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
  expect(await view.findByText('Off Grid AI Pro', {}, { timeout: 10_000 })).toBeTruthy();
  expect(opened).toHaveLength(1);
});
