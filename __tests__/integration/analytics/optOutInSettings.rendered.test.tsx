/**
 * Opting out in Settings (docs/ANALYTICS.md, Rules).
 *
 * SPEC (OGAM user's view): turning off both Anonymous stats and Crash reports stops every send, drops
 * what is queued and resets the anonymous ID. Turning analytics back on later starts a new,
 * unrelated anonymous ID.
 *
 * The real App runs as a store build over device boundaries; PostHog is faked at `fetch`.
 */
import {
  bringToForeground,
  launchApp,
  openNewChat,
  openSettings,
  passOnboarding,
  restoreBuildFlavor,
  sendMessage,
  sendToBackground,
  type AnalyticsApp,
} from '../../harness/analyticsApp';

jest.unmock('@react-navigation/native');

let app: AnalyticsApp | undefined;

afterEach(async () => {
  await require('../../../src/services/generationService').generationService.stopGeneration();
  app?.view.unmount();
  // Let the client's last flush land on the fake endpoint before the endpoint goes away.
  await new Promise(resolve => setTimeout(resolve, 50));
  app?.endpoint.restore();
  app = undefined;
  restoreBuildFlavor();
});

/** The switch's rendered state: Android's native switch draws `on`, iOS's draws `value`. */
function isOn(element: { props: Record<string, unknown> }): boolean {
  return Boolean(element.props.on ?? element.props.value);
}

async function chatFromHome(current: AnalyticsApp, prompt: string, reply: string): Promise<void> {
  current.rtl.fireEvent.press(current.view.getByTestId('home-tab'));
  current.rtl.fireEvent.press(await current.view.findByTestId('new-chat-button'));
  await current.view.findByTestId('chat-input');
  await sendMessage(current, prompt, reply);
}

it('turning both toggles off stops sending and a later opt-in uses a new anonymous ID', async () => {
  app = await launchApp({ release: true });
  const current = app;
  const { view, rtl, endpoint } = current;
  await passOnboarding(current, true);
  await openNewChat(current);
  await sendMessage(current, 'first question', 'First answer.');
  await sendToBackground(current);
  await rtl.waitFor(() => expect(endpoint.named('generation_finished')).toHaveLength(1));
  const firstId = endpoint.named('generation_finished')[0].distinct_id;
  expect(firstId).toBeTruthy();

  await bringToForeground(current);
  await openSettings(current);
  const usage = view.getByLabelText('Anonymous stats');
  const crashes = view.getByLabelText('Crash reports');
  expect(isOn(usage)).toBe(true);
  expect(isOn(crashes)).toBe(true);
  rtl.fireEvent(usage, 'valueChange', false);
  rtl.fireEvent(crashes, 'valueChange', false);
  await rtl.waitFor(() => {
    expect(isOn(view.getByLabelText('Anonymous stats'))).toBe(false);
    expect(isOn(view.getByLabelText('Crash reports'))).toBe(false);
  });

  const sentBeforeOptOut = endpoint.urls.length;
  await chatFromHome(current, 'second question', 'Second answer.');
  await sendToBackground(current);
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(view.getByText('Second answer.')).toBeTruthy();
  expect(endpoint.urls).toHaveLength(sentBeforeOptOut);

  // Back on: a fresh anonymous ID, unrelated to the first one.
  await bringToForeground(current);
  await openSettings(current);
  rtl.fireEvent(view.getByLabelText('Anonymous stats'), 'valueChange', true);
  await rtl.waitFor(() => expect(isOn(view.getByLabelText('Anonymous stats'))).toBe(true));
  await chatFromHome(current, 'third question', 'Third answer.');
  await sendToBackground(current);
  await rtl.waitFor(() => expect(endpoint.named('generation_finished')).toHaveLength(2));
  expect(endpoint.named('analytics_opted_in').map(e => e.properties.source)).toEqual(['setup', 'settings']);
  const secondId = endpoint.named('generation_finished')[1].distinct_id;
  expect(secondId).toBeTruthy();
  expect(secondId).not.toBe(firstId);
});
