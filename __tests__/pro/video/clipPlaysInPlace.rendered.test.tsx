/**
 * A finished clip plays where it is, with a real player.
 *
 * SPEC (OGAM user's view, Ali: "the first play click should just play it in place, not necessarily move it
 * to full screen"; "clicking on the video in chat is just playing it and doesn't have video player
 * functionality"; "it should be all inclusive"): in a chat, Play on a clip's card plays it inside the
 * card and I stay in the chat. Over it: pause, the time, a scrubber I can drag, mute, More (what full
 * screen offers: Extend, Save, Delete) and full screen, which opens at the same second and stops the card.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor, the OS
 * dialog, and Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');

import type { ReactTestInstance } from 'react-test-renderer';
import { closeStudioApp, launchStudioApp, makeClipInChat } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

const CARD = 'chat-clip-card';

/** A Text's words, whether one string or several parts. */
const textOf = (text: ReactTestInstance) => ([] as unknown[]).concat(text.props.children).join('');

it('plays in the card with pause, time, scrubber and mute; full screen opens at the same second', async () => {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  await makeClipInChat(app, 'a paper boat drifting on a pond');

  // The still card: Play, its length, More and full screen; no player yet.
  expect(view.queryByTestId(`clip-${CARD}`)).toBeNull();
  expect(view.getByTestId(`length-${CARD}`)).toBeTruthy();
  expect(view.getByTestId(`more-${CARD}`)).toBeTruthy();
  expect(view.getByTestId(`expand-${CARD}`)).toBeTruthy();

  // Play: it plays here, with the time, the scrubber and mute.
  rtl.fireEvent.press(view.getByTestId(`play-${CARD}`));
  expect(view.getByTestId(`clip-${CARD}`).props.paused).toBe(false);
  expect(view.queryByTestId('video-viewer')).toBeNull();
  expect(view.getByTestId(`time-${CARD}`)).toBeTruthy();

  // Pause, then play again.
  expect(view.getByTestId(`play-${CARD}`).props.accessibilityLabel).toBe('Pause');
  rtl.fireEvent.press(view.getByTestId(`play-${CARD}`));
  expect(view.getByTestId(`clip-${CARD}`).props.paused).toBe(true);
  rtl.fireEvent.press(view.getByTestId(`play-${CARD}`));
  expect(view.getByTestId(`clip-${CARD}`).props.paused).toBe(false);

  // Mute and unmute.
  rtl.fireEvent.press(view.getByTestId(`mute-${CARD}`));
  expect(view.getByTestId(`clip-${CARD}`).props.muted).toBe(true);
  expect(view.getByTestId(`mute-${CARD}`).props.accessibilityLabel).toBe('Unmute');
  rtl.fireEvent.press(view.getByTestId(`mute-${CARD}`));
  expect(view.getByTestId(`clip-${CARD}`).props.muted).toBe(false);

  // Drag the scrubber to the first second: the time follows.
  rtl.fireEvent(view.getByTestId(`scrubber-${CARD}`), 'onSlidingStart');
  rtl.fireEvent(view.getByTestId(`scrubber-${CARD}`), 'onSlidingComplete', 1);
  expect(textOf(view.getByTestId(`time-${CARD}`))).toMatch(/^0:01 \/ /);

  // Full screen opens at that second, and the card stops so the clip does not play twice.
  rtl.fireEvent.press(view.getByTestId(`expand-${CARD}`));
  await view.findByTestId('video-viewer', {}, { timeout: 10_000 });
  expect(textOf(view.getByTestId('time-viewer'))).toMatch(/^0:01 \/ /);
  // The chat sits under full screen, hidden from the reader, still mounted.
  await rtl.waitFor(() =>
    expect(view.getByTestId(`clip-${CARD}`, { includeHiddenElements: true }).props.paused).toBe(true),
  );
}, 60_000);

it("More on the card offers what full screen offers: Extend, Save and Delete", async () => {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  await makeClipInChat(app, 'a paper boat drifting on a pond');

  rtl.fireEvent.press(view.getByTestId(`more-${CARD}`));
  const sheet = await view.findByTestId('app-alert');
  for (const action of ['Extend', 'Save', 'Delete']) expect(rtl.within(sheet).getByText(action)).toBeTruthy();
  expect(view.queryByTestId('video-viewer')).toBeNull();
}, 60_000);

it('one clip plays at a time: starting the second card pauses the first', async () => {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  await makeClipInChat(app, 'a paper boat drifting on a pond');
  // A second clip in the same chat.
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a red kite over a hill');
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await rtl.waitFor(() => expect(view.getAllByTestId(`play-${CARD}`)).toHaveLength(2), { timeout: 15_000 });

  rtl.fireEvent.press(view.getAllByTestId(`play-${CARD}`)[0]);
  expect(view.getAllByTestId(`clip-${CARD}`)[0].props.paused).toBe(false);
  rtl.fireEvent.press(view.getAllByTestId(`play-${CARD}`)[1]);
  const [first, second] = view.getAllByTestId(`clip-${CARD}`);
  expect(first.props.paused).toBe(true);
  expect(second.props.paused).toBe(false);
}, 90_000);
