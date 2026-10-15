/**
 * proHarness — activate the PRO feature set (audio/voice mode, TTS, MCP, pro screens/settings) in a test,
 * the SAME way the app bootstrap does. Pro features register into core via the slot/hook/screen/settings
 * registries; core renders them by looking those up. Without this, a mounted screen shows only the free
 * shell (e.g. no header text/voice mode toggle, no audio-mode layout), so any real pro user-flow is
 * unreachable.
 *
 * Call AFTER installNativeBoundary() (so it registers into the same fresh module graph the screens read)
 * and BEFORE render(). Idempotent-ish: registering a slot twice just overwrites with the same component.
 *
 * This is the ONE reusable pro seam — voice-mode, TTS, and MCP flow tests all use it instead of hand-
 * registering individual slots per test.
 */
export async function installPro(): Promise<void> {
  // The real bootstrap requires @offgrid/pro and calls pro.activate({...registries}), registering every
  // pro slot (chatInput.modeToggle, chatInput.audioMode, message.speakButton, …). Nothing is gated any
  // more: a build with the bundle activates it with no licence, which is what this harness stands in for.
  const { loadProFeatures } = require('../../src/bootstrap/loadProFeatures');
  await loadProFeatures();
}

/** Start the real app over device storage. The returned controls use only visible gestures. */
export async function launchVoiceApp(options: {
  files?: Set<string>;
  preserveStorage?: boolean;
  cachedVoice?: boolean;
  delayedStorage?: boolean;
  configureRuntime?: () => void;
} = {}) {
  const { installNativeBoundary, requireRTL, GB } = require('./nativeBoundary');
  const boundary = installNativeBoundary({ fs: true, llama: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const cache = require('./kokoroResourceBoundary').installKokoroResourceBoundary(options.files);
  if (options.cachedVoice) cache.seedVoice();
  const storage = require('@react-native-async-storage/async-storage');
  if (!options.preserveStorage) {
    await storage.clear();
    const { createDownloadedModel } = require('../utils/factories');
    const model = createDownloadedModel({ id: 'm', name: 'Test Model', fileName: 'small.gguf', filePath: '/docs/models/small.gguf', engine: 'llama', fileSize: 500 * 1024 * 1024 });
    await storage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
    await storage.setItem('local-llm-app-storage', JSON.stringify({ state: {
      hasCompletedOnboarding: true, checklistDismissed: true,
      settings: { autoDiscoverRemoteModels: false },
    }, version: 0 }));
  }
  boundary.fs.seedFile('/docs/models/small.gguf', 500 * 1024 * 1024);
  if (options.delayedStorage) {
    const read = storage.getItem;
    storage.getItem = async (key: string) => {
      await new Promise(resolve => setTimeout(resolve, 40));
      return read(key);
    };
  }
  const executorch = require('react-native-executorch');
  executorch.useTextToSpeech = (_config: unknown, opts?: { preventLoad?: boolean }) => ({
    isReady: !opts?.preventLoad, downloadProgress: opts?.preventLoad ? 0 : 1, error: null,
    stream: async () => {}, streamStop: () => {},
  });
  options.configureRuntime?.();
  const React = require('react');
  const rtl = requireRTL();
  await installPro();
  const App = require('../../App').default;
  const view = rtl.render(React.createElement(App));
  await view.findByTestId('home-screen');
  return {
    boundary, cache, view, rtl,
    async voicePanel() {
      rtl.fireEvent.press(view.getByTestId('models-tab'));
      rtl.fireEvent.press(await view.findByTestId('voice-models-tab'));
      await view.findByTestId('voice-model-kokoro');
    },
    async downloadVoice() {
      rtl.fireEvent.press(await view.findByTestId('voice-model-kokoro-download'));
      await view.findByTestId('voice-model-kokoro-delete');
    },
    async chat() {
      rtl.fireEvent.press(view.getByTestId('home-tab'));
      rtl.fireEvent.press(view.getByTestId('browse-models-button'));
      rtl.fireEvent.press(await view.findByTestId('text-model-row-m'));
      await rtl.waitFor(() => expect(view.queryByTestId('text-model-row-m')).toBeNull());
      rtl.fireEvent.press(view.getByTestId('new-chat-button'));
      await view.findByTestId('chat-input');
    },
    async send(prompt: string, answer: string) {
      boundary.llama.scriptCompletion({ text: answer });
      rtl.fireEvent.changeText(view.getByTestId('chat-input'), prompt);
      rtl.fireEvent.press(view.getByTestId('send-button'));
      await view.findByText(answer);
      await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull());
    },
    async actions() {
      rtl.fireEvent.press(rtl.within(view.getByTestId('assistant-message')).getByText('•••'));
      await view.findByTestId('action-menu');
    },
    async close() {
      view.unmount();
      await require('../../src/services/generationService').generationService.stopGeneration();
      await require('../../pro').deactivate();
      await require('../../pro/sync/stateSyncService').stateSyncService.stop();
      await require('../../pro/sync/syncService').syncService.stop();
    },
  };
}
