import Voice from '@react-native-voice/voice';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

/**
 * The phone's own speech recognizer (Android SpeechRecognizer: on most phones Google's
 * speech service, the one Gboard voice typing uses). Atlas asks for the on-device
 * recognizer and for offline recognition, so speech stays on the phone when the
 * language's offline pack is installed. Used when no Whisper model is downloaded.
 */
export type SystemSpeechStatus = { available: boolean; onDevice: boolean };

export class SpeechCancelled extends Error {
  constructor() { super('Speech recognition cancelled'); this.name = 'SpeechCancelled'; }
}

/** Android SpeechRecognizer error codes that mean "nothing was said" rather than a failure. */
const NO_SPEECH_CODES = new Set(['6', '7']); // ERROR_SPEECH_TIMEOUT, ERROR_NO_MATCH
/** The on-device recognizer has no pack for this language: retry with the default one. */
const LANGUAGE_CODES = new Set(['12', '13']); // ERROR_LANGUAGE_NOT_SUPPORTED, ERROR_LANGUAGE_UNAVAILABLE

export type SystemSpeechSession = {
  /** Final transcript ('' when nothing was heard); rejects with SpeechCancelled on cancel. */
  result: Promise<string>;
  /** Stop listening and deliver what was heard. */
  stop: () => void;
  /** Stop listening and discard. */
  cancel: () => void;
};

let active: SystemSpeechSession | null = null;

export async function systemSpeechStatus(): Promise<SystemSpeechStatus> {
  if (Platform.OS !== 'android') return { available: false, onDevice: false };
  try {
    const available = !!(await Voice.isAvailable());
    const native: any = NativeModules.Voice;
    const onDevice = available && !!(await native?.isOnDeviceRecognitionAvailable?.());
    return { available, onDevice };
  } catch {
    return { available: false, onDevice: false };
  }
}

async function micPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

const firstResult = (e: { value?: string[] } | undefined) => (e?.value?.[0] ?? '').trim();

/** Start one recognition turn. The recognizer ends by itself when the speaker goes quiet. */
export async function listenWithSystemSpeech(opts: { onPartial?: (text: string) => void; locale?: string; endSilenceMs?: number } = {}): Promise<SystemSpeechSession> {
  if (active) active.cancel();
  if (!(await micPermission())) throw new Error('Microphone permission is needed to talk to Atlas.');
  let settle: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
  let partial = '';
  const result = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
  // A turn replaced by a newer one is cancelled; callers that still await it get the rejection.
  result.catch(() => undefined);
  const finish = (fn: (s: NonNullable<typeof settle>) => void) => {
    const s = settle;
    if (!s) return;
    settle = null;
    Voice.onSpeechResults = undefined as any;
    Voice.onSpeechPartialResults = undefined as any;
    Voice.onSpeechError = undefined as any;
    if (active === session) active = null;
    fn(s);
  };
  const session: SystemSpeechSession = {
    result,
    stop: () => { Voice.stop().catch(() => finish(s => s.resolve(partial))); },
    cancel: () => {
      Voice.cancel?.().catch(() => undefined);
      finish(s => s.reject(new SpeechCancelled()));
    },
  };
  Voice.onSpeechPartialResults = (e: any) => { partial = firstResult(e) || partial; opts.onPartial?.(partial); };
  Voice.onSpeechResults = (e: any) => finish(s => s.resolve(firstResult(e) || partial));
  let onDevice = true;
  const start = async () => {
    try {
      await Voice.start(opts.locale ?? '', {
        ...(onDevice ? { RECOGNIZER_ENGINE: 'ON_DEVICE' } : {}),
        EXTRA_PREFER_OFFLINE: true,
        EXTRA_PARTIAL_RESULTS: true,
        EXTRA_LANGUAGE_MODEL: 'LANGUAGE_MODEL_FREE_FORM',
        // How much quiet means "finished": the recognizer's own default is long (a second and a half or more), which is
        // most of the walkie-talkie pause in a call. These are hints; the recognizer may stretch them.
        ...(opts.endSilenceMs ? {
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: opts.endSilenceMs,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: Math.round(opts.endSilenceMs * 0.8),
        } : {}),
      } as any);
    } catch (error: any) {
      finish(s => s.reject(new Error(error?.message ?? 'Could not start the speech recognizer.')));
    }
  };
  Voice.onSpeechError = (e: any) => {
    const code = String(e?.error?.code ?? e?.error?.message ?? '').split('/')[0];
    if (onDevice && LANGUAGE_CODES.has(code)) { onDevice = false; start(); return; }
    if (NO_SPEECH_CODES.has(code)) finish(s => s.resolve(partial));
    else finish(s => s.reject(new Error(`The phone's speech recognizer failed (${e?.error?.message ?? code}).`)));
  };
  active = session;
  await start();
  return session;
}
