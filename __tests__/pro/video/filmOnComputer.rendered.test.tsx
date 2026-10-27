/**
 * A film made on the paired computer, from a clip in chat.
 *
 * SPEC (OGAM user's view): under a clip I tap Make it a story, then Make it real. A Making screen
 * shows the film being made on my computer — how far it is, the time left, and Stop — and I can go
 * back to the storyboard, which shows the same progress with one tile per shot. When the computer
 * finishes, the film comes to the phone: the Making screen says how long it is and offers Watch.
 * If I stop it, the computer is told and I can try again; if the computer fails, I see why.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor and
 * Desktop's gateway at `fetch` (its video jobs, model manager and `/v1/stories` film jobs, in
 * Desktop's own wire shapes).
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, makeClipInChat, type StudioApp } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

const SENTENCE = 'a red fox trotting through fresh snow';

/** From the clip in chat to the storyboard, then Make it real, with the computer holding the film. */
async function filmUnderway(): Promise<StudioApp> {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  await makeClipInChat(app, SENTENCE);
  rtl.fireEvent.press(await view.findByTestId('video-make-story'));
  const makeReal = await view.findByTestId('film-make-real', {}, { timeout: 15_000 });
  expect(view.queryByTestId('video-making')).toBeNull();
  app.stories.hold();
  rtl.fireEvent.press(makeReal);
  await view.findByTestId('video-making', {}, { timeout: 10_000 });
  await rtl.waitFor(() => expect(app.stories.submissions).toHaveLength(1), { timeout: 10_000 });
  return app;
}

it('shows the film being made on the computer, then plays it when it comes to the phone', async () => {
  const app = await filmUnderway();
  const { view, rtl } = app;
  // In flight: progress, where it runs, and Stop — no Watch yet.
  expect(view.getByTestId('making-progress')).toBeTruthy();
  expect(view.getByTestId('making-stop')).toBeTruthy();
  expect(view.queryByTestId('making-watch')).toBeNull();

  // The storyboard underneath shows the same film in progress, one tile per shot.
  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  await view.findByTestId('film-progress');
  expect(view.getByTestId('shot-strip')).toBeTruthy();
  expect(view.getByLabelText('On your computer')).toBeTruthy();
  expect(view.getAllByLabelText(/^Shot 1, /).length).toBeGreaterThan(0);

  app.stories.release();
  // The film arrives: the storyboard plays it and the progress is gone.
  await view.findByTestId('film-player', {}, { timeout: 30_000 });
  expect(view.queryByTestId('film-progress')).toBeNull();
}, 60_000);

it('Stop on the Making screen stops the film on the computer and offers Try again', async () => {
  const app = await filmUnderway();
  const { view, rtl } = app;
  expect(view.queryByTestId('making-retry')).toBeNull();
  rtl.fireEvent.press(view.getByTestId('making-stop'));
  await view.findByTestId('making-retry', {}, { timeout: 10_000 });
  expect(view.queryByTestId('making-stop')).toBeNull();
  expect(app.stories.cancels).toHaveLength(1);
}, 60_000);

it('a film the computer cannot make says why, and Try again sends it again', async () => {
  const app = await filmUnderway();
  const { view, rtl } = app;
  app.stories.failNext('Not enough memory for this film.');
  app.stories.release();
  await view.findByText('Not enough memory for this film.', {}, { timeout: 30_000 });
  rtl.fireEvent.press(view.getByTestId('making-retry'));
  await rtl.waitFor(() => expect(app.stories.submissions).toHaveLength(2), { timeout: 10_000 });
  await view.findByTestId('making-watch', {}, { timeout: 30_000 });
}, 90_000);

it('the finished film plays under its title, made on the computer, and Delete there removes it', async () => {
  const app = await filmUnderway();
  const { view, rtl } = app;
  app.stories.release();
  rtl.fireEvent.press(await view.findByTestId('making-watch', {}, { timeout: 30_000 }));
  await view.findByTestId('video-viewer', {}, { timeout: 10_000 });
  expect(view.getByText(/^Made with AI · on /)).toBeTruthy();
  rtl.fireEvent.press(view.getByTestId('viewer-delete'));
  expect(app.dialog()?.title).toBe('Delete this video?');
  await app.answer('Delete');
  await rtl.waitFor(() => expect(view.queryByTestId('video-viewer')).toBeNull(), { timeout: 10_000 });
  // Back on Making, the film and its story are gone.
  await view.findByText('This video was deleted.', {}, { timeout: 10_000 });
  expect(view.queryByTestId('making-watch')).toBeNull();
}, 90_000);
