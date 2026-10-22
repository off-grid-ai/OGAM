/**
 * UI integration — what the engine is asked for when you load a model on this phone.
 *
 * Real Home picker, real ChatScreen, real settings controls, real llmService/activeModelService load
 * path and the shared @offgrid/models rules. Faked only at the device line: llama.rn (its GGUF header
 * read and initLlama), the in-memory disk, the RAM sensor and the SoC identity. The params initLlama
 * receives are the outcome here: they ARE what the device runs with.
 *
 * Product rules pinned:
 *  - mmap is off on Android for a quant llama.cpp repacks for ARM (read from the GGUF header's
 *    general.file_type, not the file name), but a phone under 6 GB keeps mmap (unmapped weights are
 *    dirty memory the low-memory killer counts). Non-repacked quants and iOS keep mmap.
 *  - Batch is automatic by default: 128 on the NPU (HTP), 512 on the CPU and on Metal. The batch
 *    slider says so ("Auto (128)").
 *  - iOS threads four cores (measured fastest on an A19 Pro).
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB, MB } from '../../harness/nativeBoundary';

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

/** GGUF general.file_type values (llama.cpp's llama_ftype). */
const FILE_TYPE = { F16: 1, Q4_0: 2 } as const;

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/** Send the first message: the app loads the model lazily on it. Returns the params the engine got. */
async function firstSendLoads(h: Harness): Promise<Record<string, unknown>> {
  h.render();
  // BEFORE: nothing has been loaded yet.
  expect(h.boundary.llama!.calls.initLlama).toHaveLength(0);
  await h.send('hello', { text: 'Hi there.' });
  await h.rtl.waitFor(() => {
    expect(h.view!.queryByText(/Hi there\./)).not.toBeNull();
  });
  const inits = h.boundary.llama!.calls.initLlama;
  expect(inits.length).toBeGreaterThan(0);
  return inits[inits.length - 1];
}

/** Open the chat's settings sheet, expand Advanced, and return the mounted section. */
function openAdvanced(h: Harness) {
  const { TextGenerationSection } = require('../../../src/components/GenerationSettingsModal/TextGenerationSection');
  const section = h.rtl.render(h.React.createElement(TextGenerationSection, {}));
  h.rtl.fireEvent.press(section.getByTestId('modal-text-advanced-toggle'));
  return section;
}

/** The text the Batch Size control shows. */
function batchShown(section: { getByTestId: (id: string) => { props: { children?: unknown } } }): string {
  return String(section.getByTestId('batch-size-stepper-value').props.children);
}

describe('load params follow the model header and the device', () => {
  it('Android 12 GB, CPU, a Q4_0 model: mmap off, auto batch 512', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      deferInitialLoad: true,
      modelFileName: 'qwen3-1.7b-q4.gguf', // the name does not say Q4_0: the header does
      modelFileSizeBytes: 500 * MB,
      llamaModelInfo: { 'general.architecture': 'qwen3', 'general.file_type': FILE_TYPE.Q4_0 },
    });
    const section = openAdvanced(h);
    expect(batchShown(section)).toBe('Auto (512)');
    section.unmount();

    const params = await firstSendLoads(h);
    expect(params.use_mmap).toBe(false);
    expect(params.n_batch).toBe(512);
    expect(params.n_ubatch).toBe(512);
  });

  it('Android 4 GB, a Q4_0 model: mmap stays on (low-RAM phone)', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      deferInitialLoad: true,
      ram: { platform: 'android', totalBytes: 4 * GB, availBytes: 2.5 * GB },
      modelFileName: 'qwen3-0.6b-q4.gguf',
      modelFileSizeBytes: 400 * MB,
      llamaModelInfo: { 'general.architecture': 'qwen3', 'general.file_type': FILE_TYPE.Q4_0 },
    });
    const params = await firstSendLoads(h);
    expect(params.use_mmap).toBe(true);
  });

  it('Android 8 GB, a Q4_0 model: mmap off', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      deferInitialLoad: true,
      ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 5 * GB },
      modelFileName: 'qwen3-0.6b-q4.gguf',
      modelFileSizeBytes: 400 * MB,
      llamaModelInfo: { 'general.architecture': 'qwen3', 'general.file_type': FILE_TYPE.Q4_0 },
    });
    const params = await firstSendLoads(h);
    expect(params.use_mmap).toBe(false);
  });

  it('Android, an F16 model (not repacked): mmap stays on', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      deferInitialLoad: true,
      modelFileName: 'tiny-Q4_0-named-but-f16.gguf', // a misleading name must not switch mmap off
      modelFileSizeBytes: 500 * MB,
      llamaModelInfo: { 'general.architecture': 'qwen3', 'general.file_type': FILE_TYPE.F16 },
    });
    const params = await firstSendLoads(h);
    expect(params.use_mmap).toBe(true);
  });

  it('Android with an NPU: choosing the NPU shows "Auto (128)" and loads on HTP0 with batch 128', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      deferInitialLoad: true,
      deviceHardware: 'qcom',
      socModel: 'SM8650', // Snapdragon 8 Gen 3: Hexagon NPU
      modelFileName: 'qwen3-1.7b-q4.gguf',
      modelFileSizeBytes: 500 * MB,
      llamaModelInfo: { 'general.architecture': 'qwen3', 'general.file_type': FILE_TYPE.Q4_0 },
    });
    const section = openAdvanced(h);
    // BEFORE: CPU, auto batch 512.
    expect(batchShown(section)).toBe('Auto (512)');
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => section.getByTestId('backend-htp-button')));
    await h.rtl.waitFor(() => {
      expect(batchShown(section)).toBe('Auto (128)');
    });
    section.unmount();

    const params = await firstSendLoads(h);
    // CPU is named as the fallback so a missing HTP0 never resolves to llama.rn's OpenCL default.
    expect(params.devices).toEqual(['HTP0', 'CPU']);
    expect(params.n_batch).toBe(128);
    expect(params.n_ubatch).toBe(128);
  });

  it('a batch you chose yourself is used as-is, and the slider stops saying Auto', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      deferInitialLoad: true,
      modelFileSizeBytes: 500 * MB,
    });
    const section = openAdvanced(h);
    expect(batchShown(section)).toBe('Auto (512)');
    h.rtl.fireEvent(section.getByTestId('batch-size-stepper-slider'), 'slidingComplete', 256);
    await h.rtl.waitFor(() => {
      expect(batchShown(section)).toBe('256');
    });
    section.unmount();

    const params = await firstSendLoads(h);
    expect(params.n_batch).toBe(256);
  });

  it('iOS, a Q4_0 model: mmap stays on, auto batch 512, four threads', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      platform: 'ios',
      deferInitialLoad: true,
      modelFileName: 'qwen3-1.7b-q4.gguf',
      modelFileSizeBytes: 500 * MB,
      llamaModelInfo: { 'general.architecture': 'qwen3', 'general.file_type': FILE_TYPE.Q4_0 },
    });
    const params = await firstSendLoads(h);
    expect(params.use_mmap).toBe(true);
    expect(params.n_batch).toBe(512);
    expect(params.n_threads).toBe(4);
  });
});
