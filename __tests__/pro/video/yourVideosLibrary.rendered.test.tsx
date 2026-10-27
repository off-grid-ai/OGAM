/**
 * Your videos: the Library behind the Gallery's Videos tab.
 *
 * SPEC (OGAM user's view): with Pro, the Gallery's Videos tab opens "Your videos": every story and
 * clip I made, newest first, with All / Stories / Clips. A tab with nothing says so. Opening a clip
 * plays it full screen; New shot there makes the next clip on my computer and shows it being made,
 * then Watch plays it. Delete asks first and removes the clip from the list. The + starts a new
 * video in a chat.
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
  rtl.fireEvent.press(await view.findByText('Image Gallery', {}, { timeout: 10_000 }));
  await view.findByTestId('gallery-screen');
  rtl.fireEvent.press(view.getByText(/^Videos \(/));
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
  expect(view.getByTestId('viewer-new-shot')).toBeTruthy();
}, 60_000);

it('New shot from the viewer is made on the computer, then Watch plays it', async () => {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  await makeClipInChat(app, CLIP);
  await openLibrary(app);
  rtl.fireEvent.press(view.getAllByTestId(/^library-item-/)[0]);
  await view.findByTestId('video-viewer', {}, { timeout: 10_000 });

  app.stories.hold();
  rtl.fireEvent.press(view.getByTestId('viewer-new-shot'));
  await view.findByTestId('video-making', {}, { timeout: 10_000 });
  // The next clip is a one-shot film on the computer, from this clip's description.
  await rtl.waitFor(() => expect(app.stories.submissions).toHaveLength(1), { timeout: 10_000 });
  expect(JSON.stringify(app.stories.submissions[0])).toContain(CLIP);
  expect(view.queryByTestId('making-watch')).toBeNull();
  app.stories.release();
  rtl.fireEvent.press(await view.findByTestId('making-watch', {}, { timeout: 20_000 }));
  // Watch goes back to the viewer, now on the new clip.
  await rtl.waitFor(() => expect(view.queryByTestId('video-making')).toBeNull());
  expect(view.getByTestId('video-viewer')).toBeTruthy();
  expect(view.getByText(/new camera angle/i)).toBeTruthy();
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
