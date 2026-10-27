/**
 * Animate a picture from a chat.
 *
 * SPEC (OGAM user's view): I open a picture the app made in a chat; its viewer offers Animate.
 * Without a video model that can start from a picture, Animate is on screen but muted, and a tap
 * opens one sheet: get the model on my computer, or make a new clip from the picture's description
 * instead. Once the computer has the model, Animate opens the Animate screen: the picture, a motion
 * (or my own words), where it runs, and Animate — which asks whether the picture is of me or of
 * someone who agreed, then shows the clip being made.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor, the OS
 * dialog, the image engine (diffusion), and Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, type StudioApp } from '../../harness/videoStudioApp';

const LIGHT = 'off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4';
const PICTURE = 'a lighthouse on a cliff at dusk';

afterEach(() => closeStudioApp());

/** A picture made in a chat by the image model on the phone, opened in its viewer. */
async function pictureInViewer(): Promise<StudioApp> {
  const app = await launchStudioApp(undefined, { imageModel: true });
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-image-mode'));
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), PICTURE);
  rtl.fireEvent.press(view.getByTestId('send-button'));
  rtl.fireEvent.press(await view.findByTestId('generated-image-content', {}, { timeout: 15_000 }));
  const animate = await view.findByTestId('animate-photo', {}, { timeout: 10_000 });
  expect(view.queryByTestId('start-picture-sheet')).toBeNull();
  expect(animate.props.accessibilityState?.disabled).toBe(true);
  return app;
}

it('muted Animate offers a new clip from the picture\'s description, made on the computer', async () => {
  const app = await pictureInViewer();
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getByTestId('animate-photo'));
  await view.findByText('Animate needs Wan 2.2 (5B), Light, a 7.9 GB download.', {}, { timeout: 10_000 });
  app.stories.hold();
  rtl.fireEvent.press(view.getAllByTestId('start-picture-describe')[0]);
  await view.findByTestId('video-making', {}, { timeout: 10_000 });
  await rtl.waitFor(() => expect(app.stories.submissions).toHaveLength(1), { timeout: 10_000 });
  // Made from the description alone: no picture went to the computer.
  const sent = app.stories.submissions[0] as { init_images: Record<string, string> };
  expect(sent.init_images).toEqual({});
}, 90_000);

it('once the computer has the model, Animate opens; my own words and a yes start the clip', async () => {
  const app = await pictureInViewer();
  const { view, rtl } = app;
  app.models.install(LIGHT);
  rtl.fireEvent.press(view.getByTestId('animate-photo'));
  rtl.fireEvent.press(await view.findByTestId('start-picture-use', {}, { timeout: 10_000 }));
  await view.findByTestId('video-animate', {}, { timeout: 15_000 });

  expect(view.queryByTestId('motion-words')).toBeNull();
  rtl.fireEvent.press(view.getByTestId('motion-your-words'));
  const words = await view.findByTestId('motion-words');
  // My own words, still empty: Animate waits for them.
  expect(view.getByTestId('animate-go').props.accessibilityState?.disabled).toBe(true);
  rtl.fireEvent.changeText(words, 'The beam sweeps across the sea');
  rtl.fireEvent.press(view.getByTestId('place-computer'));
  await rtl.waitFor(() => expect(view.getByTestId('animate-go').props.accessibilityState?.disabled).toBe(false));

  app.stories.hold();
  rtl.fireEvent.press(view.getByTestId('animate-go'));
  await rtl.waitFor(() => expect(app.dialog()?.title).toBe('Is this you, or someone who agreed?'), { timeout: 10_000 });
  expect(app.stories.submissions).toHaveLength(0);
  await app.answer('Yes');
  await view.findByTestId('video-making', {}, { timeout: 10_000 });
  await rtl.waitFor(() => expect(app.stories.submissions).toHaveLength(1), { timeout: 10_000 });
  const sent = app.stories.submissions[0] as {
    consent: boolean;
    init_images: Record<string, string>;
    story: { shots: Array<{ prompt: string }> };
  };
  expect(sent.consent).toBe(true);
  expect(Object.values(sent.init_images)).toHaveLength(1);
  expect(sent.story.shots[0].prompt).toBe('The beam sweeps across the sea');
}, 90_000);

it('a No to the photo question starts nothing', async () => {
  const app = await pictureInViewer();
  const { view, rtl } = app;
  app.models.install(LIGHT);
  rtl.fireEvent.press(view.getByTestId('animate-photo'));
  rtl.fireEvent.press(await view.findByTestId('start-picture-use', {}, { timeout: 10_000 }));
  await view.findByTestId('video-animate', {}, { timeout: 15_000 });
  rtl.fireEvent.press(view.getByTestId('motion-camera-orbit'));
  rtl.fireEvent.press(view.getByTestId('animate-go'));
  await rtl.waitFor(() => expect(app.dialog()?.title).toBe('Is this you, or someone who agreed?'), { timeout: 10_000 });
  await app.answer('Cancel');
  await rtl.waitFor(() => expect(view.getByTestId('animate-go').props.accessibilityState?.busy).toBeFalsy());
  expect(view.queryByTestId('video-making')).toBeNull();
  expect(app.stories.submissions).toHaveLength(0);
  rtl.fireEvent.press(view.getByTestId('animate-close'));
  await rtl.waitFor(() => expect(view.queryByTestId('video-animate')).toBeNull());
}, 90_000);

it('the Gallery\'s full-screen picture offers the same muted Animate and sheet', async () => {
  const app = await pictureInViewer();
  const { view, rtl } = app;
  // Leave the chat's viewer and the chat, then open the picture from the Gallery.
  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  rtl.fireEvent.press(await view.findByTestId('home-tab'));
  rtl.fireEvent.press(await view.findByText('Image Gallery', {}, { timeout: 10_000 }));
  rtl.fireEvent.press((await view.findAllByTestId(/^gallery-image-/, {}, { timeout: 10_000 }))[0]);
  const animate = (await view.findAllByTestId('animate-photo', {}, { timeout: 10_000 })).pop()!;
  expect(animate.props.accessibilityState?.disabled).toBe(true);
  rtl.fireEvent.press(animate);
  await view.findByText('Animate needs Wan 2.2 (5B), Light, a 7.9 GB download.', {}, { timeout: 10_000 });
}, 90_000);
