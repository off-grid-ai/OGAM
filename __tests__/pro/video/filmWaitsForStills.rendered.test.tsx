/**
 * Make it real, tapped while the storyboard's stills are still being drawn, makes the film.
 *
 * SPEC (OGAM user's view): on my iPhone I describe a clip, then Make it a story. The storyboard starts
 * drawing a still for each shot with my image model. I tap Make it real at once. The film waits for the
 * stills, then is made on the phone; it never fails with "Video generation is already running."
 * (iPhone 17 Pro Max, 2026-10-28: it did, because stills and clips share the phone's one sd.cpp engine.)
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor, the native
 * background downloads, and the phone's sd.cpp image-and-video engine and film composer (nativeVideoEngine).
 */
jest.unmock('@react-navigation/native');

import { GB, type NativeBoundary } from '../../harness/nativeBoundary';
import { launchApp, passOnboarding, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';
import { installNativeVideoEngine, phoneDownloads, type NativeVideoEngine } from '../../harness/nativeVideoEngine';

const VIDEO = { id: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', name: 'Wan 2.1 (1.3B), FP16', files: 3 };
const IMAGE_ID = 'phone-lane-sd-pack';

let app: AnalyticsApp | undefined;

afterEach(() => {
  if (app) require('../../../pro/video/studio/filmRenderer').stopAllRenders();
  app?.view.unmount();
  app?.endpoint.restore();
  app = undefined;
  restoreBuildFlavor();
});

/** An sd.cpp image pack as a finished download leaves it: every file of a catalog pack on disk, and its record. */
function placeSdImagePack(boundary: NativeBoundary): void {
  const { getSDImageModels } = require('../../../src/services/huggingFaceModelBrowser');
  const { sdImagePackFor } = require('@offgrid/models');
  const template = getSDImageModels().find(
    (model: { fileName: string; huggingFaceFiles?: unknown[] }) => sdImagePackFor(model.fileName) && model.huggingFaceFiles?.length,
  );
  const directory = `${boundary.fs!.DocumentDirectoryPath}/image_models/${IMAGE_ID}`;
  for (const file of template.huggingFaceFiles as Array<{ path: string }>) boundary.fs!.seedFile(`${directory}/${file.path}`, 1024 * 1024);
  const { createONNXImageModel } = require('../../utils/factories');
  const model = createONNXImageModel({ id: IMAGE_ID, name: 'Phone Lane Image', modelPath: directory, backend: 'sd', size: GB });
  require('@react-native-async-storage/async-storage').setItem('@local_llm/downloaded_image_models', JSON.stringify([model]));
}

it('Make it real while the stills are drawn waits for them, then makes the film', async () => {
  let engine!: NativeVideoEngine;
  app = await launchApp({ release: false, download: true, beforeApp: boundary => {
    boundary.setRam({ platform: 'ios', totalBytes: 12 * GB, availBytes: 5.9 * GB });
    placeSdImagePack(boundary);
    engine = installNativeVideoEngine(boundary);
  } });
  await passOnboarding(app, false);
  await require('../../harness/proHarness').installPro();
  const { view, rtl } = app;
  const downloads = phoneDownloads(app.boundary, rtl.act);

  // Models › Video › Download: every file of the pack finishes.
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(VIDEO.name, {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByLabelText(`Download ${VIDEO.name}`));
  let finished = 0;
  await rtl.waitFor(async () => {
    finished += await downloads.finishRunning();
    expect(finished).toBe(VIDEO.files);
  }, { timeout: 15_000 });
  await rtl.waitFor(() => expect(view.getAllByLabelText('Delete model').length).toBeGreaterThan(0), { timeout: 10_000 });

  // Home: pick the image model and the video model.
  rtl.fireEvent.press(await view.findByTestId('home-tab'));
  rtl.fireEvent.press(await view.findByTestId('model-summary-image-open'));
  rtl.fireEvent.press(await view.findByTestId(`image-model-row-${IMAGE_ID}`, {}, { timeout: 5000 }));
  await rtl.waitFor(() => expect(require('../../../src/stores').useAppStore.getState().activeImageModelId).toBe(IMAGE_ID));
  rtl.fireEvent.press(await view.findByTestId('home-tab'));
  rtl.fireEvent.press(await view.findByTestId('model-summary-video-open'));
  rtl.fireEvent.press(await view.findByTestId(`video-model-row-${VIDEO.id}-select`, {}, { timeout: 5000 }));

  // A clip in a chat in video mode, then Make it a story.
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a candle flame flickering in the dark');
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
  engine.holdImages();
  rtl.fireEvent.press(await view.findByTestId('video-make-story', {}, { timeout: 15_000 }));

  // The storyboard is drawing its stills (held), and Make it real is tapped at once.
  await rtl.waitFor(() => expect(engine.images.length).toBeGreaterThan(0), { timeout: 15_000 });
  expect(engine.films).toHaveLength(0);
  rtl.fireEvent.press(await view.findByTestId('film-make-real', {}, { timeout: 10_000 }));
  await view.findByTestId('video-making', {}, { timeout: 10_000 });
  engine.releaseImages();

  rtl.fireEvent.press(await view.findByTestId('making-watch', {}, { timeout: 30_000 }));
  await view.findByTestId('video-viewer', {}, { timeout: 10_000 });
  expect(view.queryByText(/already running/)).toBeNull();
  expect(engine.films).toHaveLength(1);
}, 120_000);
