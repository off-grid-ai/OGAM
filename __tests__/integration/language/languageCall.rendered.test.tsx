/**
 * A practice phone call: the AI plays a waiter and speaks only Spanish, the learner answers (typed here,
 * because the test phone has no speech recognizer), asks for a hint, hangs up and sees the mistakes.
 * Fakes only the device boundary (llama.rn text engine, files, RAM).
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
}));

it('plays a waiter in Spanish, offers a hint, and shows the learner\'s mistakes after the call', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../../src/stores');
  const { hardwareService } = require('../../../src/services/hardware');
  const { useLanguage } = require('../../../src/language/store');
  const { languageService } = require('../../../src/language/languageService');
  const { CallScreen } = require('../../../src/language/CallScreen');

  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
  useLanguage.setState({ language: 'es-ES', level: 1, progress: {}, glossary: {}, memory: {} });

  mockParams = { scenarioId: 'cafe', key: 'call@1.1' };
  boundary.llama!.scriptCompletion({ text: 'Buenos días. ¿Qué desea tomar?' });
  const screen = rtl.render(React.createElement(CallScreen));
  expect(await screen.findByText(/Qué desea tomar/, {}, { timeout: 8000 })).toBeTruthy();

  // With captions off the caller's lines are hidden until tapped, so the learner can listen first.
  rtl.fireEvent.press(screen.getByTestId('call-captions'));
  expect(screen.queryByText(/Qué desea tomar/)).toBeNull();
  rtl.fireEvent.press(screen.getByTestId('call-reveal-0'));
  expect(screen.getByText(/Qué desea tomar/)).toBeTruthy();
  rtl.fireEvent.press(screen.getByTestId('call-captions'));

  const say = async (line: string, reply: string) => {
    boundary.llama!.scriptCompletion({ text: reply });
    const box = await screen.findByTestId('call-typed');
    rtl.fireEvent.changeText(box, line);
    rtl.fireEvent.press(screen.getByTestId('call-send'));
    expect(await screen.findByText(line)).toBeTruthy();
  };

  boundary.llama!.scriptCompletion({ text: 'Quiero un pastel.\nI want a cake.' });
  rtl.fireEvent.press(await screen.findByTestId('call-hint-button'));
  expect(await screen.findByText('I want a cake.', {}, { timeout: 8000 })).toBeTruthy();

  await say('Yo quiero un café', 'Muy bien. ¿Algo más?');
  await screen.findByText(/Algo más/, {}, { timeout: 8000 });
  await say('Un pastel, por favor', 'Claro. ¿Algo más?');
  await rtl.waitFor(() => expect(screen.getAllByText(/Algo más/).length).toBe(2), { timeout: 8000 });
  await say('La cuenta, por favor', 'Son diez euros. Adiós.');
  await screen.findByText(/Son diez euros/, {}, { timeout: 8000 });

  boundary.llama!.scriptCompletion({ text: 'Yo quiero un café | Quiero un café | In Spanish the pronoun is usually left out' });
  rtl.fireEvent.press(screen.getByTestId('call-end'));
  expect(await screen.findByTestId('call-review', {}, { timeout: 8000 })).toBeTruthy();
  expect(screen.getByText('Yo quiero un café')).toBeTruthy();
  expect(screen.getByText(/pronoun is usually left out/)).toBeTruthy();
  // Three lines said: the board's call square is done.
  expect(languageService.isDone('call@1.1')).toBe(true);
}, 40000);

it('listens with the Whisper transcription model, in the language being learned, when one is downloaded', async () => {
  const boundary = installNativeBoundary({ llama: true, whisper: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const RNFS = require('react-native-fs');
  const { useAppStore } = require('../../../src/stores');
  const { useWhisperStore } = require('../../../src/stores/whisperStore');
  const { useLanguage } = require('../../../src/language/store');
  const { CallScreen } = require('../../../src/language/CallScreen');

  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  boundary.fs!.seedFile(`${RNFS.DocumentDirectoryPath}/whisper-models/ggml-base.bin`, 142 * 1024 * 1024);
  await useWhisperStore.getState().refreshPresentModels();
  useWhisperStore.setState({ downloadedModelId: 'base' });
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
  useLanguage.setState({ language: 'es-ES', level: 1, progress: {}, glossary: {}, memory: {} });

  mockParams = { scenarioId: 'cafe' };
  boundary.llama!.scriptCompletion({ text: 'Buenos días. ¿Qué desea?' });
  const screen = rtl.render(React.createElement(CallScreen));
  expect(await screen.findByText(/Qué desea/, {}, { timeout: 8000 })).toBeTruthy();

  // The microphone is open (Whisper listening): tapping the square ends the turn and Whisper writes it down in Spanish.
  boundary.whisper!.setFileTranscript('Un café, por favor');
  boundary.llama!.scriptCompletion({ text: 'Muy bien. ¿Algo más?' });
  await rtl.waitFor(() => expect(screen.getByTestId('call-talk').props.accessibilityLabel).toBe('Done talking'), { timeout: 8000 });
  rtl.fireEvent.press(screen.getByTestId('call-talk'));
  expect(await screen.findByText('Un café, por favor', {}, { timeout: 8000 })).toBeTruthy();
  expect(await screen.findByText(/Algo más/, {}, { timeout: 8000 })).toBeTruthy();
  // It was asked to expect Spanish.
  const context = await require('../../../src/services/whisperService').whisperService['context'];
  expect(context.transcribe.mock.calls[0][1]).toEqual(expect.objectContaining({ language: 'es' }));
}, 40000);

it('with no AI model to answer, says so with a way to load it, and End call still leaves the call', async () => {
  installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../../src/stores');
  const { useLanguage } = require('../../../src/language/store');
  const { CallScreen } = require('../../../src/language/CallScreen');
  useAppStore.setState({ downloadedModels: [], activeModelId: null });
  useLanguage.setState({ language: 'es-ES', level: 1, progress: {}, glossary: {}, memory: {} });

  mockParams = { scenarioId: 'cafe' };
  const screen = rtl.render(React.createElement(CallScreen));
  expect(await screen.findByText(/No model downloaded/, {}, { timeout: 8000 })).toBeTruthy();
  expect(screen.getByTestId('call-force-load')).toBeTruthy();
  rtl.fireEvent.press(screen.getByTestId('call-end'));
  expect(await screen.findByTestId('call-review', {}, { timeout: 8000 })).toBeTruthy();
  rtl.fireEvent.press(screen.getByTestId('call-done'));
  expect(mockNav.goBack).toHaveBeenCalled();
}, 40000);
