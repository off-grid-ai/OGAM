/**
 * Consent prompts outside Auto Setup (docs/ANALYTICS.md, Consent).
 *
 * SPEC (OGAM user's view):
 * - Someone who installed before this version and was never asked sees "Help us fix what breaks"
 *   once, after their first successful reply. "Share" turns analytics on (source
 *   `first_chat_prompt`). It never shows again.
 * - When a model fails to load and the person has not opted in, "Help us fix this?" asks once;
 *   after "Not now" it does not ask again for 30 days. "Share" turns analytics on (source
 *   `failure_prompt`).
 * - "What we share" lists what is and is not sent.
 */
import {
  launchApp,
  openNewChat,
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
  await new Promise(resolve => setTimeout(resolve, 50));
  app?.endpoint.restore();
  app = undefined;
  restoreBuildFlavor();
});

async function newChatFromHome(current: AnalyticsApp): Promise<void> {
  current.rtl.fireEvent.press(current.view.getByLabelText('Back'));
  current.rtl.fireEvent.press(await current.view.findByTestId('new-chat-button'));
  await current.view.findByTestId('chat-input');
}

async function failToLoad(current: AnalyticsApp): Promise<void> {
  const { view, rtl, boundary } = current;
  boundary.llama!.scriptInitFailure(true);
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'hello');
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await rtl.waitFor(() => expect(boundary.llama!.calls.initLlama.length).toBeGreaterThan(0));
}

it('an existing user is asked once after their first reply, and Share opts them in', async () => {
  app = await launchApp({ release: true, returningUser: true });
  const current = app;
  const { view, rtl, endpoint } = current;
  await view.findByTestId('home-screen');
  await openNewChat(current);
  expect(view.queryByText('Help us fix what breaks')).toBeNull();
  await sendMessage(current, 'first', 'First reply.');
  expect(await view.findByText('Help us fix what breaks')).toBeTruthy();
  expect(view.getByText('Send anonymous crash reports and usage. Your chats stay on this device.')).toBeTruthy();
  rtl.fireEvent.press(view.getByLabelText('Share'));
  await rtl.waitFor(() => expect(view.queryByText('Help us fix what breaks')).toBeNull());

  await newChatFromHome(current);
  await sendMessage(current, 'second', 'Second reply.');
  await sendToBackground(current);
  await rtl.waitFor(() => expect(endpoint.named('generation_finished')).toHaveLength(1));
  expect(view.queryByText('Help us fix what breaks')).toBeNull();
  expect(endpoint.named('analytics_opted_in').map(e => e.properties.source)).toEqual(['first_chat_prompt']);
});

it('a failed model load asks once; Not now keeps analytics off and the next failure does not ask', async () => {
  app = await launchApp({ release: true, returningUser: true });
  const current = app;
  const { view, rtl, endpoint } = current;
  await view.findByTestId('home-screen');
  await openNewChat(current);
  expect(view.queryByText('Help us fix this?')).toBeNull();
  await failToLoad(current);
  expect(await view.findByText('Help us fix this?')).toBeTruthy();
  rtl.fireEvent.press(view.getByLabelText('Not now'));
  await rtl.waitFor(() => expect(view.queryByText('Help us fix this?')).toBeNull());

  // The failed load deselected the model: pick it again from Home and send again.
  const loadsBefore = current.boundary.llama!.calls.initLlama.length;
  rtl.fireEvent.press(view.getByLabelText('Back'));
  await openNewChat(current);
  await failToLoad(current);
  await rtl.waitFor(() => expect(current.boundary.llama!.calls.initLlama.length).toBeGreaterThan(loadsBefore));
  expect(view.queryByText('Help us fix this?')).toBeNull();
  await sendToBackground(current);
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(endpoint.urls).toEqual([]);
});

it('Share on the failure prompt opts in with source failure_prompt', async () => {
  app = await launchApp({ release: true, returningUser: true });
  const current = app;
  const { view, rtl, endpoint } = current;
  await view.findByTestId('home-screen');
  await openNewChat(current);
  await failToLoad(current);
  rtl.fireEvent.press(await view.findByLabelText('Share'));
  await rtl.waitFor(() => expect(view.queryByText('Help us fix this?')).toBeNull());
  await sendToBackground(current);
  await rtl.waitFor(() => expect(endpoint.named('analytics_opted_in')).toHaveLength(1));
  expect(endpoint.named('analytics_opted_in')[0].properties.source).toBe('failure_prompt');
});

it('What we share, from Auto Setup, lists what is and is not sent', async () => {
  app = await launchApp({ release: false });
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('onboarding-skip'));
  rtl.fireEvent.press(await view.findByTestId('auto-setup-what-we-share', {}, { timeout: 10_000 }));
  expect(await view.findByTestId('analytics-we-share')).toBeTruthy();
  expect(view.getByText('Your chats, prompts, replies, transcripts or reasoning.')).toBeTruthy();
  expect(view.getByTestId('analytics-we-never-share')).toBeTruthy();
  rtl.fireEvent.press(view.getByLabelText('Back'));
  await rtl.waitFor(() => expect(view.queryByTestId('analytics-we-share')).toBeNull());
  expect(view.getByTestId('auto-setup-skip')).toBeTruthy();
  await passOnboardingFromSetup(app);
});

async function passOnboardingFromSetup(current: AnalyticsApp): Promise<void> {
  current.rtl.fireEvent.press(current.view.getByTestId('auto-setup-skip'));
  await current.view.findByTestId('home-screen');
}
