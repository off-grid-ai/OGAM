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

it('offers only CPU and GPU in Chat and Model Settings even with a saved NPU preference', async () => {
  installNativeBoundary();
  const React = require('react');
  const { render, fireEvent } = requireRTL();
  const { useAppStore } = require('../../../src/stores');
  await useAppStore.persist.rehydrate();
  const { GenerationSettingsModal } = require('../../../src/components/GenerationSettingsModal');
  const { GeneralGenerationControls } = require('../../../src/components/settings/GeneralGenerationControls');
  const model = createDownloadedModel({ id: 'gemma-litert', engine: 'litert', filePath: '/models/gemma.litertlm' });
  useAppStore.getState().setDownloadedModels([model]);
  useAppStore.getState().setActiveModelId(model.id);
  useAppStore.getState().updateSettings({ liteRTBackend: 'npu' });
  const chat = render(React.createElement(GenerationSettingsModal, { visible: true, onClose: () => {} }));
  // Acceleration is a General control on both surfaces.
  fireEvent.press(chat.getByTestId('modal-general-accordion'));
  expect(chat.queryByText('NPU (Beta)')).toBeNull();
  expect(chat.getByText(/Run on GPU via OpenCL/)).toBeTruthy();
  fireEvent.press(chat.getByText('CPU'));
  expect(useAppStore.getState().settings.liteRTBackend).toBe('cpu');
  chat.unmount();
  const settings = render(React.createElement(GeneralGenerationControls));
  expect(settings.queryByText('NPU (Beta)')).toBeNull();
  fireEvent.press(settings.getByText('GPU'));
  expect(useAppStore.getState().settings.liteRTBackend).toBe('gpu');
  expect(useAppStore.getState().loadedTextModelId).toBeNull();
  settings.unmount();
});
