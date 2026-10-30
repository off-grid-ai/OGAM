/**
 * Your videos: the Library behind the Gallery's Videos tab.
 *
 * SPEC (OGAM user's view): with Pro, the Gallery's Videos tab opens "Your videos": every story and
 * clip I made, newest first, with All / Stories / Clips. A tab with nothing says so. Opening a clip
 * plays it full screen; New shot there makes the next clip on my computer and shows it being made,
 * then Watch plays it. Delete asks first and removes the clip from the list. The + starts a new
 * video in a chat. The Studio sits at its top: one sentence starts a film, and New character opens
 * the character screen.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor, the OS
 * dialog, and Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, makeClipInChat, type StudioApp } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

const CLIP = 'a paper boat drifting on a pond';

/** From the chat: back Home, the Gallery card, then its Videos tab. */
async function openLibrary(app: StudioApp): Promise<void> {
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  rtl.fireEvent.press(await view.findByTestId('home-gallery-card', {}, { timeout: 10_000 }));
  await view.findByTestId('gallery-screen');
  rtl.fireEvent.press(view.getByTestId('gallery-tab-videos'));
  await view.findByTestId('library-grid', {}, { timeout: 10_000 });
}

it('lists the clip under All and Clips, not Stories, and plays it full screen', async () => {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  await makeClipInChat(app, CLIP);
  await openLibrary(app);

  expect(view.getByText(CLIP)).toBeTruthy();
  rtl.fireEvent.press(view.getByTestId('library-tab-stories'));
  await view.findByText('No stories yet.');
  expect(view.queryByText(CLIP)).toBeNull();
  rtl.fireEvent.press(view.getByTestId('library-tab-clips'));
  await view.findByText(CLIP);
  expect(view.queryByText('No stories yet.')).toBeNull();

  const item = view.getAllByTestId(/^library-item-/);
  expect(item).toHaveLength(1);
  rtl.fireEvent.press(item[0]);
  await view.findByTestId('video-viewer', {}, { timeout: 10_000 });
  expect(view.getByTestId('viewer-continue')).toBeTruthy();
  expect(view.queryByTestId('viewer-new-shot')).toBeNull();
}, 60_000);

it('Delete asks first, then removes the clip; + opens a chat', async () => {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  await makeClipInChat(app, CLIP);
  await openLibrary(app);
  rtl.fireEvent.press(view.getAllByTestId(/^library-item-/)[0]);
  rtl.fireEvent.press(await view.findByTestId('viewer-delete', {}, { timeout: 10_000 }));
  expect(app.dialog()?.title).toBe('Delete this video?');
  await app.answer('Delete');
  await view.findByText('Describe a video in a chat to make your first one.', {}, { timeout: 10_000 });
  expect(view.queryByText(CLIP)).toBeNull();

  rtl.fireEvent.press(view.getByTestId('library-new'));
  await view.findByTestId('chat-input', {}, { timeout: 10_000 });
}, 60_000);

it('the viewer pauses on a tap and saves the clip to Downloads', async () => {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  // Android's Downloads, at the native boundary (MediaStore through SyncDownloadsModule).
  const saved: Array<{ name: string; mime: string }> = [];
  require('react-native').NativeModules.SyncDownloadsModule = {
    saveFileToDownloads: async (_source: string, name: string, mime: string) => {
      saved.push({ name, mime });
      return true;
    },
  };
  await makeClipInChat(app, CLIP);
  await openLibrary(app);
  rtl.fireEvent.press(view.getAllByTestId(/^library-item-/)[0]);
  const toggle = await view.findByTestId('viewer-toggle', {}, { timeout: 10_000 });
  expect(toggle.props.accessibilityLabel).toBe('Pause');
  rtl.fireEvent.press(toggle);
  await rtl.waitFor(() => expect(view.getByTestId('viewer-toggle').props.accessibilityLabel).toBe('Play'));

  expect(saved).toHaveLength(0);
  rtl.fireEvent.press(view.getByTestId('viewer-save'));
  await rtl.waitFor(() => expect(app.dialog()?.title).toBe('Saved to Downloads'));
  expect(app.dialog()?.message).toBeUndefined();
  expect(saved).toEqual([{ name: expect.stringMatching(/\.mp4$/), mime: 'video/mp4' }]);
}, 60_000);

it('the Studio is at the top: one sentence starts a film, and New character opens a character', async () => {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  await makeClipInChat(app, CLIP);
  await openLibrary(app);

  expect(view.getByTestId('new-film-sentence')).toBeTruthy();
  expect(view.getByTestId('new-film-go')).toBeTruthy();
  rtl.fireEvent.press(view.getByLabelText('New character'));
  await view.findByTestId('character-name', {}, { timeout: 10_000 });
}, 60_000);
