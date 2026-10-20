/**
 * UI integration — "Use fastest settings" on the Model Settings screen.
 *
 * Real Home picker (to make a model active), real ModelSettingsScreen, real FastestSettingsButton,
 * real fastestSettings service (device read, residency lock, per-backend load + bench, the shared
 * @offgrid/models table) and the real store. Faked only at the device line: llama.rn (initLlama and
 * context.bench report a speed per backend, read off the load params the way the native side runs
 * them), the disk, the RAM sensor and the SoC identity (Snapdragon 8 Gen 3: Adreno GPU + Hexagon NPU).
 *
 * Product rules pinned (the user's view, on the Inference Backend control):
 *  - On a phone with an NPU, the button measures CPU, NPU and GPU and selects the fastest (here NPU).
 *  - A backend that fails, or that silently runs on the CPU, does not win: the phone stays on the CPU.
 *  - Cancel stops the run and changes nothing.
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

const CPU_DESC = 'Always available. Stable, predictable performance.';

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/** A Snapdragon 8 Gen 3 phone (12 GB) with a model picked on Home. */
function npuPhone() {
  return setupChatScreen({
    engine: 'llama',
    deferInitialLoad: true,
    deviceHardware: 'qcom',
    socModel: 'SM8650',
    modelFileSizeBytes: 500 * MB,
  });
}

/** Open Model Settings → Text Generation → Advanced. */
function openModelSettingsAdvanced(h: Harness) {
  const { ModelSettingsScreen } = require('../../../src/screens/ModelSettingsScreen');
  const screen = h.rtl.render(h.React.createElement(ModelSettingsScreen, {}));
  h.rtl.fireEvent.press(screen.getByTestId('text-generation-accordion'));
  h.rtl.fireEvent.press(screen.getByTestId('text-advanced-toggle'));
  return screen;
}

describe('Use fastest settings', () => {
  it('measures each backend and selects the NPU when it is fastest', async () => {
    const h = await npuPhone();
    h.boundary.llama!.scriptBench({ cpu: 9, htp: 24, opencl: 14 });
    const screen = openModelSettingsAdvanced(h);

    // BEFORE: the CPU is selected (its description shows, no NPU layer control).
    await h.rtl.waitFor(() => expect(screen.getByTestId('backend-htp-button')).toBeTruthy());
    expect(screen.queryByText(CPU_DESC)).not.toBeNull();
    expect(screen.queryByText('NPU Layers')).toBeNull();

    h.rtl.fireEvent.press(screen.getByTestId('fastest-settings-button'));
    await h.rtl.waitFor(() => expect(screen.queryByTestId('fastest-settings-cancel')).not.toBeNull());
    await h.rtl.waitFor(() => expect(screen.queryByTestId('fastest-settings-button')).not.toBeNull(), { timeout: 8000 });

    // AFTER: the NPU is selected and the batch follows it.
    expect(screen.queryByText('NPU Layers')).not.toBeNull();
    expect(screen.queryByText(CPU_DESC)).toBeNull();
    expect(String(screen.getByTestId('batch-size-stepper-value').props.children)).toBe('Auto (128)');
    // Every backend this device class may run was really measured, each on its own load.
    expect(h.boundary.llama!.calls.bench.map(b => b.backend)).toEqual(['cpu', 'htp', 'opencl']);
    // The measured answer is remembered on this device.
    expect(h.useAppStore.getState().speedBenchmarkBackend).toBe('htp');
  });

  it('stays on the CPU when the NPU fails and the GPU silently ran on the CPU', async () => {
    const h = await npuPhone();
    // The GPU "reports" a high speed, but on 0 offloaded layers: it never ran where we asked.
    h.boundary.llama!.scriptBench({ cpu: 9, htp: 'fail', opencl: { cpuFallback: 30 } });
    const screen = openModelSettingsAdvanced(h);

    // BEFORE: the user had picked the GPU.
    h.rtl.fireEvent.press(screen.getByTestId('backend-opencl-button'));
    await h.rtl.waitFor(() => expect(screen.queryByText('GPU Layers (OpenCL)')).not.toBeNull());
    expect(screen.queryByText(CPU_DESC)).toBeNull();

    h.rtl.fireEvent.press(screen.getByTestId('fastest-settings-button'));
    await h.rtl.waitFor(() => expect(screen.queryByTestId('fastest-settings-cancel')).not.toBeNull());
    await h.rtl.waitFor(() => expect(screen.queryByTestId('fastest-settings-button')).not.toBeNull(), { timeout: 8000 });

    // AFTER: the CPU, the only backend that really ran — all three were tried.
    expect(h.boundary.llama!.calls.bench.map(b => b.backend)).toEqual(['cpu', 'htp', 'opencl']);
    expect(screen.queryByText(CPU_DESC)).not.toBeNull();
    expect(screen.queryByText('GPU Layers (OpenCL)')).toBeNull();
    expect(screen.queryByText('NPU Layers')).toBeNull();
  });

  it('a phone under 6 GB goes to the CPU without measuring anything', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      deferInitialLoad: true,
      deviceHardware: 'qcom',
      socModel: 'SM8650',
      ram: { platform: 'android', totalBytes: 4 * GB, availBytes: 2.5 * GB },
      modelFileSizeBytes: 400 * MB,
    });
    const screen = openModelSettingsAdvanced(h);
    h.rtl.fireEvent.press(screen.getByTestId('backend-opencl-button'));
    await h.rtl.waitFor(() => expect(screen.queryByText('GPU Layers (OpenCL)')).not.toBeNull());

    await h.rtl.act(async () => {
      h.rtl.fireEvent.press(screen.getByTestId('fastest-settings-button'));
    });
    await h.rtl.waitFor(() => expect(screen.queryByText(CPU_DESC)).not.toBeNull());
    expect(screen.queryByText('GPU Layers (OpenCL)')).toBeNull();
    expect(h.boundary.llama!.calls.bench).toHaveLength(0);
    expect(h.boundary.llama!.calls.initLlama).toHaveLength(0);
  });

  it('Cancel stops the run and leaves your settings as they were', async () => {
    const h = await npuPhone();
    // The CPU measurement hangs, so the run is genuinely in progress when Cancel is pressed.
    h.boundary.llama!.scriptBench({ cpu: 'hang', htp: 50, opencl: 40 });
    const screen = openModelSettingsAdvanced(h);

    h.rtl.fireEvent.press(screen.getByTestId('backend-opencl-button'));
    await h.rtl.waitFor(() => expect(screen.queryByText('GPU Layers (OpenCL)')).not.toBeNull());

    h.rtl.fireEvent.press(screen.getByTestId('fastest-settings-button'));
    const cancel = await h.rtl.waitFor(() => screen.getByTestId('fastest-settings-cancel'));
    await h.rtl.waitFor(() => expect(h.boundary.llama!.calls.bench).toHaveLength(1));
    h.rtl.fireEvent.press(cancel);
    // The in-flight measurement returns (native finishes its step).
    await h.rtl.act(async () => { h.boundary.llama!.releaseBench(); });

    await h.rtl.waitFor(() => expect(screen.queryByTestId('fastest-settings-button')).not.toBeNull(), { timeout: 8000 });
    // Nothing else was measured and nothing changed: still the GPU the user picked.
    expect(h.boundary.llama!.calls.bench).toHaveLength(1);
    expect(screen.queryByText('GPU Layers (OpenCL)')).not.toBeNull();
    expect(screen.queryByText('NPU Layers')).toBeNull();
    expect(h.useAppStore.getState().speedBenchmarkBackend).toBeNull();
  });
});
