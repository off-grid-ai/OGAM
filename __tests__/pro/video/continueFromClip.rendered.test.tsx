/**
 * Continue a clip from where it ended, on the paired computer.
 *
 * SPEC (OGAM user's view): under a clip in chat, Continue makes the next clip start from this one's
 * last frame. Once my computer has a model that can start from a picture, Continue sends that frame
 * (the app's own picture, not a photo of a person) with a description that carries the action on,
 * and the next clip lands in the chat.
 *
 * The real App runs, as a phone build with its film composer (which reads a clip's last frame).
 * Device boundaries only: the llama.rn engine, the disk, the RAM sensor, the native film composer
 * and Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, makeClipInChat } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

const LIGHT = 'off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4';
const CLIP = 'a red fox trotting through fresh snow';

it('Continue sends the clip\'s last frame to the computer, and the next clip lands', async () => {
  const app = await launchStudioApp(undefined, { phoneEngine: true });
  const { view, rtl } = app;
  await makeClipInChat(app, CLIP);
  app.models.install(LIGHT);
  rtl.fireEvent.press(await view.findByTestId('video-continue'));
  app.stories.hold();
  rtl.fireEvent.press(await view.findByTestId('start-picture-use', {}, { timeout: 10_000 }));
  await view.findByText('Wan 2.2 (5B), Light is ready.', {}, { timeout: 15_000 });
  // Ready: Continue carries on by itself with the frame.
  await rtl.waitFor(() => expect(app.stories.submissions).toHaveLength(1), { timeout: 15_000 });
  const sent = app.stories.submissions[0] as {
    consent: boolean;
    init_images: Record<string, string>;
    story: { shots: Array<{ prompt: string; start: string; initImageSource?: string }> };
  };
  expect(Object.values(sent.init_images)).toHaveLength(1);
  expect(Object.values(sent.init_images)[0]).toMatch(/^data:image\/png;base64,/);
  expect(sent.story.shots[0]).toMatchObject({ start: 'continue', initImageSource: 'generated' });
  expect(sent.story.shots[0].prompt).toContain(CLIP);

  rtl.fireEvent.press(view.getByTestId('start-picture-done'));
  app.stories.release();
  // The next clip is ready in the chat, with its own Continue under it.
  expect(view.getAllByTestId('video-continue')).toHaveLength(1);
  await rtl.waitFor(() => expect(view.getAllByTestId('video-continue')).toHaveLength(2), { timeout: 30_000 });
}, 90_000);
