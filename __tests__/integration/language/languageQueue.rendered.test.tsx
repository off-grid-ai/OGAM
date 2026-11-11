/**
 * Two things ask the model at once (the learner taps two words); the course's writing waits its turn
 * instead of one of them failing with "Generation already in progress". Fakes only the device boundary.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

it('answers two word lookups that overlap', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const { useAppStore } = require('../../../src/stores');
  const { hardwareService } = require('../../../src/services/hardware');
  const { useLanguage } = require('../../../src/language/store');
  const { languageService } = require('../../../src/language/languageService');

  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
  useLanguage.setState({ language: 'es-ES', content: {}, glossary: {}, myWords: {}, listening: {} });
  boundary.llama!.scriptCompletion({ text: 'cat' });

  const [a, b] = await Promise.all([languageService.lookupWord('gato'), languageService.lookupWord('perro')]);
  expect(a).toBe('cat');
  expect(b).toBe('cat');
}, 20000);
