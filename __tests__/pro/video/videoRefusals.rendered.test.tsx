/**
 * A clip that cannot be made says why.
 *
 * SPEC (OGAM user's view): when I describe a clip in video mode and the app will not make it (the
 * description breaks the video rules), I am told why, and nothing is sent to my computer. When my
 * computer cannot make a clip, the chat says the computer's reason once, on its failure card.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor and
 * Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

async function videoChat(app: Awaited<ReturnType<typeof launchStudioApp>>): Promise<void> {
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
}

it('a clip the computer cannot make shows the computer\'s reason once, on its failure card', async () => {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  await videoChat(app);
  app.jobs.hold();
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a lighthouse in a storm');
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await rtl.waitFor(() => expect(app.jobs.submissions).toHaveLength(1), { timeout: 15_000 });
  app.jobs.failRunning('The video model ran out of memory on this computer.');
  app.jobs.release();
  await view.findByText(/The video model ran out of memory on this computer\./, {}, { timeout: 15_000 });
  expect(view.getAllByText(/The video model ran out of memory on this computer\./)).toHaveLength(1);
  expect(view.queryByText('Could not make the video')).toBeNull();
  expect(view.queryByTestId('chat-clip-card')).toBeNull();
}, 90_000);

it('a description the video rules refuse says why, and nothing reaches the computer', async () => {
  const app = await launchStudioApp();
  const { view, rtl } = app;
  await videoChat(app);
  expect(view.queryByText("This video can't be made.")).toBeNull();
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a deepfake porn clip of a celebrity');
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await view.findByText("This video can't be made.", {}, { timeout: 10_000 });
  expect(app.jobs.submissions).toHaveLength(0);
  expect(view.queryByTestId('chat-clip-card')).toBeNull();
}, 90_000);
