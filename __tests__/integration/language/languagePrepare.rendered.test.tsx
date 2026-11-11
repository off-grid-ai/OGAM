/**
 * "Prepare this level": the learner taps it on the board and the AI on the phone writes the
 * lessons the level is missing, so the level then opens without waiting. Fakes only the device
 * boundary (llama.rn text engine, files, RAM).
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

it('writes the missing lessons of a level with the on-device AI', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../../src/stores');
  const { hardwareService } = require('../../../src/services/hardware');
  const { useLanguage } = require('../../../src/language/store');
  const { languageService } = require('../../../src/language/languageService');
  const { unitsForLevel, unitById } = require('../../../src/language/curriculum');
  const { LanguageScreen } = require('../../../src/language/LanguageScreen');

  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });

  // Everything in A1 is written except the Colours unit.
  const filler = [{ en: 'x', t: 'x' }];
  const content = Object.fromEntries(unitsForLevel(1).filter((u: any) => !u.builtIn && u.id !== 'colors').map((u: any) => [u.id, filler]));
  useLanguage.setState({ language: 'es-ES', level: 1, content: { 'es-ES': content }, listening: { 'es-ES': [] } });
  const { pieces } = languageService.levelToPrepare(1);
  useLanguage.setState({ listening: { 'es-ES': pieces.map((id: string) => ({ kind: 'story', title: id, parts: [], vocab: [], createdAt: 1, pieceId: id })) } });

  const es = ['rojo', 'azul', 'verde', 'amarillo', 'negro', 'blanco', 'El coche es rojo.', 'Mi color favorito es el azul.'];
  boundary.llama!.scriptCompletion({ text: JSON.stringify(unitById('colors').items.map((en: string, i: number) => ({ en, t: es[i] }))) });

  const board = rtl.render(React.createElement(LanguageScreen));
  expect(board.getByText(/1 lesson and 0 stories in A1/)).toBeTruthy();
  rtl.fireEvent.press(board.getByTestId('language-prepare-start'));
  expect(await board.findByText(/A1 is ready/, {}, { timeout: 8000 })).toBeTruthy();
  expect(useLanguage.getState().content['es-ES'].colors.map((x: any) => x.t)).toEqual(es);

  // A unit written before it had example sentences gets five when it is opened with the model loaded.
  const sentences = ['Mi coche es azul.', 'No me gusta el verde.', '¿Tu casa es blanca?', 'Ellos tienen un perro negro.', 'Nosotros pintamos la puerta roja.'];
  boundary.llama!.scriptCompletion({ text: JSON.stringify({ items: sentences.map((t, i) => ({ en: `Sentence ${i}`, t })) }) });
  useLanguage.setState({ content: { 'es-ES': { ...useLanguage.getState().content['es-ES'], colors: es.slice(0, 6).map((t) => ({ en: `${t} (en)`, t })) } } });
  const words = await languageService.unitWords('colors');
  expect(words.map((x: any) => x.t)).toEqual([...es.slice(0, 6), ...sentences]);
  expect(useLanguage.getState().content['es-ES'].colors).toHaveLength(11);
}, 20000);
