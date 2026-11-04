/**
 * Settings > About > "Test GPU on this model": loads the model on the CPU and on the GPU at 24, 16 and 8 layers, checks
 * that each writes real words, and reports which settings work. The fake GPU computes noise at 24 layers and is fine
 * below that (the shape of a driver bug the app cannot see without trying). Fakes only the device boundary.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const GARBAGE = '<unused19><unused10><unused16><unused8><unused26><unused30><unused28><unused0><unused28><unk><unused21><unused19>';
const GOOD = 'Hello! How can I help you today?';

it('reports which GPU layer counts give real words and which give noise, and puts the person\'s settings back', async () => {
  const h = await setupChatScreen({ engine: 'llama', platform: 'android', modelFileName: 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf' });
  const DeviceInfo = require('react-native-device-info');
  const { hardwareService } = require('../../../src/services/hardware');
  (DeviceInfo.getHardware as jest.Mock).mockResolvedValue('qcom');
  jest.spyOn(hardwareService, 'getOpenCLCapability').mockResolvedValue({ supported: true });

  // The fake GPU: noise at 24 layers, words at fewer, words on the CPU.
  const { initLlama } = require('llama.rn');
  const real = (initLlama as jest.Mock).getMockImplementation()!;
  (initLlama as jest.Mock).mockImplementation(async (params: Record<string, unknown>, cb?: (p: number) => void) => {
    const context = await real(params, cb);
    h.boundary.llama!.scriptCompletion({ text: Number(params.n_gpu_layers) >= 24 ? GARBAGE : GOOD });
    return context;
  });

  const before = { ...h.useAppStore.getState().settings };
  const { ModelGpuTest } = require('../../../src/components/ModelGpuTest');
  const view = h.rtl.render(h.React.createElement(ModelGpuTest));
  h.rtl.fireEvent.press(view.getByTestId('model-gpu-test-run'));

  const report = await h.rtl.waitFor(() => view.getByTestId('model-gpu-test-report'), { timeout: 110000 });
  const text = JSON.stringify(report.props.children);
  expect(text).toMatch(/CPU only, the app's usual settings: OK/);
  expect(text).toMatch(/CPU only, optimized ARM kernels off: OK/);
  expect(text).toMatch(/Model file: not in the list of known files/);
  expect(text).toMatch(/OpenCL GPU, 24 layers: FAILED/);
  expect(text).toMatch(/placeholder tokens/);
  expect(text).toMatch(/OpenCL GPU, 16 layers: OK/);
  expect(text).toMatch(/OpenCL GPU, 8 layers: OK/);
  expect(text).toMatch(/Working GPU settings: .*16 layers/);

  // The CPU step with the optimized kernels off really reached the engine as no_extra_bufts.
  const loads = (initLlama as jest.Mock).mock.calls.map((c) => c[0] as Record<string, unknown>);
  expect(loads.some((p) => p.no_extra_bufts === true && Number(p.n_gpu_layers) === 0)).toBe(true);
  expect(loads.some((p) => p.no_extra_bufts === false)).toBe(true);

  // Their own settings come back, and the model is not left loaded by the test.
  const after = h.useAppStore.getState().settings;
  expect(after.inferenceBackend).toBe(before.inferenceBackend);
  expect(after.gpuLayers).toBe(before.gpuLayers);
  expect(after.contextLength).toBe(before.contextLength);
  expect(after.cacheType).toBe(before.cacheType);
  const { llmService } = require('../../../src/services/llm');
  expect(llmService.isModelLoaded()).toBe(false);
}, 120000);

it('can test a model that is not the current one and cannot be loaded for chat (its GPU load is refused), chosen on the screen', async () => {
  const h = await setupChatScreen({ engine: 'llama', platform: 'android', modelFileName: 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf' });
  const DeviceInfo = require('react-native-device-info');
  const { hardwareService } = require('../../../src/services/hardware');
  (DeviceInfo.getHardware as jest.Mock).mockResolvedValue('qcom');
  jest.spyOn(hardwareService, 'getOpenCLCapability').mockResolvedValue({ supported: true });
  const gemma = h.useAppStore.getState().downloadedModels[0];
  // A second model is the current one; Gemma is merely downloaded.
  h.useAppStore.setState({ downloadedModels: [{ ...gemma, id: 'qwen', name: 'Qwen', fileName: 'Qwen3.5-4B-Q4_0.gguf' }, gemma], activeModelId: 'qwen' });
  const { initLlama } = require('llama.rn');
  const real = (initLlama as jest.Mock).getMockImplementation()!;
  (initLlama as jest.Mock).mockImplementation(async (params: Record<string, unknown>, cb?: (p: number) => void) => {
    const context = await real(params, cb);
    h.boundary.llama!.scriptCompletion({ text: GOOD });
    return context;
  });
  const { ModelGpuTest } = require('../../../src/components/ModelGpuTest');
  const view = h.rtl.render(h.React.createElement(ModelGpuTest));
  expect(view.queryAllByText(/Qwen3\.5-4B-Q4_0\.gguf/).length).toBeGreaterThan(0);
  h.rtl.fireEvent.press(view.getByTestId(`model-gpu-test-pick-${gemma.id}`));
  h.rtl.fireEvent.press(view.getByTestId('model-gpu-test-run'));
  const report = await h.rtl.waitFor(() => view.getByTestId('model-gpu-test-report'), { timeout: 110000 });
  expect(JSON.stringify(report.props.children)).toMatch(/Test for Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M\.gguf/);
}, 120000);
