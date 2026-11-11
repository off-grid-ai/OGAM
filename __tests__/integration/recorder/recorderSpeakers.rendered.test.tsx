/**
 * Recorder (FF-07): the user agrees to tell people, records a two-person conversation, stops,
 * and sees a transcript with each person labelled, names a speaker, and fixes one line.
 * Fakes only the device boundary: microphone recorder, files, whisper.rn, the speaker-label engine.
 */
import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => {
  const nav = { navigate: jest.fn(), goBack: jest.fn() };
  return {
    useNavigation: () => nav,
    useRoute: () => ({ params: { id: (global as any).__recordingId } }),
    useFocusEffect: () => {}, useIsFocused: () => true,
  };
});

const turns = [
  { start: 0, end: 2.4, speaker: 3 },
  { start: 3.0, end: 6.1, speaker: 1 },
  { start: 6.7, end: 9.6, speaker: 3 },
];

it('records, transcribes and labels who said what, all on the phone', async () => {
  const boundary = installNativeBoundary({ fs: true, whisper: true, ram: { platform: 'android', totalBytes: 8 * 1024 * MB, availBytes: 6 * 1024 * MB } });
  const React = require('react');
  const RN = require('react-native');
  const rtl = requireRTL();
  RN.PermissionsAndroid.request = jest.fn(async () => 'granted');
  RN.NativeModules.AtlasSpeakers = {
    modelsReady: jest.fn(async () => true),
    diarize: jest.fn(async () => turns),
    cancel: jest.fn(async () => true),
    addListener: jest.fn(), removeListeners: jest.fn(),
  };
  const { useWhisperStore } = require('../../../src/stores/whisperStore');
  const { whisperService } = require('../../../src/services/whisperService');
  boundary.fs!.seedFile(whisperService.getModelPath('base.en'), 140 * MB);
  boundary.fs!.seedFile('/mock/audio/input.wav', 300_000);
  useWhisperStore.setState({ downloadedModelId: 'base.en' });
  // Whisper's timed text for the conversation (t0/t1 in 10 ms steps).
  const ctx = await boundary.whisper!.module.initWhisper();
  ctx.transcribe.mockImplementation(() => ({
    stop: jest.fn(async () => {}),
    promise: Promise.resolve({ result: '', isAborted: false, segments: [
      { text: 'Did you finish the report?', t0: 0, t1: 230 },
      { text: 'Almost, I need the sales numbers.', t0: 300, t1: 600 },
      { text: 'I will send them tonight.', t0: 670, t1: 950 },
    ] }),
  }));

  const { RecorderScreen } = require('../../../src/atlasRecorder/RecorderScreen');
  const { RecordingDetailScreen } = require('../../../src/atlasRecorder/RecordingDetailScreen');
  const { useRecordings } = require('../../../src/atlasRecorder/store');
  const screen = rtl.render(React.createElement(RecorderScreen));

  // Consent first: no record button until the user agrees to tell everyone.
  expect(screen.queryByLabelText('Start recording')).toBeNull();
  rtl.fireEvent.press(screen.getByText('I will tell everyone'));
  rtl.fireEvent.press(screen.getByLabelText('Start recording'));
  expect(await screen.findByTestId('recording-indicator')).toBeTruthy();
  rtl.fireEvent.press(screen.getByLabelText('Stop recording'));

  await rtl.waitFor(() => expect(useRecordings.getState().recordings[0]?.status).toBe('done'));
  const rec = useRecordings.getState().recordings[0];
  expect(await require('react-native-fs').exists(rec.audioPath)).toBe(true);
  (global as any).__recordingId = rec.id;

  const detail = rtl.render(React.createElement(RecordingDetailScreen));
  const lines = within(detail);
  expect(lines).toEqual([
    ['Speaker 1', 'Did you finish the report?'],
    ['Speaker 2', 'Almost, I need the sales numbers.'],
    ['Speaker 1', 'I will send them tonight.'],
  ]);

  // Name a speaker, then fix who said the last line.
  rtl.fireEvent(detail.getByTestId('speaker-name-0'), 'endEditing', { nativeEvent: { text: 'Sam' } });
  await rtl.waitFor(() => expect(within(detail)[0][0]).toBe('Sam'));
  rtl.fireEvent.press(detail.getAllByText('Sam')[1]);
  await rtl.waitFor(() => expect(within(detail)[2][0]).toBe('Speaker 2'));

  function within(view: any): string[][] {
    const t = view.getByTestId('recording-transcript');
    const texts = rtl.within(t).getAllByText(/./).map((n: any) => n.props.children).filter((c: any) => typeof c === 'string');
    const out: string[][] = [];
    for (let i = 0; i < texts.length; i++) {
      if (/^\d+:\d\d$/.test(texts[i + 1] ?? '')) { out.push([texts[i], texts[i + 2]]); i += 2; }
    }
    return out;
  }
});
