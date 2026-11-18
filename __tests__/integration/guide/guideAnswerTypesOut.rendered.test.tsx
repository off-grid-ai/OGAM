/**
 * The info guide's answers type out when they arrive, then stand whole with their pictures.
 * A starter question is answered from the guide itself, with no model, so this runs as it does
 * on a phone with nothing downloaded.
 *
 * The real App on Home.
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

it('an answer types out, then shows whole with the cards it names', async () => {
  app = await launchApp({ release: true, returningUser: true });
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('home-guide-button'));
  rtl.fireEvent.press(await view.findByTestId('guide-starter-What does Pro add on my phone?'));

  // Its first characters are on screen before the rest, and its cards come last.
  const answer = await view.findByTestId('guide-answer');
  expect(rtl.within(answer).queryAllByTestId(/^guide-answer-topic-/)).toHaveLength(0);

  await rtl.waitFor(() => expect(rtl.within(answer).getAllByTestId(/^guide-answer-topic-/).length).toBeGreaterThan(0), {
    timeout: 3000,
  });
});
