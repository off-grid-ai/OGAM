/**
 * Video work on the paired computer survives the app closing.
 *
 * SPEC (OGAM user's view): if I close the app while my computer is making a clip, the chat says the
 * connection was interrupted when I come back, and Retry checks the same job on the computer — no
 * second clip is started — and the clip lands in the chat, or the computer's reason it could not. A film the computer was making when I
 * closed the app carries on by itself, and arrives.
 *
 * The real App runs, closed and opened again (storage kept). Device boundaries only: the llama.rn
 * engine, the disk, the RAM sensor and Desktop's gateway at `fetch`, which keeps its jobs running
 * while the phone is closed.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, makeClipInChat, relaunchStudioApp, type StudioApp } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

const CLIP = 'a paper boat drifting on a pond';

/** On the Chats list, the one chat there: it shows its title, and opens. */
async function openOnlyChat(current: StudioApp, title: string): Promise<void> {
  const { view, rtl } = current;
  const row = await view.findByTestId('conversation-item-0', {}, { timeout: 10_000 });
  expect(view.queryByTestId('conversation-item-1')).toBeNull();
  expect(rtl.within(row).getByText(title)).toBeTruthy();
  rtl.fireEvent.press(row);
}

it('a clip interrupted by closing the app is picked up again with Retry, from the same job', async () => {
  const first = await launchStudioApp();
  first.jobs.hold();
  const making = makeClipInChat(first, CLIP).catch(() => undefined);
  await first.rtl.waitFor(() => expect(first.jobs.submissions).toHaveLength(1), { timeout: 15_000 });
  await first.view.findByTestId('video-progress', {}, { timeout: 10_000 });

  const app = await relaunchStudioApp();
  await making;
  const { view, rtl } = app;
  app.jobs.release();
  rtl.fireEvent.press(await view.findByTestId('chats-tab'));
  await openOnlyChat(app, CLIP);
  await view.findByText(/The connection was interrupted/, {}, { timeout: 10_000 });
  expect(view.queryByTestId('chat-clip-card')).toBeNull();
  rtl.fireEvent.press(view.getByTestId('model-failure-retry-video'));
  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
  // The same job on the computer (its client job id), not a second clip.
  expect(new Set(app.jobs.submissions.map(sent => sent.client_job_id)).size).toBe(1);
}, 90_000);

it('a film the computer was making when the app closed carries on and arrives', async () => {
  const first = await launchStudioApp();
  await makeClipInChat(first, CLIP);
  first.rtl.fireEvent.press(await first.view.findByTestId('video-make-story'));
  first.stories.hold();
  first.rtl.fireEvent.press(await first.view.findByTestId('film-make-real', {}, { timeout: 15_000 }));
  await first.rtl.waitFor(() => expect(first.stories.submissions).toHaveLength(1), { timeout: 10_000 });

  const app = await relaunchStudioApp();
  const { view, rtl } = app;
  app.stories.release();
  rtl.fireEvent.press(await view.findByTestId('home-gallery-card', {}, { timeout: 10_000 }));
  rtl.fireEvent.press(await view.findByTestId('gallery-tab-videos'));
  await view.findByTestId('library-grid', {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByTestId('library-tab-stories'));
  rtl.fireEvent.press((await view.findAllByTestId(/^library-item-/, {}, { timeout: 10_000 }))[0]);
  // Opened while it is still being made, then Watch; or straight to the film once it is there.
  await rtl.waitFor(
    () => expect(view.queryByTestId('making-watch') ?? view.queryByTestId('video-viewer')).not.toBeNull(),
    { timeout: 30_000 },
  );
  const watch = view.queryByTestId('making-watch');
  if (watch) rtl.fireEvent.press(watch);
  await view.findByTestId('video-viewer', {}, { timeout: 10_000 });
  // The film the computer was already making, not a second one.
  expect(new Set(app.stories.submissions.map(sent => (sent as { story: { id: string } }).story.id)).size).toBe(1);
}, 120_000);

it('Retry on an interrupted clip the computer could not make says the computer\'s reason', async () => {
  const first = await launchStudioApp();
  first.jobs.hold();
  const making = makeClipInChat(first, CLIP).catch(() => undefined);
  await first.rtl.waitFor(() => expect(first.jobs.submissions).toHaveLength(1), { timeout: 15_000 });
  await first.view.findByTestId('video-progress', {}, { timeout: 10_000 });

  const app = await relaunchStudioApp();
  await making;
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('chats-tab'));
  await openOnlyChat(app, CLIP);
  await view.findByText(/The connection was interrupted/, {}, { timeout: 10_000 });
  app.jobs.failRunning('The video model ran out of memory on this computer.');
  app.jobs.release();
  rtl.fireEvent.press(view.getByTestId('model-failure-retry-video'));
  await view.findByText(/The video model ran out of memory on this computer\./, {}, { timeout: 15_000 });
  expect(view.queryByTestId('chat-clip-card')).toBeNull();
}, 90_000);
