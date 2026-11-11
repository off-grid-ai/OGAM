/**
 * How the learner's turn on a practice call is heard. It uses the same engine as Atlas's transcription: the
 * downloaded Whisper model (multilingual, told which language to expect), with the same quiet-after-speech rule as
 * the main call (endOfSpeech.ts). Without a multilingual Whisper model it falls back to the phone's own recognizer,
 * and without that the caller types. Returns one shape for all of them so the call does not care which is active.
 */
import { audioRecorderService } from '../services/audioRecorderService';
import { whisperService, WHISPER_MODELS } from '../services/whisperService';
import { useWhisperStore } from '../stores/whisperStore';
import { SpeechCancelled, listenWithSystemSpeech, systemSpeechStatus, type SystemSpeechSession } from '../services/systemSpeech';
import { CALL_END_OF_SPEECH, EndOfSpeechDetector } from '../atlasVoice/endOfSpeech';
import logger from '../utils/logger';

export type ListenEngine = 'whisper' | 'system';
export interface Listening extends SystemSpeechSession { engine: ListenEngine }
export interface ListenOptions {
  /** The AI model must stay loaded (a call needs it to answer); otherwise it may be freed to make room for Whisper. */
  keepTextModel?: boolean;
  /** Live words while the person talks (only the phone recognizer has them). */
  onPartial?: (text: string) => void;
  /** Whisper is writing down what was said (after the person stopped). */
  onTranscribing?: () => void;
}

/** Whisper's language code for a course language ("es-ES" -> "es"). */
export const whisperLanguage = (code: string): string => code.split('-')[0].toLowerCase();

const isMulti = (id: string | null | undefined) => !!id && WHISPER_MODELS.find((m) => m.id === id)?.lang === 'multi';

/** The multilingual Whisper model to use: the chosen one, else any multilingual one on the phone. */
function multilingualId(): string | null {
  const { downloadedModelId, presentModelIds } = useWhisperStore.getState();
  if (isMulti(downloadedModelId)) return downloadedModelId;
  return presentModelIds.find(isMulti) ?? null;
}

/** True when a Whisper model that understands more than English (the ".en" models do not) is on the phone. */
export function hasMultilingualWhisper(): boolean {
  return multilingualId() !== null;
}

/** Why Whisper could not be used the last time, in words the learner can act on. */
let whisperProblem = '';

/**
 * Whisper resident. A call keeps the AI loaded (it needs both); a lesson exercise only needs Whisper, so the AI is freed
 * for it when memory is short (it loads again when the next lesson needs it).
 */
async function whisperReady(keepText: boolean): Promise<boolean> {
  whisperProblem = '';
  const store = useWhisperStore.getState();
  const wanted = multilingualId();
  if (wanted && store.downloadedModelId !== wanted && whisperService.isModelLoaded()) await store.unloadModel();
  if (wanted && store.downloadedModelId !== wanted) useWhisperStore.setState({ downloadedModelId: wanted });
  if (whisperService.isModelLoaded()) return true;
  try {
    let result = await useWhisperStore.getState().loadModel();
    if (result === 'blocked' && !keepText) {
      const { activeModelService } = require('../services/activeModelService');
      await activeModelService.unloadAllModels(true);
      result = await useWhisperStore.getState().loadModel();
    }
    if (result === 'loaded') return true;
    whisperProblem = result === 'blocked'
      ? 'There is not enough memory to hold the transcription model and the AI together. Pick a smaller transcription model (Tiny or Base), or a smaller AI model.'
      : `The transcription model could not load: ${useWhisperStore.getState().error ?? 'unknown error'}.`;
  } catch (e: any) { whisperProblem = `The transcription model could not load: ${String(e?.message || e)}.`; }
  return false;
}

async function listenWithWhisper(code: string, o: ListenOptions): Promise<Listening> {
  await audioRecorderService.startRecording();
  const detector = new EndOfSpeechDetector(Date.now(), CALL_END_OF_SPEECH);
  let finished = false;
  let resolve!: (text: string) => void;
  let reject!: (e: Error) => void;
  const result = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  result.catch(() => undefined);

  const stop = async () => {
    if (finished) return;
    finished = true;
    audioRecorderService.setLevelListener(null);
    try {
      const { path } = await audioRecorderService.stopRecording();
      o.onTranscribing?.();
      resolve(await whisperService.transcribeFile(path, { language: whisperLanguage(code) }));
    } catch (e: any) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  };
  audioRecorderService.setLevelListener((rms) => {
    const verdict = detector.push(rms, Date.now());
    if (verdict === 'end') stop();
    else if (verdict === 'nothing' && !finished) {
      finished = true;
      audioRecorderService.setLevelListener(null);
      audioRecorderService.cancelRecording();
      resolve('');
    }
  });
  return {
    engine: 'whisper', result,
    stop: () => { stop(); },
    cancel: () => {
      if (finished) return;
      finished = true;
      audioRecorderService.setLevelListener(null);
      audioRecorderService.cancelRecording();
      reject(new SpeechCancelled());
    },
  };
}

/** Starts listening for the learner, with the best engine there is; null when nothing on this phone can listen. */
export async function listenInLanguage(code: string, o: ListenOptions = {}): Promise<Listening | null> {
  if (hasMultilingualWhisper() && (await whisperReady(!!o.keepTextModel))) {
    try { return await listenWithWhisper(code, o); } catch (e) { whisperProblem = `Listening could not start: ${String((e as Error)?.message || e)}`; logger.warn('[CALL] Whisper could not start, using the phone recognizer:', e); }
  }
  if (!(await systemSpeechStatus()).available) {
    // A downloaded transcription model that would not run is worth telling about; with none, the learner types instead.
    if (whisperProblem) throw new Error(whisperProblem);
    return null;
  }
  const session = await listenWithSystemSpeech({ locale: code, onPartial: o.onPartial, endSilenceMs: CALL_END_OF_SPEECH.silenceMs });
  return { ...session, engine: 'system' };
}
