/**
 * UI integration — MTP speculative decoding: off by default, the Draft Tokens control, and the
 * separately published MTP head.
 *
 * Real Home picker, real ChatScreen (with its reload banner), real settings controls, real
 * llmService load path, real mtpHeads + performSidecarDownload + backgroundDownloadService, real
 * store persistence. Faked only at the device line: llama.rn (GGUF header + initLlama), the native
 * downloader (its rows and events), the in-memory disk and the RAM sensor. The params initLlama
 * receives are the outcome for the engine; the controls, the banner and the button are the outcome
 * for the user.
 *
 * Product rules pinned:
 *  - MTP stays off by default; the Draft Tokens control appears only once MTP is on (default 3).
 *  - Changing Draft Tokens is saved, marks the loaded model as needing a reload, and the reload
 *    passes the new draft length to the engine.
 *  - gemma-4-E4B-it-Q4_K_M has a published MTP head (94 MB): the button offers it while it is not on
 *    disk, downloads it with its checksum, and disappears once installed. A load with MTP on then
 *    passes the head as the draft model, even though the model's own header declares no MTP layers.
 */
import { setupChatScreen, type ChatHarnessOptions } from '../../harness/chatHarness';
import { MB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { View } = require('react-native');
    return require('react').createElement(View, props);
  },
}));

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/** A model whose own GGUF build carries MTP draft layers. */
const QWEN35_WITH_MTP = { 'general.architecture': 'qwen35', 'qwen35.nextn_predict_layers': 1 };

function pressByWalkingUp(node: unknown): void {
  type N = { props?: Record<string, unknown>; parent?: N | null } | null;
  let n = node as N;
  for (let d = 0; n && d < 12; d++) {
    const op = n.props?.onPress;
    if (typeof op === 'function') { (op as () => void)(); return; }
    n = n.parent ?? null;
  }
  throw new Error('no onPress found walking up from the node');
}

function setup(extra: Partial<ChatHarnessOptions>) {
  return setupChatScreen({ engine: 'llama', deferInitialLoad: true, modelFileSizeBytes: 500 * MB, ...extra });
}

/** The chat's settings sheet, Advanced expanded. */
function openAdvanced(h: Harness) {
  const { TextGenerationSection } = require('../../../src/components/GenerationSettingsModal/TextGenerationSection');
  const section = h.rtl.render(h.React.createElement(TextGenerationSection, {}));
  h.rtl.fireEvent.press(section.getByTestId('modal-text-advanced-toggle'));
  return section;
}

function draftShown(section: { queryByTestId: (id: string) => { props: { children?: unknown } } | null }): string | null {
  const node = section.queryByTestId('speculative-draft-stepper-value');
  return node ? String(node.props.children) : null;
}

async function sendAndSee(h: Harness, text: string, reply: string): Promise<void> {
  await h.send(text, { text: reply });
  await h.rtl.waitFor(() => {
    expect(h.view!.queryByText(new RegExp(reply.replace('.', '\\.')))).not.toBeNull();
  });
}

function lastLoad(h: Harness): Record<string, unknown> {
  const inits = h.boundary.llama!.calls.initLlama;
  expect(inits.length).toBeGreaterThan(0);
  return inits[inits.length - 1];
}

describe('MTP speculative decoding', () => {
  it('is off by default: no Draft Tokens control, and the engine is not asked to draft', async () => {
    const h = await setup({ llamaModelInfo: QWEN35_WITH_MTP });
    const section = openAdvanced(h);
    expect(section.getByTestId('speculative-off-button')).toBeTruthy();
    expect(draftShown(section)).toBeNull();
    // A model with no published head gets no download offer.
    await h.rtl.act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(section.queryByTestId('mtp-head-status')).toBeNull();
    section.unmount();

    h.render();
    await sendAndSee(h, 'hello', 'Hi.');
    const params = lastLoad(h);
    expect(params.speculative).toBeUndefined();
    expect(params.spec_draft_n_max).toBeUndefined();
    expect(params.model_draft).toBeUndefined();
  });

  it('turning MTP on shows Draft Tokens (3); changing it is saved and reloads with the new length', async () => {
    const h = await setup({ llamaModelInfo: QWEN35_WITH_MTP });
    let section = openAdvanced(h);
    expect(draftShown(section)).toBeNull();
    h.rtl.fireEvent.press(section.getByTestId('speculative-on-button'));
    await h.rtl.waitFor(() => expect(draftShown(section)).toBe('3'));
    section.unmount();

    h.render();
    await sendAndSee(h, 'hello', 'Hi.');
    expect(lastLoad(h).speculative).toEqual({ enabled: true, type: 'mtp' });
    expect(lastLoad(h).spec_draft_n_max).toBe(3);
    // BEFORE the change: nothing to reload.
    expect(h.view!.queryByTestId('reload-model-banner')).toBeNull();

    section = openAdvanced(h);
    h.rtl.fireEvent(section.getByTestId('speculative-draft-stepper-slider'), 'slidingComplete', 5);
    await h.rtl.waitFor(() => expect(draftShown(section)).toBe('5'));
    section.unmount();

    // Saved on the device: a fresh settings sheet shows it, and it is in persisted storage.
    section = openAdvanced(h);
    expect(draftShown(section)).toBe('5');
    section.unmount();
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await h.rtl.waitFor(async () => {
      const stored = JSON.parse((await AsyncStorage.getItem('local-llm-app-storage')) ?? '{}');
      expect(stored.state?.settings?.speculativeDraftMax).toBe(5);
    });

    // The loaded model was built with 3: the chat says it needs a reload; the reload uses 5.
    await h.rtl.waitFor(() => expect(h.view!.queryByTestId('reload-model-banner')).not.toBeNull());
    const loadsBefore = h.boundary.llama!.calls.initLlama.length;
    await h.rtl.act(async () => { pressByWalkingUp(h.view!.getByTestId('reload-model-banner')); });
    await h.rtl.waitFor(() => expect(h.view!.queryByTestId('reload-model-banner')).toBeNull(), { timeout: 8000 });
    await h.rtl.waitFor(() => expect(h.boundary.llama!.calls.initLlama.length).toBeGreaterThan(loadsBefore), { timeout: 8000 });
    expect(lastLoad(h).spec_draft_n_max).toBe(5);
  });
});

describe('MTP head download', () => {
  const MODEL_FILE = 'gemma-4-E4B-it-Q4_K_M.gguf';
  const HEAD_FILE = 'mtp-gemma-4-E4B-it-Q8_0.gguf';
  const HEAD_BYTES = 98653248;

  it('turning MTP on downloads the head by itself, with its checksum, and the next load drafts with it', async () => {
    const h = await setup({
      modelFileName: MODEL_FILE,
      download: true,
      // The model's own header declares NO MTP layers: the head is what makes drafting possible.
      llamaModelInfo: { 'general.architecture': 'gemma3n' },
    });
    const docs = h.boundary.fs!.DocumentDirectoryPath;
    const headPath = `${docs}/models/${HEAD_FILE}`;
    const section = openAdvanced(h);

    // BEFORE: MTP is off, nothing is downloading and there is nothing to press.
    expect(await h.boundary.fs!.exists(headPath)).toBe(false);
    expect(h.boundary.download!.active()).toHaveLength(0);
    expect(section.queryByTestId('mtp-head-status')).toBeNull();

    // The one tap: MTP on.
    h.rtl.fireEvent.press(section.getByTestId('speculative-on-button'));
    const row = await h.rtl.waitFor(() => {
      const active = h.boundary.download!.active();
      expect(active).toHaveLength(1);
      return active[0] as typeof active[0] & { url?: string; sha256?: string };
    });
    // The native downloader is asked for the published head, with its checksum to verify.
    expect(row.fileName).toBe(HEAD_FILE);
    expect(row.totalBytes).toBe(HEAD_BYTES);
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.url).toMatch(/^https:\/\/huggingface\.co\/.+\/mtp-gemma-4-E4B-it-Q8_0\.gguf$/);

    // Progress shows under the switch.
    await h.rtl.act(async () => {
      h.boundary.download!.events.emit('DownloadProgress', {
        downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
        bytesDownloaded: HEAD_BYTES / 2, totalBytes: HEAD_BYTES, status: 'running',
      });
    });
    await h.rtl.waitFor(() => expect(section.queryByText('Getting MTP head… 50%')).not.toBeNull());

    // The native side finishes: the bytes are on disk, and the status goes away.
    await h.rtl.act(async () => {
      h.boundary.fs!.seedFile(headPath, HEAD_BYTES);
      h.boundary.download!.events.emit('DownloadComplete', {
        downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
        bytesDownloaded: HEAD_BYTES, totalBytes: HEAD_BYTES, status: 'completed',
        localUri: `file://${headPath}`,
      });
    });
    await h.rtl.waitFor(() => expect(section.queryByTestId('mtp-head-status')).toBeNull());
    expect(await h.boundary.fs!.exists(headPath)).toBe(true);

    // The next load passes the head to the engine as the draft model.
    section.unmount();
    h.render();
    await sendAndSee(h, 'hello', 'Hi.');
    const params = lastLoad(h);
    expect(params.speculative).toEqual({ enabled: true, type: 'mtp' });
    expect(params.model_draft).toBe(headPath);
  });

  it('turning MTP on with the head already installed downloads nothing', async () => {
    const h = await setup({ modelFileName: MODEL_FILE, download: true });
    h.boundary.fs!.seedFile(`${h.boundary.fs!.DocumentDirectoryPath}/models/${HEAD_FILE}`, HEAD_BYTES);
    const section = openAdvanced(h);
    h.rtl.fireEvent.press(section.getByTestId('speculative-on-button'));
    await h.rtl.act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(h.boundary.download!.active()).toHaveLength(0);
    expect(section.queryByTestId('mtp-head-status')).toBeNull();
    section.unmount();
  });
});
