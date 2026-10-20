/**
 * UI integration — switching chats keeps each chat's KV state, so coming back does not re-read it.
 *
 * Real Home + ChatScreen, real generation pipeline, real llmService conversation boundary and the real
 * kvSessionStore. Faked only at the device line: llama.rn (whose context records saveSession /
 * loadSession and writes the session file to the in-memory disk, as the native side does), the disk,
 * the RAM sensor and the GPU identity. The session calls the engine receives ARE the outcome: they are
 * the only thing that decides whether the device re-reads a chat's history.
 *
 * Product rules pinned:
 *  - Leaving chat A for chat B saves A's state; returning to A restores A's state (not B's).
 *  - A chat never visited before has nothing to restore.
 *  - On the GPU (OpenCL) llama.rn cannot save the state: no save, no restore.
 *  - A model loaded with MTP shares its KV cache with the draft: no save, no restore.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { MB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

async function sendAndSee(h: Harness, text: string, reply: string): Promise<void> {
  await h.send(text, { text: reply });
  await h.rtl.waitFor(() => {
    expect(h.view!.queryByText(new RegExp(reply.replace('.', '\\.')))).not.toBeNull();
  });
}

/** Chat A, then a new chat B, then back to A — all through the screen. Returns A's id. */
async function switchAtoBtoA(h: Harness): Promise<void> {
  h.render();
  await sendAndSee(h, 'first chat question', 'Answer one.');
  const chatA = h.conversationId!;
  expect(chatA).toBeTruthy();

  await h.newChatViaHome();
  await sendAndSee(h, 'second chat question', 'Answer two.');
  expect(h.conversationId).not.toBe(chatA);

  await h.openConversation(chatA);
  // Chat A's history is on screen again.
  expect(h.view!.queryByText(/Answer one\./)).not.toBeNull();
  await sendAndSee(h, 'back in the first chat', 'Answer three.');
}

describe('chat switch keeps each chat warm', () => {
  it('CPU: leaving A saves it, B starts empty, returning to A restores A', async () => {
    const h = await setupChatScreen({ engine: 'llama', modelFileSizeBytes: 500 * MB });
    const llama = h.boundary.llama!;
    // BEFORE: nothing saved, nothing restored.
    expect(llama.calls.saveSession).toHaveLength(0);
    expect(llama.calls.loadSession).toHaveLength(0);

    await switchAtoBtoA(h);

    // Two departures: A (for B), then B (for A).
    expect(llama.calls.saveSession).toHaveLength(2);
    const [savedA, savedB] = llama.calls.saveSession;
    expect(savedA).not.toBe(savedB);
    // The return to A restored exactly what was saved for A, and B (new) had nothing to restore.
    expect(llama.calls.loadSession).toEqual([savedA]);
    // The saved state is a file on the device's cache disk.
    expect(await h.boundary.fs!.exists(savedA)).toBe(true);
  });

  it('keeps at most three saved chats on the device', async () => {
    const h = await setupChatScreen({ engine: 'llama', modelFileSizeBytes: 500 * MB });
    h.render();
    await sendAndSee(h, 'chat 1', 'Reply 1.');
    for (let chat = 2; chat <= 5; chat++) {
      await h.newChatViaHome();
      await sendAndSee(h, `chat ${chat}`, `Reply ${chat}.`);
    }
    const saved = h.boundary.llama!.calls.saveSession;
    // Four departures, four saves...
    expect(new Set(saved).size).toBe(4);
    // ...but only three session files stay on disk (KV state runs to hundreds of MB).
    const cacheDir = saved[0].slice(0, saved[0].lastIndexOf('/'));
    const onDisk = (await h.boundary.fs!.module.readDir(cacheDir)).filter(e => e.name.startsWith('kv-'));
    expect(onDisk).toHaveLength(3);
  });

  it('MTP on: no session is saved or restored', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      modelFileSizeBytes: 500 * MB,
      deferInitialLoad: true,
      llamaModelInfo: { 'general.architecture': 'qwen35', 'qwen35.nextn_predict_layers': 1 },
    });
    const { TextGenerationSection } = require('../../../src/components/GenerationSettingsModal/TextGenerationSection');
    const section = h.rtl.render(h.React.createElement(TextGenerationSection, {}));
    h.rtl.fireEvent.press(section.getByTestId('modal-text-advanced-toggle'));
    h.rtl.fireEvent.press(section.getByTestId('speculative-on-button'));
    await h.rtl.waitFor(() => expect(section.queryByTestId('speculative-draft-stepper-value')).not.toBeNull());
    section.unmount();

    await switchAtoBtoA(h);

    const llama = h.boundary.llama!;
    const loads = llama.calls.initLlama;
    expect(loads[loads.length - 1].speculative).toEqual({ enabled: true, type: 'mtp' });
    expect(llama.calls.saveSession).toHaveLength(0);
    expect(llama.calls.loadSession).toHaveLength(0);
  });

  it('GPU (OpenCL): no session is saved or restored', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      deviceHardware: 'qcom', // Adreno: the OpenCL backend is offered
      modelFileSizeBytes: 500 * MB,
      deferInitialLoad: true,
    });
    // Choose the GPU the way the user does, before the first load.
    const { TextGenerationSection } = require('../../../src/components/GenerationSettingsModal/TextGenerationSection');
    const section = h.rtl.render(h.React.createElement(TextGenerationSection, {}));
    h.rtl.fireEvent.press(section.getByTestId('modal-text-advanced-toggle'));
    h.rtl.fireEvent.press(section.getByTestId('backend-opencl-button'));
    await h.rtl.waitFor(() => {
      expect(section.queryByText('GPU Layers (OpenCL)')).not.toBeNull();
    });
    section.unmount();

    await switchAtoBtoA(h);

    const llama = h.boundary.llama!;
    // The model really ran on the GPU...
    const loads = llama.calls.initLlama;
    expect(Number(loads[loads.length - 1].n_gpu_layers)).toBeGreaterThan(0);
    // ...the chats switched (the cache was cleared for each)...
    expect(llama.calls.clearCache.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    // ...and no state was saved or restored.
    expect(llama.calls.saveSession).toHaveLength(0);
    expect(llama.calls.loadSession).toHaveLength(0);
  });
});
