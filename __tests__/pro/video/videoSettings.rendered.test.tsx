/**
 * Video settings in a chat shape the next clip.
 *
 * SPEC (OGAM user's view): a chat's settings have a Video generation section, named for the video
 * model in use. A fixed seed and what to avoid that I set there are what my next clip is
 * made with on my computer. A seed that is not a whole
 * number is not kept.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor and Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, type StudioApp } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

const CLIP = 'a red fox trotting through fresh snow';

/** A new chat, its settings, then the Video generation section. */
async function videoSettings(): Promise<StudioApp> {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
  expect(view.queryByLabelText('Video seed')).toBeNull();
  rtl.fireEvent.press(await view.findByLabelText('Video generation'));
  await view.findByLabelText('Video seed');
  return app;
}

async function sendClip(app: StudioApp, prompt: string): Promise<void> {
  const { view, rtl } = app;
  const close = view.queryAllByTestId('app-sheet-close');
  if (close.length) rtl.fireEvent.press(close[close.length - 1]);
  rtl.fireEvent.press(await view.findByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), prompt);
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
}

it('a fixed seed and what to avoid reach the computer with the next clip', async () => {
  const app = await videoSettings();
  const { view, rtl } = app;
  const seed = view.getByLabelText('Video seed');
  rtl.fireEvent.changeText(seed, '42');
  rtl.fireEvent(seed, 'endEditing');
  rtl.fireEvent.changeText(view.getByLabelText('Video negative prompt'), 'blurry, text');
  await sendClip(app, CLIP);
  expect(app.jobs.submissions[0]).toMatchObject({ prompt: CLIP, seed: 42, negativePrompt: 'blurry, text' });
}, 90_000);

it('a seed that is not a whole number is not kept', async () => {
  const app = await videoSettings();
  const { view, rtl } = app;
  const seed = view.getByLabelText('Video seed');
  rtl.fireEvent.changeText(seed, '4.5');
  rtl.fireEvent(seed, 'endEditing');
  await rtl.waitFor(() => expect(view.getByLabelText('Video seed').props.value).toBe(''));
}, 90_000);

