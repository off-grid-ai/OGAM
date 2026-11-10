/**
 * Video settings in a chat shape the next clip.
 *
 * SPEC (OGAM user's view): a chat's settings open Model settings, whose "Image & video" tab has the
 * video settings, named for the video
 * model in use (the name the computer gives it, not its id). A fixed seed and what to avoid that I set there are what my next clip is
 * made with on my computer. A seed that is not a whole
 * number is not kept.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor and Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, type StudioApp } from '../../harness/videoStudioApp';
import { DESKTOP_VIDEO_MODEL } from '../../harness/desktopVideoServer';
import { pressModelSettingsBack } from '../../harness/modelSettingsBack';

afterEach(() => closeStudioApp(), 90_000);

const CLIP = 'a red fox trotting through fresh snow';

/** A new chat, its settings → Model settings, then the "Image & video" tab. */
async function videoSettings(): Promise<StudioApp> {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
  rtl.fireEvent.press(await view.findByTestId('chat-settings-open-model-settings'));
  // Use fastest settings places every modality, so it leads Model settings, on the tab it opens on.
  expect(await view.findByTestId('fastest-settings-button')).toBeTruthy();
  expect(view.queryByLabelText('Video seed')).toBeNull();
  const imageTab = view.getByTestId('model-settings-tab-image');
  // The tab is named for both, since Pro adds video to it.
  expect(rtl.within(imageTab).getByText('Image & video')).toBeTruthy();
  rtl.fireEvent.press(imageTab);
  rtl.fireEvent.press(await view.findByTestId('video-settings-advanced-toggle'));
  await view.findByLabelText('Video seed');
  return app;
}

async function sendClip(app: StudioApp, prompt: string): Promise<void> {
  const { view, rtl } = app;
  // Back from Model settings to the chat.
  pressModelSettingsBack(view, rtl);
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
  expect(app.jobs.submissions[0]).toMatchObject({ prompt: CLIP, seed: 42, negative_prompt: 'blurry, text' });
}, 90_000);

it('is named for the computer\'s video model, never its id', async () => {
  const app = await videoSettings();
  const { view, rtl } = app;
  await rtl.waitFor(() => expect(view.getByText(DESKTOP_VIDEO_MODEL.name)).toBeTruthy());
  expect(view.queryByText(DESKTOP_VIDEO_MODEL.id)).toBeNull();
}, 90_000);

it('a seed that is not a whole number is not kept', async () => {
  const app = await videoSettings();
  const { view, rtl } = app;
  const seed = view.getByLabelText('Video seed');
  rtl.fireEvent.changeText(seed, '4.5');
  rtl.fireEvent(seed, 'endEditing');
  await rtl.waitFor(() => expect(view.getByLabelText('Video seed').props.value).toBe(''));
}, 90_000);


it('shows the recommended settings, and Use recommended drops the ones I changed for the next clip', async () => {
  // SPEC (2026-11-04): video quality complaints. Settings someone changed once kept overriding the
  // model's corrected defaults. The section says what is recommended, and one tap goes back to it.
  const app = await videoSettings();
  const { view, rtl } = app;
  const recommended = [view.getByTestId('video-settings-recommended').props.children].flat().join('');
  const steps = Number(recommended.match(/(\d+) steps/)![1]);
  expect(view.queryByTestId('video-settings-use-recommended')).toBeNull();
  // A change made earlier, through the settings store the sliders write to.
  const { useAppStore } = require('../../../src/stores');
  const key = Object.keys(useAppStore.getState().settings.videoParams ?? {})[0] ?? DESKTOP_VIDEO_MODEL.id;
  rtl.act(() => useAppStore.getState().updateSettings({ videoParams: { [key]: { steps: steps + 10 } } }));
  rtl.fireEvent.press(await view.findByTestId('video-settings-use-recommended'));
  await rtl.waitFor(() => expect(view.queryByTestId('video-settings-use-recommended')).toBeNull());
  await sendClip(app, CLIP);
  expect(app.jobs.submissions[0].steps).toBe(steps);
}, 90_000);
