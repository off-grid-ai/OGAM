/**
 * The speaking exercise in a lesson listens with Atlas's transcription model (Whisper) when a multilingual one is
 * downloaded, told which language to expect. Fakes only the device boundary.
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';

it('writes down what the learner says with the Whisper model, in the language being learned', async () => {
  const boundary = installNativeBoundary({ whisper: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const RNFS = require('react-native-fs');
  const { useWhisperStore } = require('../../../src/stores/whisperStore');
  const { ExerciseView } = require('../../../src/language/Exercises');

  boundary.fs!.seedFile(`${RNFS.DocumentDirectoryPath}/whisper-models/ggml-base.bin`, 142 * 1024 * 1024);
  await useWhisperStore.getState().refreshPresentModels();
  useWhisperStore.setState({ downloadedModelId: 'base' });
  boundary.whisper!.setFileTranscript('Buenos días');

  const picked: string[] = [];
  const ex = { kind: 'speak', item: { en: 'Good morning.', t: 'Buenos días.' }, answer: 'Buenos días.' };
  const view = rtl.render(React.createElement(ExerciseView, {
    ex, lang: 'es-ES', langName: 'Spanish', attempt: { value: '', checked: false }, onPick: (v: string) => picked.push(v), onMatched: () => undefined,
  }));
  rtl.fireEvent.press(view.getByTestId('lesson-speak'));
  await rtl.waitFor(() => expect(view.getByTestId('lesson-speak').props.accessibilityLabel).toBe('Listening'), { timeout: 8000 });
  rtl.fireEvent.press(view.getByTestId('lesson-speak'));
  await rtl.waitFor(() => expect(picked).toContain('Buenos días'), { timeout: 8000 });
  const context = await require('../../../src/services/whisperService').whisperService['context'];
  expect(context.transcribe.mock.calls[0][1]).toEqual(expect.objectContaining({ language: 'es' }));
}, 40000);
