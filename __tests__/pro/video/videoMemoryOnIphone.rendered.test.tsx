/**
 * An iPhone with the free memory a real one has makes a clip without being told it is short of memory.
 *
 * SPEC (OGAM user's view): on an iPhone 17 Pro Max (12 GB, about 5.9 GB free to the app) I download
 * Wan 2.1, describe a clip in a chat in video mode and Send: the clip is made on the phone. I am not
 * told the phone is short of memory, because it is not: iOS memory-maps the model's weights, and the
 * clip's own footprint peaked at 1.2 GB on that phone.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor, the
 * native background downloads and the phone's video engine (nativeVideoEngine).
 */
jest.unmock('@react-navigation/native');

import { GB } from '../../harness/nativeBoundary';
import { launchApp, passOnboarding, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';
import { installNativeVideoEngine, phoneDownloads, type NativeVideoEngine } from '../../harness/nativeVideoEngine';

const MODEL = { id: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', name: 'Wan 2.1 (1.3B), FP16', files: 3 };

let app: AnalyticsApp | undefined;

afterEach(() => {
  if (app) require('../../../pro/video/studio/filmRenderer').stopAllRenders();
  app?.view.unmount();
  app?.endpoint.restore();
  app = undefined;
  restoreBuildFlavor();
});

it('an iPhone with 5.9 GB free makes a clip without asking to run anyway', async () => {
  let engine!: NativeVideoEngine;
  app = await launchApp({ release: false, download: true, beforeApp: boundary => {
    // What the iPhone 17 Pro Max reported (Settings › Device Information): 11.4 GB, 5.9 GB available.
    boundary.setRam({ platform: 'ios', totalBytes: 12 * GB, availBytes: 5.9 * GB });
    engine = installNativeVideoEngine(boundary);
  } });
  await passOnboarding(app, false);
  await require('../../harness/proHarness').installPro();
  const { view, rtl } = app;
  const downloads = phoneDownloads(app.boundary, rtl.act);

  // Models › Video › Download: every file of the pack finishes.
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(MODEL.name, {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByLabelText(`Download ${MODEL.name}`));
  let finished = 0;
  await rtl.waitFor(async () => {
    finished += await downloads.finishRunning();
    expect(finished).toBe(MODEL.files);
  }, { timeout: 15_000 });
  await rtl.waitFor(() => expect(view.getAllByLabelText('Delete model').length).toBeGreaterThan(0), { timeout: 10_000 });

  // Home › the video model, a new chat in video mode, Send.
  rtl.fireEvent.press(await view.findByTestId('home-tab'));
  rtl.fireEvent.press(await view.findByTestId('model-summary-video-open'));
  rtl.fireEvent.press(await view.findByTestId(`video-model-row-${MODEL.id}-select`, {}, { timeout: 5000 }));
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a paper boat on a calm pond');
  // BEFORE Send: nothing made yet.
  expect(engine.generations).toHaveLength(0);
  rtl.fireEvent.press(view.getByTestId('send-button'));

  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
  expect(view.queryByText('Run anyway')).toBeNull();
  expect(view.queryByText(/Not enough available memory/)).toBeNull();
  expect(engine.generations).toHaveLength(1);
}, 90_000);
