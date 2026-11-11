/**
 * Recorder: the user picks a video of a meeting, Atlas reads its sound on the phone, and the
 * recording opens with a transcript labelled by speaker, like a live recording.
 * Fakes only the device boundary: file picker, files, whisper.rn, the decoder and speaker-label engine.
 */
import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: { id: (global as any).__recordingId } }),
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

it('transcribes and labels speakers in an uploaded video file', async () => {
  const boundary = installNativeBoundary({ fs: true, whisper: true, ram: { platform: 'android', totalBytes: 8 * 1024 * MB, availBytes: 6 * 1024 * MB } });
  const React = require('react');
  const RN = require('react-native');
  const rtl = requireRTL();
  const RNFS = require('react-native-fs');
  RN.NativeModules.AtlasSpeakers = {
    modelsReady: jest.fn(async () => true),
    decodeToWav: jest.fn(async (_uri: string, out: string) => { await RNFS.writeFile(out, 'RIFF'); return 6.1; }),
    diarize: jest.fn(async () => [{ start: 0, end: 2.4, speaker: 0 }, { start: 3.0, end: 6.1, speaker: 1 }]),
    cancel: jest.fn(async () => true),
    addListener: jest.fn(), removeListeners: jest.fn(),
  };
  require('@react-native-documents/picker').pick.mockResolvedValueOnce([{ uri: 'content://media/video/42', name: 'Team meeting.mp4' }]);
  const { useWhisperStore } = require('../../../src/stores/whisperStore');
  const { whisperService } = require('../../../src/services/whisperService');
  boundary.fs!.seedFile(whisperService.getModelPath('base.en'), 140 * MB);
  useWhisperStore.setState({ downloadedModelId: 'base.en' });
  const ctx = await boundary.whisper!.module.initWhisper();
  ctx.transcribe.mockImplementation(() => ({
    stop: jest.fn(async () => {}),
    promise: Promise.resolve({ result: '', isAborted: false, segments: [
      { text: 'Shall we start?', t0: 0, t1: 230 },
      { text: 'Yes, first the budget.', t0: 300, t1: 600 },
    ] }),
  }));

  const { RecorderScreen } = require('../../../src/atlasRecorder/RecorderScreen');
  const { useRecordings } = require('../../../src/atlasRecorder/store');
  useRecordings.setState({ consent: true, recordings: [] });
  const screen = rtl.render(React.createElement(RecorderScreen));
  rtl.fireEvent.press(screen.getByTestId('recorder-import'));

  await rtl.waitFor(() => expect(useRecordings.getState().recordings[0]?.status).toBe('done'));
  const rec = useRecordings.getState().recordings[0];
  expect(rec.title).toBe('Team meeting');
  expect(RN.NativeModules.AtlasSpeakers.decodeToWav).toHaveBeenCalledWith('content://media/video/42', rec.audioPath);
  expect(mockNav.navigate).toHaveBeenCalledWith('RecordingDetail', { id: rec.id });

  (global as any).__recordingId = rec.id;
  const { RecordingDetailScreen } = require('../../../src/atlasRecorder/RecordingDetailScreen');
  const detail = rtl.render(React.createElement(RecordingDetailScreen));
  const t = detail.getByTestId('recording-transcript');
  expect(rtl.within(t).getAllByText('Speaker 1').length).toBeGreaterThan(0);
  expect(rtl.within(t).getByText('Yes, first the budget.')).toBeTruthy();
  expect(rtl.within(t).getAllByText('Speaker 2').length).toBeGreaterThan(0);

  // Keep a copy outside Atlas: share the transcript, download it, download the audio.
  const share = jest.spyOn(RN.Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  rtl.fireEvent.press(detail.getByTestId('recording-share'));
  await rtl.waitFor(() => expect(share).toHaveBeenCalled());
  expect((share.mock.calls[0][0] as { message: string }).message).toMatch(/^# Team meeting\n\n\[0:00\] Speaker 1: Shall we start\?/);
  const picker = require('@react-native-documents/picker');
  picker.saveDocuments = jest.fn(async ({ fileName }: { fileName: string }) => [{ name: fileName }]);
  rtl.fireEvent.press(detail.getByTestId('recording-download-audio'));
  await rtl.waitFor(() => expect(picker.saveDocuments).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'Team meeting.wav', mimeType: 'audio/wav' })));
  rtl.fireEvent.press(detail.getByTestId('recording-download-text'));
  await rtl.waitFor(() => expect(picker.saveDocuments).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'Team meeting.txt', mimeType: 'text/plain' })));
});
