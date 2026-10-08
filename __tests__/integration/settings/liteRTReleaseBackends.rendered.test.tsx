import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

it('uses GPU at the native boundary when an older build saved NPU', async () => {
  const boundary = installNativeBoundary();
  const { liteRTService } = require('../../../src/services/litert');
  await liteRTService.loadModel('/models/gemma.litertlm', 'npu');
  expect(boundary.litert.calls.loadModel).toEqual([
    ['/models/gemma.litertlm', 'gpu', false, false, 4096],
  ]);
});

const TENSOR_G5_FILE = '/models/gemma-4-E2B-it_Google_Tensor_G5.litertlm';
const PIXEL_10_TPU = { supported: true, tensorGeneration: 5, reason: null };

it('loads a Tensor G5 build on the TPU of a phone with a Tensor G5 TPU, whatever the saved backend', async () => {
  const boundary = installNativeBoundary();
  boundary.litert.module.getTpuSupport.mockResolvedValue(PIXEL_10_TPU);
  const { liteRTService } = require('../../../src/services/litert');
  await liteRTService.loadModel(TENSOR_G5_FILE, 'gpu');
  expect(boundary.litert.calls.loadModel).toEqual([[TENSOR_G5_FILE, 'npu', false, false, 4096]]);
});

it('keeps a portable LiteRT file off the NPU even on a phone with a Tensor TPU', async () => {
  const boundary = installNativeBoundary();
  boundary.litert.module.getTpuSupport.mockResolvedValue(PIXEL_10_TPU);
  const { liteRTService } = require('../../../src/services/litert');
  await liteRTService.loadModel('/models/gemma-4-E2B-it.litertlm', 'npu');
  expect(boundary.litert.calls.loadModel).toEqual([['/models/gemma-4-E2B-it.litertlm', 'gpu', false, false, 4096]]);
});

it('does not send a Tensor G5 build to the NPU when the phone has no usable Tensor G5 TPU', async () => {
  const boundary = installNativeBoundary();
  boundary.litert.module.getTpuSupport.mockResolvedValue({ supported: false, tensorGeneration: 5, reason: 'dispatch_lib_missing' });
  const { liteRTService } = require('../../../src/services/litert');
  await liteRTService.loadModel(TENSOR_G5_FILE, 'cpu');
  expect(boundary.litert.calls.loadModel).toEqual([[TENSOR_G5_FILE, 'cpu', false, false, 4096]]);
});

it('adopts the media the native engine came up with when a TPU load drops to text-only', async () => {
  const boundary = installNativeBoundary();
  boundary.litert.module.getTpuSupport.mockResolvedValue(PIXEL_10_TPU);
  boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'npu', maxNumTokens: 4096, vision: false, audio: false });
  const { liteRTService } = require('../../../src/services/litert');
  await liteRTService.loadModel(TENSOR_G5_FILE, 'gpu', { supportsVision: true, supportsAudio: true });
  expect(liteRTService.getActiveBackend()).toBe('npu');
  expect(liteRTService.loadedTextOnly(TENSOR_G5_FILE)).toBe(true);
  expect(liteRTService.supportsAudio()).toBe(false);
});

it('refuses an image for a vision model whose TPU engine came up text-only, before any generation path', async () => {
  const boundary = installNativeBoundary();
  boundary.litert.module.getTpuSupport.mockResolvedValue(PIXEL_10_TPU);
  boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'npu', maxNumTokens: 4096, vision: false, audio: false });
  const { liteRTService } = require('../../../src/services/litert');
  const { localModelAcceptsImages, activeLocalTextCapabilities } = require('../../../src/services/engines');
  const model = createDownloadedModel({ id: 'g5', engine: 'litert', filePath: TENSOR_G5_FILE, fileName: 'gemma-4-E2B-it_Google_Tensor_G5.litertlm', liteRTVision: true });
  expect(localModelAcceptsImages(model)).toBe(true); // not loaded yet: the model's own flag decides
  await liteRTService.loadModel(TENSOR_G5_FILE, 'gpu', { supportsVision: true });
  expect(localModelAcceptsImages(model)).toBe(false);
  expect(activeLocalTextCapabilities(model).vision).toBe(false);
  await liteRTService.unloadModel();
  expect(localModelAcceptsImages(model)).toBe(true);
});

it('refuses an image at the engine when the TPU load came up text-only, on the first turn after a lazy load', async () => {
  const boundary = installNativeBoundary();
  boundary.litert.module.getTpuSupport.mockResolvedValue(PIXEL_10_TPU);
  boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'npu', maxNumTokens: 4096, vision: false, audio: false });
  const { liteRTService } = require('../../../src/services/litert');
  await liteRTService.loadModel(TENSOR_G5_FILE, 'gpu', { supportsVision: true });
  // The tool loop's entry point (generateRaw) and the plain path (sendMessage) both refuse.
  await expect(liteRTService.generateRaw('what is this?', { imageUris: ['file:///pic.png'] }))
    .rejects.toThrow(/Images are not available for this model on this device/);
  const onError = jest.fn();
  await liteRTService.sendMessage('what is this?', { onToken: jest.fn(), onReasoning: jest.fn(), onComplete: jest.fn(), onError }, { imageUris: ['file:///pic.png'] });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Images are not available/) }));
  expect(boundary.litert.calls.sendMessageWithImages).toEqual([]);
});

it('offers only CPU and GPU in Chat and Model Settings even with a saved NPU preference', async () => {
  installNativeBoundary();
  const React = require('react');
  const { render, fireEvent } = requireRTL();
  const { useAppStore } = require('../../../src/stores');
  await useAppStore.persist.rehydrate();
  const { GenerationSettingsModal } = require('../../../src/components/GenerationSettingsModal');
  const { TextGenerationSection } = require('../../../src/screens/ModelSettingsScreen/TextGenerationSection');
  const model = createDownloadedModel({ id: 'gemma-litert', engine: 'litert', filePath: '/models/gemma.litertlm' });
  useAppStore.getState().setDownloadedModels([model]);
  useAppStore.getState().setActiveModelId(model.id);
  useAppStore.getState().updateSettings({ liteRTBackend: 'npu' });
  const chat = render(React.createElement(GenerationSettingsModal, { visible: true, onClose: () => {} }));
  fireEvent.press(chat.getByText('TEXT GENERATION'));
  fireEvent.press(chat.getByTestId('modal-text-advanced-toggle'));
  expect(chat.queryByText('NPU (Beta)')).toBeNull();
  expect(chat.getByText(/Run on GPU via OpenCL/)).toBeTruthy();
  fireEvent.press(chat.getByText('CPU'));
  expect(useAppStore.getState().settings.liteRTBackend).toBe('cpu');
  chat.unmount();
  const settings = render(React.createElement(TextGenerationSection));
  fireEvent.press(settings.getByTestId('text-advanced-toggle'));
  expect(settings.queryByText('NPU (Beta)')).toBeNull();
  fireEvent.press(settings.getByText('GPU'));
  expect(useAppStore.getState().settings.liteRTBackend).toBe('gpu');
  expect(useAppStore.getState().loadedTextModelId).toBeNull();
  settings.unmount();
});
