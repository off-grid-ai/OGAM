import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import { liteRTModelFile } from '../../utils/liteRTModelFile';

it.each([
  // Model settings, as the chat sheet's "Model settings" row opens it, and its Text section alone.
  ['gemma-4-E2B-it.litertlm', 2588147712, 'model settings'],
  ['gemma-4-E4B-it.litertlm', 3659530240, 'text section'],
])('allows 32000 tokens before loading %s (%s bytes) in %s', async (fileName, fileSize, surface) => {
  const boundary = installNativeBoundary({ fs: true });
  const React = require('react');
  const { render, fireEvent, waitFor } = requireRTL();
  const { useAppStore } = require('../../../src/stores');
  await useAppStore.persist.rehydrate();
  const { liteRTService } = require('../../../src/services/litert');
  const { ModelSettingsScreen } = require('../../../src/screens/ModelSettingsScreen');
  const { TextGenerationSection } = require('../../../src/screens/ModelSettingsScreen/TextGenerationSection');
  const model = createDownloadedModel({
    id: `offgrid/litert-recommended/${fileName}`, engine: 'litert',
    fileName: String(fileName), fileSize: Number(fileSize), filePath: `/models/${fileName}`,
  });
  await boundary.fs!.module.writeFile(model.filePath!, liteRTModelFile([10, 2, 1, 2]).toString('base64'), 'base64');
  useAppStore.getState().setDownloadedModels([model]);
  useAppStore.getState().setActiveModelId(model.id);
  const fullScreen = surface === 'model settings';
  const screen = render(fullScreen
    ? React.createElement(ModelSettingsScreen)
    : React.createElement(TextGenerationSection));
  if (fullScreen) fireEvent.press(screen.getByTestId('model-settings-tab-text'));
  await waitFor(() => expect(screen.getByText(/Model limit: 32000 tokens/)).toBeTruthy());
  const control = 'litert-max-tokens';
  fireEvent.press(screen.getByTestId(`${control}-value-button`));
  fireEvent.changeText(screen.getByTestId(`${control}-input`), '32768');
  fireEvent(screen.getByTestId(`${control}-input`), 'submitEditing');
  expect(screen.getByText('32000')).toBeTruthy();
  expect(useAppStore.getState().settings.liteRTMaxTokens).toBe(32000);
  expect(liteRTService.isModelLoaded()).toBe(false);
  screen.unmount();
});

it('reads the selected file before load, accepts more than 4K, and separates loaded context from model limit', async () => {
  const boundary = installNativeBoundary({ fs: true });
  const React = require('react');
  const { render, fireEvent, waitFor, act } = requireRTL();
  const { useAppStore } = require('../../../src/stores');
  await useAppStore.persist.rehydrate();
  const { liteRTService } = require('../../../src/services/litert');
  const { TextGenerationSection } = require('../../../src/screens/ModelSettingsScreen/TextGenerationSection');
  const model = createDownloadedModel({ id: 'litert-context', engine: 'litert', filePath: '/models/context.litertlm' });
  await boundary.fs!.module.writeFile(model.filePath!, liteRTModelFile([40, 128, 128, 2]).toString('base64'), 'base64');
  useAppStore.getState().setDownloadedModels([model]);
  useAppStore.getState().setActiveModelId(model.id);
  useAppStore.getState().updateSettings({ liteRTMaxTokens: 4096 });
  const screen = render(React.createElement(TextGenerationSection));
  await waitFor(() => expect(screen.getByText(/Model limit: 32768 tokens/)).toBeTruthy());
  expect(liteRTService.isModelLoaded()).toBe(false);
  fireEvent.press(screen.getByTestId('litert-max-tokens-value-button'));
  fireEvent.changeText(screen.getByTestId('litert-max-tokens-input'), '16384');
  fireEvent(screen.getByTestId('litert-max-tokens-input'), 'submitEditing');
  expect(screen.getByText('16384')).toBeTruthy();
  expect(useAppStore.getState().settings.liteRTMaxTokens).toBe(16384);
  await act(async () => {
    await liteRTService.loadModel(model.filePath, 'gpu', { maxNumTokens: 16384 });
    useAppStore.getState().setLoadedTextModelId(model.id);
  });
  await waitFor(() => expect(screen.getByText(/Model limit: 32768 tokens. Loaded context: 4096 tokens/)).toBeTruthy());
  expect(screen.getByText('16384')).toBeTruthy();
  screen.unmount();
});

it('clamps old values to the file limit and never reuses a different model limit', async () => {
  const boundary = installNativeBoundary({ fs: true });
  const React = require('react');
  const { render, waitFor, act } = requireRTL();
  const { useAppStore } = require('../../../src/stores');
  await useAppStore.persist.rehydrate();
  const { TextGenerationSection } = require('../../../src/screens/ModelSettingsScreen/TextGenerationSection');
  const model = createDownloadedModel({ id: 'limited', engine: 'litert', filePath: '/models/limited.litertlm' });
  const unknown = createDownloadedModel({ id: 'unknown', engine: 'litert', filePath: '/models/unknown.litertlm' });
  await boundary.fs!.module.writeFile(model.filePath!, liteRTModelFile([40, 128, 64]).toString('base64'), 'base64');
  useAppStore.getState().setDownloadedModels([model, unknown]);
  useAppStore.getState().setActiveModelId(model.id);
  useAppStore.getState().updateSettings({ liteRTMaxTokens: 16384 });
  const screen = render(React.createElement(TextGenerationSection));
  await waitFor(() => expect(screen.getByText('8192')).toBeTruthy());
  expect(useAppStore.getState().settings.liteRTMaxTokens).toBe(8192);
  act(() => useAppStore.getState().setActiveModelId(unknown.id));
  await waitFor(() => expect(screen.getByText(/Model limit unavailable/)).toBeTruthy());
  expect(screen.queryByText(/Model limit: 8192/)).toBeNull();
  screen.unmount();
});
