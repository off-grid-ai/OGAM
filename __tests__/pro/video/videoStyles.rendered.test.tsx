/**
 * A clip in a style, and the same clip again in another style.
 *
 * SPEC (Ali, 2026-11-04: "video style support on mobile similar to how it's on image"; mock approved
 * at the Mobile Styles canvas): in video mode the chat shows the video styles. Nothing is chosen at
 * first, so a clip is made from my words as typed. A tap chooses a style: the clip is made from my words
 * plus that style's words, and my message says which style it was. The chat remembers the choice.
 * Clear goes back to my words alone. Restyle on a clip makes the same prompt again in the style I pick.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor and Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, type StudioApp } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

const { mediaStyle } = require('@offgrid/models');
const CINEMATIC = mediaStyle('video', 'cinematic').words;
const NATURE = mediaStyle('video', 'nature').words;

async function newChatInVideoMode(): Promise<StudioApp> {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
  await view.findByTestId('style-row');
  return app;
}

async function send(app: StudioApp, prompt: string, clips: number): Promise<void> {
  const { view, rtl } = app;
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), prompt);
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await rtl.waitFor(() => expect(view.getAllByTestId('chat-clip-card')).toHaveLength(clips), { timeout: 15_000 });
}

it('with no style a clip is my words as typed; a chosen style adds its words and my message names it', async () => {
  const app = await newChatInVideoMode();
  const { view, rtl } = app;
  // Nothing chosen: the label is plain and there is nothing to clear.
  expect(view.queryByTestId('style-row-clear')).toBeNull();
  rtl.fireEvent.press(view.getByTestId('style-row-cinematic'));
  expect(view.getByTestId('style-row-cinematic').props.accessibilityState).toMatchObject({ selected: true });
  await send(app, 'a lighthouse at night', 1);
  expect(app.jobs.submissions[0].prompt).toBe(`a lighthouse at night, ${CINEMATIC}`);
  // My message keeps my words and says which style it was made in.
  const userMessage = view.getAllByTestId('user-message')[0];
  expect(rtl.within(userMessage).getByText('a lighthouse at night')).toBeTruthy();
  expect(rtl.within(userMessage).queryByText(new RegExp(CINEMATIC.split(',')[0]))).toBeNull();
  expect(rtl.within(userMessage).getByTestId('message-style').props.children).toBe('Cinematic');

  // The chat remembers it: video mode again shows Cinematic chosen. Clear goes back to my words alone.
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
  expect((await view.findByTestId('style-row-cinematic')).props.accessibilityState).toMatchObject({ selected: true });
  rtl.fireEvent.press(view.getByTestId('style-row-clear'));
  await send(app, 'waves on a beach', 2);
  expect(app.jobs.submissions[1].prompt).toBe('waves on a beach');
}, 90_000);

it('Restyle on a clip makes the same prompt again in the style I pick', async () => {
  const app = await newChatInVideoMode();
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getByTestId('style-row-cinematic'));
  await send(app, 'a lighthouse at night', 1);

  rtl.fireEvent.press(await view.findByTestId('video-restyle'));
  // The sheet shows my own words and the style the clip was made in.
  await view.findByTestId('restyle-row', {}, { timeout: 5000 });
  expect(view.getByTestId('restyle-row-cinematic').props.accessibilityState).toMatchObject({ selected: true });
  rtl.fireEvent.press(view.getByTestId('restyle-row-nature'));
  await rtl.waitFor(() => expect(app.jobs.submissions).toHaveLength(2), { timeout: 15_000 });
  expect(app.jobs.submissions[1].prompt).toBe(`a lighthouse at night, ${NATURE}`);
  await rtl.waitFor(() => expect(view.getAllByTestId('chat-clip-card')).toHaveLength(2), { timeout: 15_000 });
}, 90_000);
