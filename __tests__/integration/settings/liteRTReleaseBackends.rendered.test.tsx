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

it('offers only CPU and GPU in Model Settings (the chat sheet opens it) even with a saved NPU preference', async () => {
  installNativeBoundary();
  const React = require('react');
  const { render, fireEvent } = requireRTL();
  const { useAppStore } = require('../../../src/stores');
  await useAppStore.persist.rehydrate();
  const { ModelSettingsScreen } = require('../../../src/screens/ModelSettingsScreen');
  const model = createDownloadedModel({ id: 'gemma-litert', engine: 'litert', filePath: '/models/gemma.litertlm' });
  useAppStore.getState().setDownloadedModels([model]);
  useAppStore.getState().setActiveModelId(model.id);
  useAppStore.getState().updateSettings({ liteRTBackend: 'npu' });
  // The chat's settings sheet no longer copies the settings: its "Model settings" row opens this screen.
  const settings = render(React.createElement(ModelSettingsScreen));
  // Acceleration is a General control.
  fireEvent.press(settings.getByTestId('model-settings-tab-general'));
  expect(settings.queryByText('NPU (Beta)')).toBeNull();
  expect(settings.getByText(/Faster answers on most phones/)).toBeTruthy();
  fireEvent.press(settings.getByText('CPU'));
  expect(useAppStore.getState().settings.liteRTBackend).toBe('cpu');
  expect(settings.queryByText('NPU (Beta)')).toBeNull();
  fireEvent.press(settings.getByText('GPU'));
  expect(useAppStore.getState().settings.liteRTBackend).toBe('gpu');
  expect(useAppStore.getState().loadedTextModelId).toBeNull();
  settings.unmount();
});
