/**
 * A clip made on the paired computer shows its first frame while it is made.
 *
 * SPEC (OGAM user's view): while my computer makes a clip I described in a chat, the chat shows its
 * progress and, once the computer has one, a live preview of the clip; when the clip lands the
 * preview gives way to it.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor and
 * Desktop's gateway at `fetch` (its poll's `preview` and the job's /preview PNG, as Desktop serves them).
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, makeClipInChat } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

it('shows the computer\'s live preview while the clip is made, then the clip', async () => {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  app.jobs.showPreviews();
  app.jobs.hold();
  const making = makeClipInChat(app, 'a lighthouse beam sweeping the sea');
  await view.findByLabelText('Live preview of the clip', {}, { timeout: 15_000 });
  expect(view.getByTestId('video-progress')).toBeTruthy();
  expect(view.queryByTestId('chat-clip-card')).toBeNull();
  app.jobs.release();
  await making;
  await rtl.waitFor(() => expect(view.queryByLabelText('Live preview of the clip')).toBeNull());
  expect(view.getByTestId('chat-clip-card')).toBeTruthy();
}, 60_000);
