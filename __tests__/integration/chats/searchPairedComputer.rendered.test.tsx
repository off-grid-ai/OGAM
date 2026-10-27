/**
 * Searching chats also searches the paired computer.
 *
 * SPEC (OGAM user's view): with Off Grid AI Desktop paired, what I type in the Chats search also
 * searches my computer. My phone's chats stay first; the computer's results sit under "On <its
 * name>", each with its snippet and where it came from. A chat that is on my phone opens here; a
 * chat my phone already lists is not listed twice. If the computer can't be reached, or refuses
 * my phone's key, my phone's results still show and the section says why in one line with the step
 * that fixes it (search again, or enter the key) — and after that step, the results come.
 *
 * The real App on the real navigator. Device boundaries only: the llama.rn engine, the disk, the
 * RAM sensor, the PostHog endpoint and Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');
// The device Keychain, where pairing keeps the computer's key.
jest.mock('react-native-keychain', () => require('../../harness/keyedRemoteServer').keychainModule());

import {
  launchApp,
  openNewChat,
  passOnboarding,
  restoreBuildFlavor,
  sendMessage,
  type AnalyticsApp,
} from '../../harness/analyticsApp';
import {
  DESKTOP_SEARCH_ENDPOINT,
  serveDesktopSearch,
  type DesktopSearch,
} from '../../harness/desktopSearchServer';

const KEY = 'ogk-test-phone-key';
const COMPUTER = 'Studio Mac';
const MEETING = {
  id: 'meet:7',
  title: 'Budget review',
  snippet: 'We cut the budget for travel',
  kind: 'meeting',
  source: 'Meeting',
  timestamp: Date.parse('2026-10-20T09:00:00Z'),
};
const COMPUTER_ONLY_CHAT = {
  id: 'chat:desk-only',
  title: 'Quarter budget',
  snippet: 'Draft the quarter budget',
  kind: 'chat',
  source: 'Chat',
  timestamp: Date.parse('2026-10-21T09:00:00Z'),
  deepLinkId: 'desk-only',
};

let app: AnalyticsApp | undefined;
let desktop: DesktopSearch | undefined;

afterEach(async () => {
  app?.view.unmount();
  desktop?.restore();
  app?.endpoint.restore();
  await require('../../../src/services/remoteServerManager').remoteServerManager.clearAllServers();
  app = undefined;
  desktop = undefined;
  restoreBuildFlavor();
});

/** A chat made on the phone, the computer paired with `key`, then the Chats tab. */
async function chatsWithComputer(key: string): Promise<{ app: AnalyticsApp; phoneChatId: string }> {
  app = await launchApp({ release: false });
  await passOnboarding(app, false);
  await openNewChat(app);
  await sendMessage(app, 'Plan the budget offsite', 'Here is a plan for the offsite.');
  desktop = serveDesktopSearch({ apiKey: KEY, records: [MEETING, COMPUTER_ONLY_CHAT] });
  // What pairing leaves behind: the computer's record and its key in the Keychain.
  await require('../../../src/services/remoteServerManager').remoteServerManager.addServer({
    name: COMPUTER,
    endpoint: DESKTOP_SEARCH_ENDPOINT,
    providerType: 'openai-compatible',
    modelManagement: 'offgrid-desktop-v1',
    apiKey: key,
  });
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getAllByLabelText('Back')[0]);
  rtl.fireEvent.press(await view.findByTestId('chats-tab'));
  await view.findByTestId('chat-search-input');
  const phoneChatId = require('../../../src/stores/chatStore').useChatStore.getState().conversations[0].id as string;
  return { app, phoneChatId };
}

it('shows the computer’s results under its name, with the phone’s chats kept and none listed twice', async () => {
  const { app: { view, rtl }, phoneChatId } = await chatsWithComputer(KEY);
  // The computer has the phone's chat too (synced).
  desktop!.remember({ id: `chat:${phoneChatId}`, title: 'Plan the budget offsite', snippet: 'Plan the budget offsite', kind: 'chat', source: 'Chat', timestamp: Date.now(), deepLinkId: phoneChatId });
  expect(view.queryByText(`On ${COMPUTER}`)).toBeNull();

  rtl.fireEvent.changeText(view.getByTestId('chat-search-input'), 'budget');

  await view.findByText(`On ${COMPUTER}`);
  await view.findByText('Budget review', {}, { timeout: 5000 });
  expect(view.getByText('We cut the budget for travel')).toBeTruthy();
  expect(view.getByText(/^Meeting · /)).toBeTruthy();
  expect(view.getByText('Quarter budget')).toBeTruthy();
  // The phone's own chat stays, and the computer's copy of it is not listed again.
  expect(view.getByTestId('conversation-item-0')).toBeTruthy();
  expect(view.queryByTestId(`computer-result-chat:${phoneChatId}`)).toBeNull();
  // A chat only on the computer has nothing to open on the phone.
  expect(view.getByTestId('computer-result-chat:desk-only').props.accessibilityRole).toBeUndefined();
}, 60_000);

it('opens a computer result for a chat that is on this phone', async () => {
  const { app: { view, rtl }, phoneChatId } = await chatsWithComputer(KEY);
  desktop!.remember({ id: `chat:${phoneChatId}`, title: 'Offsite', snippet: 'Catering for the offsite', kind: 'chat', source: 'Chat', timestamp: Date.now(), deepLinkId: phoneChatId });

  rtl.fireEvent.changeText(view.getByTestId('chat-search-input'), 'catering');
  // Only the computer matched it: the phone lists nothing for this word.
  await view.findByText('Catering for the offsite', {}, { timeout: 5000 });
  expect(view.getByText('No chats match your search.')).toBeTruthy();
  expect(view.queryByTestId('chat-input')).toBeNull();

  rtl.fireEvent.press(view.getByTestId(`computer-result-chat:${phoneChatId}`));
  await view.findByTestId('chat-input');
  expect(view.getByText('Here is a plan for the offsite.')).toBeTruthy();
}, 60_000);

it('keeps the phone’s results when the computer is off, says why, and searches again once it is back', async () => {
  const { app: { view, rtl } } = await chatsWithComputer(KEY);
  desktop!.setOffline(true);

  rtl.fireEvent.changeText(view.getByTestId('chat-search-input'), 'budget');

  await view.findByText(/Can't reach Studio Mac/, {}, { timeout: 5000 });
  expect(view.getByTestId('conversation-item-0')).toBeTruthy();
  expect(view.queryByText('Budget review')).toBeNull();

  desktop!.setOffline(false);
  rtl.fireEvent.press(view.getByLabelText(`Search ${COMPUTER} again`));
  await view.findByText('Budget review', {}, { timeout: 5000 });
  expect(view.queryByText(/Can't reach Studio Mac/)).toBeNull();
}, 60_000);

it('says the computer refused the phone’s key, and Enter key brings the results', async () => {
  const { app: { view, rtl } } = await chatsWithComputer('ogk-revoked-key');

  rtl.fireEvent.changeText(view.getByTestId('chat-search-input'), 'budget');

  await view.findByText(/didn't accept this phone's key/, {}, { timeout: 5000 });
  expect(view.getByTestId('conversation-item-0')).toBeTruthy();
  expect(view.queryByText('Budget review')).toBeNull();

  rtl.fireEvent.press(view.getByText('Enter key'));
  // The editor arrives showing the key the computer refused; the person replaces it.
  const keyField = await view.findByTestId('server-api-key');
  await rtl.waitFor(() => expect(view.getByTestId('server-api-key').props.value).toBe('ogk-revoked-key'));
  rtl.fireEvent.changeText(keyField, KEY);
  // Save opens once the key passes Test connection.
  rtl.fireEvent.press(view.getByTestId('test-connection'));
  await rtl.waitFor(
    () => expect(view.getByTestId('save-server').props.accessibilityState).toEqual({ disabled: false }),
    { timeout: 20_000 },
  );
  rtl.fireEvent.press(view.getByTestId('save-server'));
  // Saving returns to Chats.
  await rtl.waitFor(() => expect(view.queryByTestId('save-server')).toBeNull(), { timeout: 20_000 });

  await view.findByText('Budget review', {}, { timeout: 10_000 });
  expect(view.queryByText(/didn't accept this phone's key/)).toBeNull();
}, 60_000);
