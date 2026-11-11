/**
 * "Prepare only the next lesson": the learner taps it and the AI writes just the next square that
 * needs writing, not the whole level. Fakes only the device boundary (llama.rn text engine, files, RAM).
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

it('writes only the next lesson that needs writing, and leaves the rest of the level alone', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../../src/stores');
  const { hardwareService } = require('../../../src/services/hardware');
  const { useLanguage } = require('../../../src/language/store');
  const { unitById } = require('../../../src/language/curriculum');
  const { boardFor } = require('../../../src/language/board');
  const { LanguageScreen } = require('../../../src/language/LanguageScreen');

  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
  useLanguage.setState({ language: 'es-ES', level: 1, content: {}, listening: { 'es-ES': [] }, progress: {} });

  // The first two lessons on the board that the AI has to write.
  const written = boardFor(1).filter((s: any) => s.kind === 'lesson').map((s: any) => unitById(s.unitId)).filter((u: any) => !u.builtIn);
  const [first, second] = [written[0], written[1]];
  boundary.llama!.scriptCompletion({ text: JSON.stringify(first.items.map((en: string, i: number) => ({ en, t: `palabra${i}` }))) });

  const board = rtl.render(React.createElement(LanguageScreen));
  rtl.fireEvent.press(board.getByTestId('language-prepare-next'));
  await rtl.waitFor(() => expect(useLanguage.getState().content['es-ES']?.[first.id]?.length).toBeGreaterThan(0), { timeout: 8000 });
  expect(useLanguage.getState().content['es-ES']?.[second.id]).toBeUndefined();
}, 20000);
