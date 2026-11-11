/**
 * "Load the AI model now" on the briefing and Learn screens loads the downloaded text model on demand.
 * Fakes only the device boundary (llama.rn engine, files, RAM).
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

it('loads the text model when the button is pressed, and says so', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../../src/stores');
  const { hardwareService } = require('../../../src/services/hardware');
  const { ForceLoadModel } = require('../../../src/components/ForceLoadModel');

  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: null });

  const view = rtl.render(React.createElement(ForceLoadModel));
  rtl.fireEvent.press(view.getByTestId('force-load-model'));
  expect(await view.findByText('The AI model is loaded.', {}, { timeout: 8000 })).toBeTruthy();
  expect(useAppStore.getState().loadedTextModelId).toBe('llm');
}, 30000);
