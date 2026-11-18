/**
 * The Pro tab lists every Pro feature on the phone. Without Pro, a feature explains itself in the
 * info guide (which has Get Pro); Models has left the bar but still opens from Home.
 *
 * The real App on Home, a store build without a licence.
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

it('lists the Pro features; without Pro one opens its page in the guide', async () => {
  app = await launchApp({ release: true, returningUser: true });
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('pro-tab'));
  await view.findByTestId('pro-tab-screen');
  expect(view.getByTestId('pro-tab-phone-vault')).toBeTruthy();
  expect(view.getByTestId('pro-tab-phone-video')).toBeTruthy();

  rtl.fireEvent.press(view.getByTestId('pro-tab-phone-vault'));
  await view.findByTestId('guide-topic-screen');
  expect(view.getByText('Your passwords, locked on this phone.')).toBeTruthy();
});
