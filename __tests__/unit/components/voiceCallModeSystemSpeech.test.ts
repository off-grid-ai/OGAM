/**
 * Voice (call) mode with no Whisper model: the phone's own recognizer must transcribe
 * each turn and auto-send it. Previously a direct-audio chat model made voice mode
 * "available", recorded a file, then found nothing to transcribe it with.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import Voice from '@react-native-voice/voice';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { useUiModeStore, useWhisperStore } from '../../../src/stores';
import { activeModelService } from '../../../src/services/activeModelService';
import { audioRecorderService } from '../../../src/services/audioRecorderService';
import { useVoiceInput } from '../../../src/components/ChatInput/Voice';

const voice = Voice as any;
const os = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  (NativeModules as any).Voice = { isOnDeviceRecognitionAvailable: jest.fn(async () => true) };
  voice.start = jest.fn(() => Promise.resolve());
  voice.stop = jest.fn(() => Promise.resolve());
  voice.cancel = jest.fn(() => Promise.resolve());
  voice.isAvailable = jest.fn(() => Promise.resolve(true));
  useWhisperStore.setState({ downloadedModelId: null } as any);
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  jest.spyOn(activeModelService, 'supportsAudioInput').mockReturnValue(true);
  jest.spyOn(audioRecorderService, 'supportsDirectAudioInput').mockReturnValue(true);
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
  delete (NativeModules as any).Voice;
  jest.restoreAllMocks();
});

it('call mode without Whisper transcribes with the phone recognizer and auto-sends text', async () => {
  useUiModeStore.setState({ interfaceMode: 'audio' } as any);
  const onAutoSend = jest.fn();
  const record = jest.spyOn(audioRecorderService, 'startRecording');
  const { result } = renderHook(() => useVoiceInput({ conversationId: 'c1', onTranscript: jest.fn(), onAutoSend }));
  await waitFor(() => expect(result.current.voiceAvailable).toBe(true));
  await act(async () => { result.current.startRecording(); });
  await waitFor(() => expect(voice.start).toHaveBeenCalled());
  expect(record).not.toHaveBeenCalled();
  expect(result.current.isRecording).toBe(true);
  await act(async () => { voice.onSpeechResults({ value: ['what is the weather'] }); });
  await waitFor(() => expect(onAutoSend).toHaveBeenCalledWith('what is the weather'));
  expect(result.current.isRecording).toBe(false);
});

it('text chat keeps its existing mic behaviour (keyboard dictation / Whisper download)', async () => {
  useUiModeStore.setState({ interfaceMode: 'chat' } as any);
  const { result } = renderHook(() => useVoiceInput({ conversationId: 'c1', onTranscript: jest.fn() }));
  await act(async () => { await Promise.resolve(); });
  expect(result.current.voiceAvailable).toBe(true); // direct-audio model, as before
  expect(voice.start).not.toHaveBeenCalled();
});

it('call mode is unavailable when neither Whisper nor a phone recognizer exists', async () => {
  voice.isAvailable = jest.fn(() => Promise.resolve(false));
  useUiModeStore.setState({ interfaceMode: 'audio' } as any);
  const { result } = renderHook(() => useVoiceInput({ conversationId: 'c1', onTranscript: jest.fn(), onAutoSend: jest.fn() }));
  await act(async () => { await Promise.resolve(); });
  expect(result.current.voiceAvailable).toBe(false);
});
