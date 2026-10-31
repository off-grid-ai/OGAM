/**
 * The last thing a person did is saved when they leave the app, even while an earlier save is still on
 * its way.
 *
 * Saved stores write one snapshot at a time (b95fa466b: a chat store changing per token outgrew an
 * iPhone's memory limit), so a change made while a write is on its way waits for it. iOS and Android
 * kill a backgrounded app without warning, so waiting there would lose the change.
 *
 * Product-correct outcome (the person's view): they send a message and get an answer, then send a
 * second one and get its answer, and leave the app. The phone kills it. When they open it again, the
 * chat shows both exchanges.
 *
 * Entry point: the REAL App, twice. Gestures: finish onboarding, pick the model, open a chat, send,
 * send again, leave the app (the OS background event); then a fresh launch over the same storage opens
 * the chat. Device boundaries only: llama.rn, the disk, the RAM sensor, and AsyncStorage, whose chat
 * write issued just before the second message is held on its way, as on a slow phone, and is never
 * finished, as when the OS kills the app.
 */
jest.unmock('@react-navigation/native');

import {
  launchApp,
  openNewChat,
  passOnboarding,
  restoreBuildFlavor,
  sendMessage,
  sendToBackground,
  type AnalyticsApp,
} from '../../harness/analyticsApp';

const CHAT_KEY = 'local-llm-chat-storage';
let app: AnalyticsApp | undefined;

afterEach(() => {
  app?.view.unmount();
  app?.endpoint.restore();
  app = undefined;
  restoreBuildFlavor();
});

/** Hold the next chat write on its way (a slow phone); it never finishes (the OS kills the app). */
function holdNextChatWrite(): void {
  const storage = require('@react-native-async-storage/async-storage');
  const AsyncStorage = storage.default ?? storage;
  const setItem = AsyncStorage.setItem.bind(AsyncStorage);
  let held = false;
  AsyncStorage.setItem = (key: string, value: string) => {
    if (key === CHAT_KEY && !held) {
      held = true;
      return new Promise<void>(() => {});
    }
    return setItem(key, value);
  };
}

it('keeps the last message when the app is killed after leaving it, with a save still on its way', async () => {
  app = await launchApp({ release: false });
  await passOnboarding(app, false);
  await openNewChat(app);
  await sendMessage(app, 'What colour is the sky?', 'The sky is blue.');

  holdNextChatWrite();
  await sendMessage(app, 'And the grass?', 'The grass is green.');
  await sendToBackground(app);
  app.view.unmount();
  app.endpoint.restore();

  // The OS killed the app: a fresh launch over the same storage.
  app = await launchApp({ release: false, relaunch: true });
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('chats-tab', {}, { timeout: 10_000 }));
  rtl.fireEvent.press(await view.findByText(/What colour is the sky\?/, {}, { timeout: 10_000 }));
  await view.findByText('The sky is blue.', {}, { timeout: 10_000 });
  expect(view.getByText('And the grass?')).toBeTruthy();
  expect(view.getByText('The grass is green.')).toBeTruthy();
}, 60_000);
