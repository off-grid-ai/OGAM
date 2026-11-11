import { NativeEventEmitter, NativeModules } from 'react-native';
import { create } from 'zustand';
import { useAtlasVoiceStore } from './store';

/**
 * Natural offline voices: neural text-to-speech models downloaded once (from this app's
 * "atlas-voices" release) and run on the phone. Much more human than the phone's built-in voice.
 */
const Native: any = NativeModules.AtlasTts;
const BASE = 'https://github.com/coolchan03/Atlas/releases/download/atlas-voices/';

export interface NeuralSpeaker {
  sid: number; name: string; female: boolean; accent: string;
  /** A tuned variant of another speaker: the model's own speaker id and a depth (1 = as recorded). */
  base?: number; depth?: number;
}
export interface NeuralVoice {
  id: string; name: string; desc: string; size: string; speakers?: NeuralSpeaker[];
  /** Added by the user from a voice file (not from Atlas's own voice list). */
  imported?: boolean;
  /** The package has separate UK and US pronunciation dictionaries (Kokoro v1.0). */
  accents?: boolean;
}

export const KOKORO_SPEAKERS = [
  { sid: 0, name: 'Default', female: true, accent: 'US' },
  { sid: 1, name: 'Bella', female: true, accent: 'US' },
  { sid: 2, name: 'Nicole', female: true, accent: 'US' },
  { sid: 3, name: 'Sarah', female: true, accent: 'US' },
  { sid: 4, name: 'Sky', female: true, accent: 'US' },
  { sid: 5, name: 'Adam', female: false, accent: 'US' },
  { sid: 6, name: 'Michael', female: false, accent: 'US' },
  { sid: 7, name: 'Emma', female: true, accent: 'UK' },
  { sid: 8, name: 'Isabella', female: true, accent: 'UK' },
  { sid: 9, name: 'George', female: false, accent: 'UK' },
  { sid: 10, name: 'Lewis', female: false, accent: 'UK' },
];

/** Variants are numbered from here so saved choices never clash with a model speaker id. */
const VARIANT = 1000;

/**
 * Kokoro v1.0 English speakers (ids in the multi-language package). The favourites come
 * first; "Lewis (deep)" is Lewis played 10% lower, which keeps his pace and deepens the voice.
 */
export const KOKORO_V1_SPEAKERS: NeuralSpeaker[] = [
  { sid: 12, name: 'Echo', female: false, accent: 'US' },
  { sid: 18, name: 'Puck', female: false, accent: 'US' },
  { sid: 25, name: 'Fable', female: false, accent: 'UK' },
  { sid: VARIANT + 27, name: 'Lewis (deep)', female: false, accent: 'UK', base: 27, depth: 0.9 },
  ...([
    [11, 'Adam'], [13, 'Eric'], [14, 'Fenrir'], [15, 'Liam'], [16, 'Michael'], [17, 'Onyx'], [19, 'Santa'],
  ] as const).map(([sid, name]) => ({ sid, name, female: false, accent: 'US' })),
  ...([[24, 'Daniel'], [26, 'George'], [27, 'Lewis']] as const).map(([sid, name]) => ({ sid, name, female: false, accent: 'UK' })),
  ...([
    [0, 'Alloy'], [1, 'Aoede'], [2, 'Bella'], [3, 'Heart'], [4, 'Jessica'], [5, 'Kore'], [6, 'Nicole'], [7, 'Nova'],
    [8, 'River'], [9, 'Sarah'], [10, 'Sky'],
  ] as const).map(([sid, name]) => ({ sid, name, female: true, accent: 'US' })),
  ...([[20, 'Alice'], [21, 'Emma'], [22, 'Isabella'], [23, 'Lily']] as const).map(([sid, name]) => ({ sid, name, female: true, accent: 'UK' })),
];

/** Ready-made voice profiles for Kokoro v1.0 (added from Models -> Voice). */
export const KOKORO_V1_PRESETS = [
  { name: 'Echo', voiceId: 'kokoro-v1-en', sid: 12, rate: 1 },
  { name: 'Puck', voiceId: 'kokoro-v1-en', sid: 18, rate: 1 },
  { name: 'Fable', voiceId: 'kokoro-v1-en', sid: 25, rate: 1 },
  { name: 'Deep British', voiceId: 'kokoro-v1-en', sid: VARIANT + 27, rate: 1 },
];

/**
 * KittenTTS built-in styles. Upstream names alternate male/female, but Atlas does not claim
 * a gender it has not verified for each packaged model: users preview and pick by ear.
 */
export const KITTEN_SPEAKERS = Array.from({ length: 8 }, (_, sid) => ({
  sid, name: `Kitten ${sid + 1}`, female: sid % 2 === 1, accent: 'US',
}));

export const NEURAL_VOICES: NeuralVoice[] = [
  { id: 'kokoro-v1-en', name: 'Kokoro v1.0 (most natural)', desc: 'The newest Kokoro: 28 English voices, US and UK, including Echo, Puck, Fable and a deep British voice. Needs a fast phone.', size: '~132 MB', speakers: KOKORO_V1_SPEAKERS, accents: true },
  { id: 'kokoro-en', name: 'Kokoro (best)', desc: 'Very natural. 11 voices (US and UK, men and women) - podcasts can use several. Needs a fast phone.', size: '~140 MB', speakers: KOKORO_SPEAKERS },
  { id: 'kitten-nano-en', name: 'KittenTTS Nano', desc: 'Tiny and quick: 8 built-in voices in a ~29 MB download. Good on older phones.', size: '~29 MB', speakers: KITTEN_SPEAKERS },
  { id: 'kitten-mini-en', name: 'KittenTTS Mini', desc: 'Richer KittenTTS voice quality: same 8 voices, larger model (~163 MB). Slower than Nano.', size: '~163 MB', speakers: KITTEN_SPEAKERS },
  { id: 'piper-amy', name: 'Amy (Piper)', desc: 'Clear US woman. Fast on any phone.', size: '~65 MB' },
  { id: 'piper-ryan', name: 'Ryan (Piper)', desc: 'US man. Fast on any phone.', size: '~65 MB' },
  { id: 'piper-lessac', name: 'Lessac (Piper)', desc: 'Calm US woman, good for long reading.', size: '~65 MB' },
  { id: 'piper-joe', name: 'Joe (Piper)', desc: 'US man, relaxed.', size: '~65 MB' },
  { id: 'piper-hfc', name: 'HFC (Piper)', desc: 'Bright US woman.', size: '~65 MB' },
];

interface DlState {
  progress: Record<string, number>; installed: Record<string, number>;
  /** Speakers in each voice the engine has loaded (imported voices only show this after loading). */
  speakerCount: Record<string, number>;
  set: (p: Partial<DlState>) => void;
}
export const useNeuralVoices = create<DlState>((set) => ({ progress: {}, installed: {}, speakerCount: {}, set: (p) => set(p) }));

/** "vits-piper-en_GB-northern_english_male-medium" -> "Northern English Male (Piper, en GB)". */
export function importedVoiceName(id: string): string {
  const m = id.match(/^vits-piper-([a-z]{2})_([A-Z]{2})-(.+?)(-(x_low|low|medium|high))?$/);
  const words = (t: string) => t.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  if (m) return `${words(m[3])} (Piper, ${m[1]} ${m[2]})`;
  return words(id.replace(/^(vits-|sherpa-onnx-)/, ''));
}

/** Atlas's own voices followed by voices the user imported from files. */
export function voiceCatalog(installed: Record<string, number>): NeuralVoice[] {
  const imported = Object.keys(installed)
    .filter((id) => !NEURAL_VOICES.some((v) => v.id === id))
    .sort()
    .map((id) => ({ id, name: importedVoiceName(id), desc: 'Imported from a voice file.', size: '', imported: true }));
  return [...NEURAL_VOICES, ...imported];
}

/** A voice from Atlas's list or one the user imported. */
export const findNeuralVoice = (id: string): NeuralVoice | undefined =>
  voiceCatalog(useNeuralVoices.getState().installed).find((v) => v.id === id);

let listening = false;
function listen() {
  if (listening || !Native) return;
  listening = true;
  new NativeEventEmitter(Native).addListener('AtlasVoiceDownload', (e: { id: string; progress: number }) => {
    const s = useNeuralVoices.getState();
    s.set({ progress: { ...s.progress, [e.id]: e.progress } });
  });
}

export const neuralAvailable = () => !!Native?.setNeuralVoice;

export async function refreshInstalled(): Promise<void> {
  if (!neuralAvailable()) return;
  const list: { id: string; bytes: number }[] = await Native.installedNeuralVoices();
  const installed: Record<string, number> = {};
  list.forEach((v) => { installed[v.id] = v.bytes; });
  useNeuralVoices.getState().set({ installed });
}

export async function downloadVoice(id: string): Promise<void> {
  listen();
  const s = useNeuralVoices.getState();
  s.set({ progress: { ...s.progress, [id]: 0 } });
  try {
    await Native.downloadNeuralVoice(id, `${BASE}${id}.zip`);
    await refreshInstalled();
  } finally {
    const p = { ...useNeuralVoices.getState().progress }; delete p[id];
    useNeuralVoices.getState().set({ progress: p });
  }
}

/**
 * Pick a voice file (a sherpa-onnx Piper, Kokoro or KittenTTS .tar.bz2 or .zip) and add it.
 * Resolves the new voice id, or null when nothing was picked.
 */
export async function importVoiceFile(): Promise<string | null> {
  const { pick } = require('@react-native-documents/picker');
  const files = await pick({ mode: 'open', allowMultiSelection: false });
  const f = files?.[0];
  if (!f?.uri) return null;
  const id: string = await Native.importNeuralVoice(f.uri, f.name || 'imported-voice');
  await refreshInstalled();
  return id;
}

export const cancelVoiceDownload = (id: string) => Native?.cancelNeuralDownload?.(id);

export async function deleteVoice(id: string): Promise<void> {
  if (useAtlasVoiceStore.getState().neuralVoice === id) await selectVoice('');
  await Native.deleteNeuralVoice(id);
  await refreshInstalled();
}

/**
 * What the native engine needs for a catalogue choice: the model's own speaker id, the
 * pronunciation dictionary for multi-accent packages and the voice depth.
 */
export function nativeVoice(id: string, sid: number): { sid: number; style: { accent: string; depth: number } } {
  const voice = findNeuralVoice(id);
  const speaker = voice?.speakers?.find((k) => k.sid === sid);
  const accent = voice?.accents ? (speaker?.accent === 'UK' ? 'gb' : 'us') : '';
  return { sid: speaker?.base ?? sid, style: { accent, depth: speaker?.depth ?? 1 } };
}

const setNative = (id: string, sid: number): Promise<number> => {
  const n = nativeVoice(id, sid);
  return Native.setNeuralVoice(id, n.sid, n.style);
};

/** Voice/speaker the native engine currently has loaded (may differ from the saved choice
 *  while an agent's own voice profile is speaking). */
let loadedKey = '';
const keyOf = (id: string, sid: number) => (id ? `${id}#${sid}` : '');

/** Switch the reading voice ('' = phone's own voice). Resolves the number of speakers in the model. */
export async function selectVoice(id: string, sid?: number): Promise<number> {
  const st = useAtlasVoiceStore.getState();
  const s = sid ?? (id === st.neuralVoice ? st.neuralSid : 0);
  const n: number = neuralAvailable() ? await setNative(id, s) : 0;
  loadedKey = keyOf(id, s);
  if (id) useNeuralVoices.getState().set({ speakerCount: { ...useNeuralVoices.getState().speakerCount, [id]: n } });
  st.setNeural(id, s);
  return n;
}

/** Called at start-up: re-load the chosen natural voice (falls back to the phone voice if it is gone). */
export async function restoreVoice(): Promise<void> {
  const st = useAtlasVoiceStore.getState();
  if (!st.neuralVoice || !neuralAvailable()) return;
  try { await setNative(st.neuralVoice, st.neuralSid); loadedKey = keyOf(st.neuralVoice, st.neuralSid); }
  catch { st.setNeural(''); loadedKey = ''; }
}

/**
 * Load a voice for the next utterance WITHOUT changing the saved choice (agent voice
 * profiles). Unchanged voices are not reloaded. A missing voice falls back to the saved one.
 */
export async function loadVoiceForSpeech(id: string, sid: number): Promise<void> {
  if (!neuralAvailable() || keyOf(id, sid) === loadedKey) return;
  try {
    await setNative(id, sid);
    loadedKey = keyOf(id, sid);
  } catch {
    const st = useAtlasVoiceStore.getState();
    if (keyOf(st.neuralVoice, st.neuralSid) !== loadedKey) await restoreVoice();
  }
}

/** Put the saved voice back after an agent's own voice has spoken. */
export async function restoreSavedVoice(): Promise<void> {
  const st = useAtlasVoiceStore.getState();
  await loadVoiceForSpeech(st.neuralVoice, st.neuralSid);
}

/** Voices for podcast hosts: distinct-sounding speakers when the model has many. */
export function hostVoices(available: { name: string }[]): string[] {
  const st = useAtlasVoiceStore.getState();
  const auto = automaticHostVoices(available);
  // The person's own choice per host, where that voice is still on the phone.
  const names = new Set(available.map((v) => v.name));
  return auto.map((v, i) => (st.podcastVoices?.[i] && names.has(st.podcastVoices[i]) ? st.podcastVoices[i] : v));
}

function automaticHostVoices(available: { name: string }[]): string[] {
  const st = useAtlasVoiceStore.getState();
  if (st.neuralVoice === 'kokoro-en' && available.length >= 11) {
    const main = KOKORO_SPEAKERS[st.neuralSid] || KOKORO_SPEAKERS[0];
    const other = KOKORO_SPEAKERS.find((k) => k.female !== main.female && k.accent === main.accent) || KOKORO_SPEAKERS[6];
    const third = KOKORO_SPEAKERS.find((k) => k.accent !== main.accent && k.sid !== main.sid) || KOKORO_SPEAKERS[7];
    return [`sid:${main.sid}`, `sid:${other.sid}`, `sid:${third.sid}`];
  }
  return available.slice(0, 3).map((v) => v.name);
}

/** A readable name for a voice: a Kokoro speaker's name, or the phone voice's language and letter code. */
export function voiceLabel(name: string, index: number): string {
  const sid = name.startsWith('sid:') ? Number(name.slice(4)) : NaN;
  if (Number.isInteger(sid)) {
    const st = useAtlasVoiceStore.getState();
    const k = st.neuralVoice === 'kokoro-en' ? KOKORO_SPEAKERS.find((x) => x.sid === sid) : undefined;
    return k ? `${k.name} (${k.accent})` : `Voice ${sid + 1}`;
  }
  const m = name.match(/^([a-z]{2})[-_]([a-z]{2})[-_]x[-_]([a-z]{3})/i);
  return m ? `${m[2].toUpperCase()} ${m[3].toUpperCase()}` : name.length > 18 ? `Voice ${index + 1}` : name;
}
