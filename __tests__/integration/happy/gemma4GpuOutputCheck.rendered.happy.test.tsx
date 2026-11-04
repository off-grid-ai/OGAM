/**
 * Gemma 4 on the phone's OpenCL GPU answered "hi" with `<unused19><unused10><unk>...` from a file that works on the CPU.
 * The loader now looks at one short reply right after an accelerated Gemma 4 load: noise is a failed load that says what
 * happened (never a filtered reply), a healthy reply loads as before, and a bad combination is remembered so it is not
 * loaded and tested again. Fakes only the device boundary (llama init/completion, DeviceInfo, files).
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const GARBAGE = '<unused19><unused10><unused16><unused8><unused26><unused30><unused28><unused0><unused28><unk><unused21><unused19>';

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

async function reloadOnOpenCL(h: Awaited<ReturnType<typeof setupChatScreen>>, expectFailure = false) {
  const DeviceInfo = require('react-native-device-info');
  const { hardwareService } = require('../../../src/services/hardware');
  (DeviceInfo.getHardware as jest.Mock).mockResolvedValue('qcom');
  jest.spyOn(hardwareService, 'getOpenCLCapability').mockResolvedValue({ supported: true });
  const { BackendSelector } = require('../../../src/components/settings/textGenAdvancedSections');
  const s = h.rtl.render(h.React.createElement(BackendSelector, {}));
  h.rtl.fireEvent.press(s.getByTestId('backend-opencl-button'));
  s.unmount();
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('reload-model-banner')).not.toBeNull(); });
  await h.rtl.act(async () => { pressByWalkingUp(h.view!.getByTestId('reload-model-banner')); });
  if (!expectFailure) await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('reload-model-banner')).toBeNull(); }, { timeout: 20000 });
}

describe('Gemma 4 on the GPU: noise is caught at load, not in the first reply', () => {
  it('fails the OpenCL load with a plain reason when the first reply is placeholder tokens', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', modelFileName: 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf' });
    h.render();
    h.boundary.llama!.scriptCompletion({ text: GARBAGE });
    await reloadOnOpenCL(h, true);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryAllByText(/The OpenCL GPU gave unusable output for this model \(the reply is made of placeholder tokens/).length).toBeGreaterThan(0);
    }, { timeout: 20000 });
    const { llmService } = require('../../../src/services/llm');
    expect(llmService.isModelLoaded()).toBe(false);
  }, 40000);

  it('remembers the bad combination: the next OpenCL load is refused before the model is loaded again', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', modelFileName: 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf' });
    h.render();
    h.boundary.llama!.scriptCompletion({ text: GARBAGE });
    await reloadOnOpenCL(h, true);
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByText(/unusable output/).length).toBeGreaterThan(0); }, { timeout: 20000 });
    const { initLlama } = require('llama.rn');
    const loadsBefore = (initLlama as jest.Mock).mock.calls.length;
    const { llmService } = require('../../../src/services/llm');
    await expect(llmService.loadModel(h.useAppStore.getState().downloadedModels[0].filePath)).rejects.toThrow(/found by an earlier test on this phone/);
    expect((initLlama as jest.Mock).mock.calls.length).toBe(loadsBefore);
  }, 40000);

  it('on the CPU too: noise fails the load and points at the file and the CPU kernels, not at a GPU', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', modelFileName: 'Gemma4-12B-QAT-Uncensored-HauhauCSQ4_K_M.gguf' });
    h.render();
    h.useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' } as any);
    const { initLlama } = require('llama.rn');
    const real = (initLlama as jest.Mock).getMockImplementation()!;
    (initLlama as jest.Mock).mockImplementation(async (params: Record<string, unknown>, cb?: (p: number) => void) => {
      const context = await real(params, cb);
      h.boundary.llama!.scriptCompletion({ text: '<pad><pad><pad><pad><pad><pad><pad><pad><pad><pad><pad><pad>' });
      return context;
    });
    const { llmService } = require('../../../src/services/llm');
    await expect(llmService.loadModel(h.useAppStore.getState().downloadedModels[0].filePath))
      .rejects.toThrow(/wrote only noise on the CPU.*checks the file against its published checksum/);
    expect(llmService.isModelLoaded()).toBe(false);
  }, 40000);

  it('keeps a GPU whose very short prompts start with a wrong first word, using the workaround for short prompts only', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', modelFileName: 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf' });
    h.render();
    // The fake GPU as the phone reports showed it: a very short prompt processed for the first time gets a wrong first word;
    // a realistic one (system prompt) is fine, and so is any prompt the engine already holds (it then recomputes only the
    // last token, on its own).
    const seen = new Set<string>();
    const calls: Array<{ nPredict: number; cached: boolean }> = [];
    const { initLlama } = require('llama.rn');
    const real = (initLlama as jest.Mock).getMockImplementation()!;
    (initLlama as jest.Mock).mockImplementation(async (params: Record<string, unknown>, cb?: (p: number) => void) => {
      const context: any = await real(params, cb);
      if (!context.__fakeGpu) {
        const original = context.completion;
        context.completion = async (p: any, tokenCb: any) => {
          const key = JSON.stringify(p.messages);
          const cached = seen.has(key);
          seen.add(key);
          calls.push({ nPredict: p.n_predict, cached });
          const shortPrompt = key.length < 400;
          h.boundary.llama!.scriptCompletion({ text: !cached && shortPrompt ? '<pad>! How can I help you today?' : '12' });
          return original.call(context, p, tokenCb);
        };
        context.__fakeGpu = true;
      }
      return context;
    });
    await reloadOnOpenCL(h);
    const { llmService } = require('../../../src/services/llm');
    expect(llmService.isModelLoaded()).toBe(true);
    expect(llmService.getGpuInfo().gpu).toBe(true);
    expect(llmService.usesFirstWordWorkaround()).toBe(true);
    expect(llmService.getShortPromptStatus()).toBe('workaround');

    calls.length = 0;
    const reply = await llmService.generateResponse([{ id: 'u1', role: 'user', content: 'Tell me something.', timestamp: Date.now() }]);
    // The prompt ran once for one throwaway word, then the real reply started from it.
    expect(calls).toEqual([{ nPredict: 1, cached: false }, expect.objectContaining({ cached: true })]);
    expect(reply).toBe('12');

    // A realistic prompt is not affected, so it is not run twice.
    calls.length = 0;
    await llmService.generateResponse([{ id: 'u2', role: 'user', content: 'Please summarise this. '.repeat(120), timestamp: Date.now() }]);
    expect(calls).toHaveLength(1);
  }, 60000);

  it('never blocks a model on a wrong-but-fluent answer: that is a warning, the model loads and the short-prompt status says so', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', modelFileName: 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf' });
    h.render();
    h.boundary.llama!.scriptCompletion({ text: 'Sure! Happy to help with that.' });
    await reloadOnOpenCL(h);
    const { llmService } = require('../../../src/services/llm');
    expect(llmService.isModelLoaded()).toBe(true);
    expect(llmService.getLastOutputCheck()).toMatchObject({ ok: true, warning: expect.stringMatching(/did not answer "7 plus 5"/) });
    expect(llmService.getShortPromptStatus()).toBe('unreliable');
  }, 40000);

  it('never blocks a model because the check itself could not run', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', modelFileName: 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf' });
    h.render();
    h.boundary.llama!.scriptCompletion({ throwMessage: 'completion failed inside the engine' });
    await reloadOnOpenCL(h);
    const { llmService } = require('../../../src/services/llm');
    expect(llmService.isModelLoaded()).toBe(true);
    expect(llmService.getLastOutputCheck()).toMatchObject({ ok: true, warning: expect.stringMatching(/check could not run/) });
  }, 40000);

  it('falsify: a normal reply passes the check and the model loads on the GPU as before', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', modelFileName: 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf' });
    h.render();
    h.boundary.llama!.scriptCompletion({ text: '12' });
    await reloadOnOpenCL(h);
    const { llmService } = require('../../../src/services/llm');
    expect(llmService.isModelLoaded()).toBe(true);
    expect(llmService.getGpuInfo().gpu).toBe(true);
  }, 40000);
});
