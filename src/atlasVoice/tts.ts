import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { useAtlasVoiceStore } from './store';
import logger from '../utils/logger';

/**
 * Thin wrapper over the AtlasTts native module (Android's built-in text-to-speech).
 * The phone's own voice engine - no download needed, works offline once the
 * engine's voice data is on the phone.
 */
const Native: any = NativeModules.AtlasTts;
let emitter: NativeEventEmitter | null = null;
let counter = 0;
/** speakAndWait callers waiting for their own utterance to finish. */
const waiters = new Map<string, (ok: boolean) => void>();

export const ttsAvailable = (): boolean => Platform.OS === 'android' && !!Native;

function ensureListeners(): void {
  if (emitter || !ttsAvailable()) return;
  emitter = new NativeEventEmitter(Native);
  emitter.addListener('AtlasTtsStart', () => undefined);
  emitter.addListener('AtlasTtsDone', (e: { utteranceId: string }) => {
    const w = waiters.get(e.utteranceId);
    if (w) { waiters.delete(e.utteranceId); w(true); return; } // podcast / video lines: not a chat reply
    const s = useAtlasVoiceStore.getState();
    if (s.speakingKey === e.utteranceId) {
      s.markDone(); // hands-free mode and podcast playback listen for this
      s.setSpeaking(null);
    }
  });
  emitter.addListener('AtlasTtsNoLanguage', (e: { utteranceId: string }) => {
    noLangHandler?.(e.utteranceId);
  });
  emitter.addListener('AtlasTtsStopped', (e: { utteranceId: string }) => {
    const w = waiters.get(e.utteranceId);
    if (w) { waiters.delete(e.utteranceId); w(false); }
    const s = useAtlasVoiceStore.getState();
    if (s.speakingKey === e.utteranceId) s.setSpeaking(null);
  });
}

export function warmUp(): void {
  if (!ttsAvailable()) return;
  ensureListeners();
  Native.warmUp().catch(() => undefined);
}

/** Speak text. `messageId` lets a speak button know it is the one playing. `rate` overrides the saved speed. */
export function speak(text: string, messageId?: string, rate?: number): void {
  if (!ttsAvailable() || !text.trim()) return;
  ensureListeners();
  const key = `${messageId ?? 'msg'}~${++counter}`;
  const s = useAtlasVoiceStore.getState();
  s.setSpeaking(key, messageId ?? null);
  Native.setRate(rate ?? s.rate).catch(() => undefined);
  Native.speak(text, key).catch((err: unknown) => {
    logger.error('[AtlasTts] speak failed', err);
    // An earlier failed utterance must not clear a newer active one.
    if (useAtlasVoiceStore.getState().speakingKey === key) {
      useAtlasVoiceStore.getState().setSpeaking(null);
    }
  });
}

/**
 * Starts speaking a reply that is still being written (natural voice only). Returns the utterance
 * key, or null when this phone cannot (its own voice engine): the whole reply is spoken at the end then.
 * `started` settles false if the voice refuses, and the speaking state is cleared.
 */
export function beginSpeechStream(messageId: string): { key: string; started: Promise<boolean> } | null {
  if (!ttsAvailable() || !Native.speakStreamStart) return null;
  ensureListeners();
  const key = `${messageId}~${++counter}`;
  const s = useAtlasVoiceStore.getState();
  s.setSpeaking(key, messageId);
  Native.setRate(s.rate).catch(() => undefined);
  const clear = () => { if (useAtlasVoiceStore.getState().speakingKey === key) useAtlasVoiceStore.getState().setSpeaking(null); };
  const started = Native.speakStreamStart(key)
    .then((ok: boolean) => { if (!ok) clear(); return !!ok; })
    .catch(() => { clear(); return false; });
  return { key, started };
}

/** Adds text to the reply being spoken (see beginSpeechStream). */
export function appendSpeechStream(text: string): void {
  if (ttsAvailable() && text.trim()) Native.speakStreamAppend?.(text).catch(() => undefined);
}

/** No more text is coming: the voice finishes what it has and reports done. */
export function endSpeechStream(): void {
  if (ttsAvailable()) Native.speakStreamEnd?.().catch(() => undefined);
}

export function stop(): void {
  if (!ttsAvailable()) return;
  useAtlasVoiceStore.getState().setSpeaking(null);
  Native.stop().catch(() => undefined);
}

/** Play speech through the earpiece (true) or the normal speaker (false). */
export function setEarpieceRoute(on: boolean): void {
  if (!ttsAvailable()) return;
  try { Native.setEarpiece?.(on)?.catch?.(() => undefined); } catch { /* older build */ }
}

/** Keep the screen awake (learning mode). */
export function keepScreenOn(on: boolean): void {
  if (!ttsAvailable()) return;
  Native.keepScreenOn?.(on).catch(() => undefined);
}

/**
 * Lets a feature slow down some of its own spoken lines (the language course's slower-voice option)
 * without this file knowing about the feature: `fn(messageId, rate)` returns the rate to use.
 */
let rateAdjuster: ((messageId: string, rate: number) => number) | null = null;
export function setRateAdjuster(fn: ((messageId: string, rate: number) => number) | null): void { rateAdjuster = fn; }
const adjusted = (messageId: string, rate: number) => (rateAdjuster ? rateAdjuster(messageId, rate) : rate);

/** Speak in another language (BCP-47 like 'es-ES'). Calls onNoLanguage if the phone lacks that voice. */
let noLangHandler: ((lang: string) => void) | null = null;
export function onMissingLanguage(fn: ((lang: string) => void) | null): void { noLangHandler = fn; }
export function speakIn(text: string, lang: string, messageId = 'phrase', voice = ''): void {
  if (!ttsAvailable() || !text.trim()) return;
  ensureListeners();
  Native.setVoice?.(voice).catch(() => undefined);
  const key = `${messageId}~${++counter}`;
  const s = useAtlasVoiceStore.getState();
  s.setSpeaking(key, messageId);
  Native.setRate(adjusted(messageId, Math.min(s.rate, 0.9))).catch(() => undefined);
  (Native.speakIn ? Native.speakIn(text, key, lang) : Native.speak(text, key)).catch(() => {
    if (useAtlasVoiceStore.getState().speakingKey === key) {
      useAtlasVoiceStore.getState().setSpeaking(null);
    }
  });
}

/** Speak and wait until finished (resolves false if stopped). Optional pitch / voice for podcast hosts. */
export function speakAndWait(text: string, pitch = 1.0, messageId = 'podcast', voice = ''): Promise<boolean> {
  return speakWait({ text, pitch, messageId, voice, lang: 'en-US' });
}

/** Speak in a language (e.g. "es-ES") and wait until finished (false if stopped). */
export function speakInAndWait(text: string, lang: string, messageId = 'lesson', voice = ''): Promise<boolean> {
  return speakWait({ text, pitch: 1.0, messageId, voice, lang });
}

function speakWait({ text, pitch, messageId, voice, lang }: { text: string; pitch: number; messageId: string; voice: string; lang: string }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!ttsAvailable() || !text.trim()) { resolve(true); return; }
    ensureListeners();
    Native.setPitch?.(pitch).catch(() => undefined);
    Native.setVoice?.(voice).catch(() => undefined);
    const myKey = `${messageId}~${++counter}`;
    const st = useAtlasVoiceStore.getState();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      waiters.delete(myKey);
      unsub();
      Native.setPitch?.(1.0).catch(() => undefined);
      Native.setVoice?.('').catch(() => undefined);
      if (useAtlasVoiceStore.getState().speakingKey === myKey) useAtlasVoiceStore.getState().setSpeaking(null);
      resolve(ok);
    };
    // stop() (or another speech) takes over the speaking key -> this line was stopped
    const unsub = useAtlasVoiceStore.subscribe((s) => { if (s.speakingKey !== myKey) finish(false); });
    waiters.set(myKey, finish);
    st.setSpeaking(myKey, messageId);
    Native.setRate(adjusted(messageId, st.rate)).catch(() => undefined);
    (Native.speakIn ? Native.speakIn(text, myKey, lang) : Native.speak(text, myKey)).catch(() => finish(false));
  });
}

export interface TtsVoice { name: string; locale: string; quality: number }
/** Installed offline voices for a language (empty if the engine is still starting). */
export async function listVoices(lang = 'en'): Promise<TtsVoice[]> {
  if (!ttsAvailable() || !Native.listVoices) return [];
  ensureListeners();
  try {
    let v: TtsVoice[] = await Native.listVoices(lang);
    if (!v.length) { await new Promise((r) => setTimeout(r, 1200)); v = await Native.listVoices(lang); }
    return v;
  } catch { return []; }
}

/**
 * Save speech as a WAV file with the voice chosen in Settings, without playing it.
 * Used by "Save as video". Resolves the file path; rejects with code CANCELLED when stopped.
 */
export async function synthesizeToFile(text: string, outPath: string, lang = 'en-US'): Promise<string> {
  if (!ttsAvailable() || !Native.synthesizeToFile) throw new Error('Saving speech is not available on this phone.');
  ensureListeners();
  await Native.setRate(useAtlasVoiceStore.getState().rate).catch(() => undefined);
  return Native.synthesizeToFile(text, outPath, lang);
}

/**
 * Save one podcast line in a given host voice as a WAV file, without playing it. The voice
 * is set only for this file and put back afterwards. Resolves the file path.
 */
export async function synthesizeLineToFile(text: string, voice: string, outPath: string, pitch = 1): Promise<string> {
  if (!ttsAvailable() || !Native.synthesizeToFile) throw new Error('Saving speech is not available on this phone.');
  await Native.setVoice?.(voice).catch(() => undefined);
  if (pitch !== 1) await Native.setPitch?.(pitch).catch(() => undefined);
  try { return await synthesizeToFile(text, outPath); } finally {
    await Native.setVoice?.('').catch(() => undefined);
    if (pitch !== 1) await Native.setPitch?.(1).catch(() => undefined);
  }
}

/** True when lines can be saved as audio files ahead of playback. */
export const canPreRender = (): boolean => ttsAvailable() && !!Native.synthesizeToFile;

export function cancelSynthesis(): void {
  if (!ttsAvailable()) return;
  Native.cancelSynthesis?.()?.catch?.(() => undefined);
}
