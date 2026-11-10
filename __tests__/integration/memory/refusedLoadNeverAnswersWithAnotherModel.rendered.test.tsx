/**
 * UI integration — a text model the memory gate refuses shows its error on every turn, and no other
 * model answers in its place.
 *
 * Device, 2026-11-02 (iPhone 17 Pro Max, #755): Gemma 4 E4B was picked; the first message showed
 * "Insufficient Memory"; after Cancel the next message was answered by SmolLM2 - the image-intent
 * classifier - under Gemma's name. The classifier borrowed the chat engine through the text loader,
 * which records what it loads as the selection, and with no chat model loaded nothing put the selection
 * back. Then the chat-turn load path swallowed the refusal, so the turn waited with nothing on screen.
 *
 * Real ChatScreen, real routing and classifier, real activeModelService + residency gate, real llmService
 * memory check, real stores. Faked only at the device line: llama.rn, the disk, the RAM sensor. iPhone,
 * 12 GB with 0.3 GB free: the 3 GB chat model passes the residency budget, and the engine's own check
 * refuses it (its KV cache does not fit what is free), as Gemma's did on the phone; that refusal
 * clears the selection. The 0.1 GB classifier fits.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');

type Node = { props: Record<string, unknown>; parent: Node | null };

it('a refused chat model is never replaced by the classifier: the error shows again and nothing answers', async () => {
  const h = await setupChatScreen({
    navigation: 'real',
    engine: 'llama',
    platform: 'ios',
    ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 0.3 * GB },
    deferInitialLoad: true,
    modelName: 'Big Chat',
    modelFileSizeBytes: 3 * GB,
    extraModels: [{ id: 'smol', name: 'SmolLM2 Classifier', fileName: 'smol.gguf', fileSizeBytes: 0.1 * GB, engine: 'llama' }],
  });
  const { rtl } = h;
  // BOUNDARY: each model file on disk is its real size.
  h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', 3 * GB);
  h.boundary.fs!.seedFile('/docs/models/smol.gguf', 0.1 * GB);
  h.render();
  const view = () => h.view!;
  const llama = h.boundary.llama!;
  const initsFor = (file: string) => llama.calls.initLlama.filter(p => String(p.model).endsWith(file)).length;
  const cancelAlert = async () => {
    await rtl.act(async () => {
      let n: Node | null = view().getByText('Cancel') as unknown as Node;
      while (n && typeof n.props.onPress !== 'function') n = n.parent;
      (n!.props.onPress as () => void)();
    });
    await rtl.waitFor(() => expect(view().queryByText('Insufficient Memory')).toBeNull());
  };

  // An image model is chosen and image mode is back on Auto, so a message with no chat model loaded
  // runs the image-intent classifier, as on the phone.
  await rtl.waitFor(() => expect(view().queryByText(/Big Chat answers/)).not.toBeNull());
  await h.placeImageModel();
  await h.cycleImageMode();
  await h.cycleImageMode();
  await h.cycleImageMode();
  const { useAppStore } = require('../../../src/stores');
  expect(useAppStore.getState().settings.imageGenerationMode).toBe('auto');
  expect(useAppStore.getState().activeImageModelId).toBe('sd');
  // The classifier the app provisions for image-only turns (its own settings write).
  useAppStore.getState().updateSettings({ classifierModelId: 'smol'});

  // GESTURE: the first message - the chat model does not fit.
  await h.tapSend('Name three planets.');
  await rtl.waitFor(() => expect(view().queryByText('Insufficient Memory')).not.toBeNull(), { timeout: 10000 });
  expect(initsFor('ggml-small.gguf')).toBe(0);
  await cancelAlert();

  // GESTURE: the next message. The refusal shows again; the classifier is not the chat model.
  llama.scriptCompletion({ text: 'Classifier text that must never reach the chat.' });
  await h.tapSend('Say hello.');
  await rtl.waitFor(() => expect(view().queryByText('Insufficient Memory')).not.toBeNull(), { timeout: 10000 });
  expect(view().queryByText('Classifier text that must never reach the chat.')).toBeNull();
  expect(useAppStore.getState().activeModelId).not.toBe('smol');
  expect(useAppStore.getState().lastTextModelId).not.toBe('smol');
  expect(initsFor('ggml-small.gguf')).toBe(0);
  await cancelAlert();
  expect(view().queryByText('Classifier text that must never reach the chat.')).toBeNull();
}, 60000);
