import Voice from '@react-native-voice/voice';
import { NativeModules, Platform } from 'react-native';
import { listenWithSystemSpeech, systemSpeechStatus, SpeechCancelled } from '../../../src/services/systemSpeech';

const voice = Voice as any;

beforeEach(() => {
  jest.clearAllMocks();
  voice.cancel = jest.fn(() => Promise.resolve());
  voice.start = jest.fn(() => Promise.resolve());
  voice.stop = jest.fn(() => Promise.resolve());
});

describe('systemSpeech', () => {
  it('asks for the on-device recognizer and offline recognition', async () => {
    await listenWithSystemSpeech();
    expect(voice.start).toHaveBeenCalledWith('', expect.objectContaining({
      RECOGNIZER_ENGINE: 'ON_DEVICE', EXTRA_PREFER_OFFLINE: true, EXTRA_PARTIAL_RESULTS: true,
    }));
  });

  it('asks the recognizer to end the turn after a short pause when told to', async () => {
    await listenWithSystemSpeech({ endSilenceMs: 1000 });
    expect(voice.start.mock.calls[0][1]).toEqual(expect.objectContaining({
      EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1000, EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 800,
    }));
    await listenWithSystemSpeech();
    expect(voice.start.mock.calls[1][1].EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS).toBeUndefined();
  });

  it('resolves the final transcript and reports partial text while listening', async () => {
    const partials: string[] = [];
    const session = await listenWithSystemSpeech({ onPartial: t => partials.push(t) });
    voice.onSpeechPartialResults({ value: ['hello'] });
    voice.onSpeechResults({ value: ['hello there'] });
    await expect(session.result).resolves.toBe('hello there');
    expect(partials).toEqual(['hello']);
  });

  it('treats a speech timeout as nothing heard, not a failure', async () => {
    const session = await listenWithSystemSpeech();
    voice.onSpeechError({ error: { code: '6', message: '6/No speech input' } });
    await expect(session.result).resolves.toBe('');
  });

  it('retries with the default recognizer when the offline language pack is missing', async () => {
    const session = await listenWithSystemSpeech();
    voice.onSpeechError({ error: { code: '13', message: '13/Language unavailable' } });
    expect(voice.start).toHaveBeenCalledTimes(2);
    expect(voice.start.mock.calls[1][1].RECOGNIZER_ENGINE).toBeUndefined();
    expect(voice.start.mock.calls[1][1].EXTRA_PREFER_OFFLINE).toBe(true);
    voice.onSpeechResults({ value: ['ok'] });
    await expect(session.result).resolves.toBe('ok');
  });

  it('rejects with SpeechCancelled when cancelled and surfaces real errors', async () => {
    const cancelled = await listenWithSystemSpeech();
    cancelled.cancel();
    await expect(cancelled.result).rejects.toBeInstanceOf(SpeechCancelled);
    const failed = await listenWithSystemSpeech();
    voice.onSpeechError({ error: { code: '9', message: '9/Insufficient permissions' } });
    await expect(failed.result).rejects.toThrow(/speech recognizer failed/);
  });

  it('reports on-device availability on Android', async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    (NativeModules as any).Voice = { isOnDeviceRecognitionAvailable: jest.fn(async () => true) };
    try {
      await expect(systemSpeechStatus()).resolves.toEqual({ available: true, onDevice: true });
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
      delete (NativeModules as any).Voice;
    }
  });
});
