/**
 * Shaping a film on its storyboard before it is made.
 *
 * SPEC (OGAM user's view): a storyboard lists the film's shots. I can pick the format, add a shot,
 * remove one, rewrite what happens and what is said, change a shot's length, and turn narration
 * and captions on or off; the film the computer makes is the one I shaped. Tonight on my computer
 * starts it in its queue, with progress on the storyboard and a stop. A shot can be redone. A shot
 * can start from my photo once the computer has a model that starts from a picture, after I say the
 * photo is of me or someone who agreed. Delete asks first and takes me back to the chat. With an
 * image model on the phone, each new shot gets a still to look at before anything is made.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor, the
 * photo library, the OS dialog, and Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');

import { Image } from 'react-native';
import { closeStudioApp, launchStudioApp, makeClipInChat, type StudioApp } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

const LIGHT = 'off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4';

async function storyboard(prompt: string): Promise<StudioApp> {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  await makeClipInChat(app, prompt);
  rtl.fireEvent.press(await view.findByTestId('video-make-story'));
  await view.findByTestId('film-make-real', {}, { timeout: 15_000 });
  return app;
}

const shotCount = (app: StudioApp) => app.view.queryAllByTestId(/^shot-\d+$/).length;

interface SentStory {
  story: { format: string; voice: string | null; captions: boolean; shots: Array<{ prompt: string; narration: string; seconds: number }> };
}

it('the film made is the storyboard as I shaped it', async () => {
  const app = await storyboard('a lighthouse keeper climbs the stairs at dusk');
  const { view, rtl } = app;
  const before = shotCount(app);
  expect(before).toBeGreaterThan(1);

  rtl.fireEvent.press(view.getByTestId('film-format-landscape'));
  rtl.fireEvent.press(view.getByTestId('add-shot'));
  await rtl.waitFor(() => expect(shotCount(app)).toBe(before + 1));
  const removes = view.getAllByLabelText('Remove this shot');
  rtl.fireEvent.press(removes[removes.length - 1]);
  await rtl.waitFor(() => expect(shotCount(app)).toBe(before));

  const what = view.getByLabelText('Shot 2, what happens');
  rtl.fireEvent.changeText(what, 'The keeper lights the great lamp');
  rtl.fireEvent(what, 'endEditing');
  const said = view.getByLabelText('Shot 2, narration');
  rtl.fireEvent.changeText(said, 'Every night, the same climb.');
  rtl.fireEvent(said, 'endEditing');
  rtl.fireEvent.press(view.getAllByLabelText('7 seconds')[1]);
  rtl.fireEvent.press(view.getByLabelText('Narration on'));
  await view.findByLabelText('Narration off');
  rtl.fireEvent.press(view.getByLabelText('Captions on'));
  await view.findByLabelText('Captions off');

  app.stories.hold();
  rtl.fireEvent.press(view.getByTestId('film-make-real'));
  await rtl.waitFor(() => expect(app.stories.submissions).toHaveLength(1), { timeout: 10_000 });
  const sent = (app.stories.submissions[0] as unknown as SentStory).story;
  expect(sent.format).toBe('landscape');
  expect(sent.voice).toBeNull();
  expect(sent.captions).toBe(false);
  expect(sent.shots).toHaveLength(before);
  expect(sent.shots[1]).toMatchObject({ prompt: 'The keeper lights the great lamp', narration: 'Every night, the same climb.', seconds: 7 });
}, 90_000);

it('Tonight starts it on the computer with progress on the storyboard and a stop; a shot can be redone', async () => {
  const app = await storyboard('a fox crossing a frozen river');
  const { view, rtl } = app;
  expect(view.queryByTestId('film-progress')).toBeNull();
  app.stories.hold();
  rtl.fireEvent.press(view.getByTestId('film-tonight'));
  await view.findByTestId('film-progress', {}, { timeout: 10_000 });
  expect(view.queryByTestId('film-make-real')).toBeNull();
  rtl.fireEvent.press(view.getByTestId('film-cancel'));
  await view.findByTestId('film-make-real', {}, { timeout: 10_000 });
  expect(app.stories.cancels).toHaveLength(1);

  // The opening shot is the clip from chat: Redo makes it again on the computer.
  rtl.fireEvent.press(view.getByTestId('redo-shot-0'));
  await view.findByTestId('film-progress', {}, { timeout: 10_000 });
  await rtl.waitFor(() => expect(app.stories.submissions).toHaveLength(2), { timeout: 10_000 });
}, 90_000);

it('a shot starts from my photo once the computer can, after I say yes', async () => {
  const app = await storyboard('a dog running along the beach');
  const { view, rtl, boundary } = app;
  boundary.fs!.seedFile('/mock/image.jpg', 2048);
  app.models.install(LIGHT);
  rtl.fireEvent.press(view.getByTestId('shot-photo-1'));
  rtl.fireEvent.press(await view.findByTestId('start-picture-use', {}, { timeout: 10_000 }));
  await view.findByText('Wan 2.2 (5B), Light is ready.', {}, { timeout: 15_000 });
  rtl.fireEvent.press(view.getByTestId('start-picture-carry-on'));
  await rtl.waitFor(() => expect(app.dialog()?.title).toBe('Is this you, or someone who agreed?'), { timeout: 10_000 });
  await app.answer('Yes');
  await rtl.waitFor(() => expect(view.getByTestId('shot-photo-1').props.accessibilityState?.selected).toBe(true));

  app.stories.hold();
  rtl.fireEvent.press(view.getByTestId('film-make-real'));
  await rtl.waitFor(() => expect(app.stories.submissions).toHaveLength(1), { timeout: 10_000 });
  const sent = app.stories.submissions[0] as { consent: boolean; init_images: Record<string, string> };
  expect(sent.consent).toBe(true);
  expect(Object.values(sent.init_images)).toHaveLength(1);
}, 90_000);

it('Delete asks first, then the film is gone and I am back in the chat', async () => {
  const app = await storyboard('a kite over green hills');
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getByTestId('film-delete'));
  expect(app.dialog()?.title).toBe('Delete this film?');
  await app.answer('Delete');
  await view.findByTestId('chat-input', {}, { timeout: 10_000 });
  await rtl.waitFor(() => expect(view.queryByTestId('film-make-real')).toBeNull());
}, 90_000);

it('with an image model on the phone, the storyboard draws a still for each new shot', async () => {
  const app = await launchStudioApp(undefined, { imageModel: true });
  const { view, rtl, boundary } = app;
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  // Image mode picks the image model on the phone; then video mode for the clip.
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-image-mode'));
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a lighthouse keeper climbs the stairs at dusk');
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
  const stillsBefore = boundary.diffusion.calls.generateImage.length;

  rtl.fireEvent.press(await view.findByTestId('video-make-story'));
  await view.findByTestId('film-make-real', {}, { timeout: 15_000 });
  const newShots = view.queryAllByTestId(/^shot-\d+$/).length - 1;
  await rtl.waitFor(
    () => expect(boundary.diffusion.calls.generateImage.length - stillsBefore).toBe(newShots),
    { timeout: 20_000 },
  );
  // Each new shot shows its still; the opening shot is the clip itself.
  await rtl.waitFor(() => {
    const stills = view.UNSAFE_getAllByType(Image).filter(image => /generated_images/.test(String(image.props.source?.uri)));
    expect(stills.length).toBeGreaterThanOrEqual(newShots);
  }, { timeout: 10_000 });
}, 90_000);
