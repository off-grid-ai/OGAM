/**
 * A clip made before an iOS update still continues and still saves.
 *
 * SPEC (OGAM user's view): I made a clip. The app is updated (iOS gives it a new container; the clip moves
 * with it). Under the clip, Continue starts the next clip from its last frame, and Save in the viewer saves
 * that clip. (iPhone 17 Pro Max, 2026-10-28: the clip's saved path still named the old container, so reads
 * that used it as it was found no file.)
 *
 * The real App, twice. Between runs the storage is what an update leaves: the clip's saved path points into
 * the old container, while the file is in the current one. Device boundaries only: the llama.rn engine, the
 * disk, the RAM sensor, the native film composer (which reads a clip's last frame), Android's Downloads,
 * and Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, makeClipInChat, relaunchStudioApp } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

const LIGHT = 'off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4';
const CLIP = 'a red fox trotting through fresh snow';
/** The app container the clip was made in. iOS gives the updated app a new one. */
const OLD_CONTAINER = '/var/mobile/Containers/Data/Application/F2899DBD-0000-4000-8000-000000000000/Documents';

it('after an update, Continue starts from the clip\'s last frame and Save saves the clip', async () => {
  const first = await launchStudioApp(undefined, { phoneEngine: true });
  await makeClipInChat(first, CLIP);
  const docs = first.boundary.fs!.DocumentDirectoryPath;
  const kept = first.boundary.fs!.listFiles(`${docs}/generated-videos`).map(path => ({ path, size: 64 * 1024 }));
  expect(kept.length).toBeGreaterThan(0);

  // The update: storage still names the old container.
  const storage = require('@react-native-async-storage/async-storage');
  const saved = JSON.parse(await storage.getItem('local-llm-app-storage'));
  for (const video of saved.state.generatedVideos as Array<{ videoPath: string }>)
    video.videoPath = video.videoPath.replace(docs, OLD_CONTAINER);
  await storage.setItem('local-llm-app-storage', JSON.stringify(saved));

  const app = await relaunchStudioApp({ phoneEngine: true, keptFiles: kept });
  const { view, rtl } = app;
  const downloads: Array<{ source: string }> = [];
  require('react-native').NativeModules.SyncDownloadsModule = {
    saveFileToDownloads: async (source: string) => {
      downloads.push({ source });
      return true;
    },
  };
  rtl.fireEvent.press(await view.findByTestId('chats-tab'));
  rtl.fireEvent.press(await view.findByTestId('conversation-item-0', {}, { timeout: 10_000 }));

  // Continue: the clip's last frame goes to the computer.
  app.models.install(LIGHT);
  rtl.fireEvent.press(await view.findByTestId('video-continue', {}, { timeout: 10_000 }));
  rtl.fireEvent.press(await view.findByTestId('start-picture-use', {}, { timeout: 10_000 }));
  await rtl.waitFor(() => expect(app.stories.submissions).toHaveLength(1), { timeout: 15_000 });
  const sent = app.stories.submissions[0] as { init_images: Record<string, string> };
  expect(Object.values(sent.init_images)[0]).toMatch(/^data:image\/png;base64,/);
  rtl.fireEvent.press(view.getByTestId('start-picture-done'));

  // Save, from the viewer: the clip in this container is what is saved.
  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  rtl.fireEvent.press(await view.findByTestId('home-tab'));
  rtl.fireEvent.press(await view.findByTestId('home-gallery-card', {}, { timeout: 10_000 }));
  await view.findByTestId('gallery-screen');
  rtl.fireEvent.press(view.getByTestId('gallery-tab-videos'));
  await view.findByTestId('library-grid', {}, { timeout: 10_000 });
  rtl.fireEvent.press((await view.findAllByTestId(/^library-item-/, {}, { timeout: 10_000 }))[0]);
  rtl.fireEvent.press(await view.findByTestId('viewer-save', {}, { timeout: 10_000 }));
  await rtl.waitFor(() => expect(downloads).toHaveLength(1));
  expect(downloads[0].source.startsWith(docs)).toBe(true);
}, 120_000);
