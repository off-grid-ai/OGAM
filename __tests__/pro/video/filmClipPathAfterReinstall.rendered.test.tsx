/**
 * A film whose clip was made before an iOS update or reinstall still joins.
 *
 * SPEC (OGAM user's view): on my iPhone I make a clip and Make it a story. The app is updated (iOS gives
 * it a new container; my clip moves with it). I open the film's storyboard and Make it real: the film is
 * joined and plays. It never fails with "A clip has no video." (iPhone 17 Pro Max, 2026-10-28: it did,
 * because the clip's saved path still named the old container.)
 *
 * The real App, twice. Between runs the storage is what an update leaves: the clip's saved path points
 * into the old container, while the clip file itself is in the current one. Device boundaries only: the
 * llama.rn engine, the disk, the RAM sensor, the native downloads, the video engine and film composer.
 */
jest.unmock('@react-navigation/native');

import { GB } from '../../harness/nativeBoundary';
import { launchApp, passOnboarding, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';
import { installNativeVideoEngine, phoneDownloads, type NativeVideoEngine } from '../../harness/nativeVideoEngine';

const VIDEO = { id: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', name: 'Wan 2.1 (1.3B), FP16', files: 3 };
/** The app container the clip was made in. iOS gives the updated app a new one. */
const OLD_CONTAINER = '/var/mobile/Containers/Data/Application/F2899DBD-0000-4000-8000-000000000000/Documents';

let app: AnalyticsApp | undefined;

afterEach(() => {
  if (app) require('../../../pro/video/studio/filmRenderer').stopAllRenders();
  app?.view.unmount();
  app?.endpoint.restore();
  app = undefined;
  restoreBuildFlavor();
});

it('a clip saved before an update still joins into a film that plays', async () => {
  // First run: download Wan 2.1, make a clip in a chat, then Make it a story.
  let engine!: NativeVideoEngine;
  app = await launchApp({ release: false, download: true, platform: 'ios', beforeApp: boundary => {
    boundary.setRam({ platform: 'ios', totalBytes: 12 * GB, availBytes: 5.9 * GB });
    engine = installNativeVideoEngine(boundary);
  } });
  await passOnboarding(app, false);
  await require('../../harness/proHarness').installPro();
  {
    const { view, rtl } = app;
    const downloads = phoneDownloads(app.boundary, rtl.act);
    rtl.fireEvent.press(await view.findByTestId('models-tab'));
    rtl.fireEvent.press(await view.findByText('Video'));
    await view.findByText(VIDEO.name, {}, { timeout: 10_000 });
    rtl.fireEvent.press(view.getByLabelText(`Download ${VIDEO.name}`));
    let finished = 0;
    await rtl.waitFor(async () => {
      finished += await downloads.finishRunning();
      expect(finished).toBe(VIDEO.files);
    }, { timeout: 15_000 });
    await rtl.waitFor(() => expect(view.getAllByLabelText('Delete model').length).toBeGreaterThan(0), { timeout: 10_000 });
    rtl.fireEvent.press(await view.findByTestId('home-tab'));
    rtl.fireEvent.press(await view.findByTestId('model-summary-video-open'));
    rtl.fireEvent.press(await view.findByTestId(`video-model-row-${VIDEO.id}`, {}, { timeout: 5000 }));
    rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
    await view.findByTestId('chat-input');
    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a paper lantern floating upward');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
    rtl.fireEvent.press(await view.findByTestId('video-make-story', {}, { timeout: 15_000 }));
    await view.findByTestId('film-make-real', {}, { timeout: 15_000 });
  }
  const docs = app.boundary.fs!.DocumentDirectoryPath;
  // The clip: the file the update carries into the new container (the video model is put back below).
  const files = app.boundary.fs!.listFiles(`${docs}/generated-videos`).map(path => ({ path, size: 64 * 1024 }));
  expect(files.length).toBeGreaterThan(0);
  app.view.unmount();
  app.endpoint.restore();

  // The update: iOS moves the app's files to a new container; storage still names the old one.
  const storage = require('@react-native-async-storage/async-storage');
  const saved = JSON.parse(await storage.getItem('local-llm-app-storage'));
  const clips = saved.state.generatedVideos as Array<{ videoPath: string }>;
  expect(clips.length).toBeGreaterThan(0);
  for (const clip of clips) clip.videoPath = clip.videoPath.replace(docs, OLD_CONTAINER);
  await storage.setItem('local-llm-app-storage', JSON.stringify(saved));

  // Second run, on the files the update kept in the current container.
  app = await launchApp({ release: false, relaunch: true, download: true, platform: 'ios', beforeApp: boundary => {
    boundary.setRam({ platform: 'ios', totalBytes: 12 * GB, availBytes: 5.9 * GB });
    for (const file of files) boundary.fs!.seedFile(file.path, file.size);
    const { videoModelDirectory } = require('../../../src/services/videoModelFiles');
    const entry = require('@offgrid/models').CATALOG.find((model: { id: string }) => model.id === VIDEO.id);
    for (const file of entry.files) boundary.fs!.seedFile(`${videoModelDirectory(VIDEO.id)}/${file.name}`, file.sizeBytes);
    engine = installNativeVideoEngine(boundary);
  } });
  await require('../../harness/proHarness').installPro();
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('chats-tab'));
  rtl.fireEvent.press(await view.findByTestId('conversation-item-0', {}, { timeout: 10_000 }));
  const card = (await view.findAllByTestId('film-card', {}, { timeout: 10_000 })).pop()!;
  rtl.fireEvent.press(rtl.within(card).getAllByRole('button')[0]);
  rtl.fireEvent.press(await view.findByTestId('film-make-real', {}, { timeout: 10_000 }));
  rtl.fireEvent.press(await view.findByTestId('making-watch', {}, { timeout: 30_000 }));
  await view.findByTestId('video-viewer', {}, { timeout: 10_000 });
  expect(view.queryByText('A clip has no video.')).toBeNull();
  expect(engine.films).toHaveLength(1);
  expect(engine.films[0].clips[0].path.startsWith(docs)).toBe(true);
}, 120_000);
