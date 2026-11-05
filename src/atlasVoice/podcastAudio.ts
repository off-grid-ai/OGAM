/**
 * Podcast and briefing playback from pre-rendered audio. Each line is saved as a small WAV
 * in its host's voice ahead of time (a whole briefing right after it is written, and always
 * a few lines ahead of what is playing), then played from the file. Speaking each line live
 * meant the voice engine generated it only when its turn came: a wait before the first line
 * and a gap between lines. Falls back to live speech for a line that cannot be rendered.
 */
import RNFS from 'react-native-fs';
import { sha256 } from 'js-sha256';
import { audioSessionManager } from '../services/audioSessionManager';
import { canPreRender, speakAndWait, synthesizeLineToFile } from './tts';
import { hostVoices } from './neural';
import { useAtlasVoiceStore } from './store';
import logger from '../utils/logger';

export interface CastLine { text: string; pitch: number; voice?: string }

const AHEAD = 3;
/** Episodes whose audio is kept; older ones are deleted (they can be rendered again). */
const KEEP_EPISODES = 6;
const root = () => `${RNFS.CachesDirectoryPath}/podcast-audio`;
const dir = (key: string) => `${root()}/${key.replace(/[^\w-]/g, '_')}`;
const pathFor = (key: string, i: number, line: CastLine) => {
  const { neuralVoice, rate } = useAtlasVoiceStore.getState();
  // A different downloaded TTS model can use identical speaker names with different audio.
  return `${dir(key)}/${i}-${sha256(`${neuralVoice || 'system'}|${line.voice ?? ''}|${line.voice ? 1 : line.pitch}|${rate}|${line.text}`).slice(0, 12)}.wav`;
};

/** The voice and pitch for each host: chosen or automatic voices, or pitch alone with one voice. */
export function castLine(host: string, hosts: number, voices: { name: string }[]): { voice: string; pitch: number } {
  const i = host === 'A' ? 0 : host === 'B' ? 1 : 2;
  if (voices.length >= 2) { const names = hostVoices(voices); return { voice: names[i % names.length], pitch: 1 }; }
  return { voice: '', pitch: hosts === 1 ? 1 : [1.12, 0.86, 1.0][i] };
}

/** Every line is saved ahead (a cast told apart only by pitch is saved with each host's pitch), so nothing is spoken live and no line waits. */
const renderable = (_items: CastLine[]) => canPreRender();

/** A single voice engine is shared by all episodes. Playback takes priority over background rendering. */
type RenderJob = { path: string; run: () => Promise<string | null>; resolve: (path: string | null) => void };
const queued: RenderJob[] = [];
const pending = new Map<string, Promise<string | null>>();
let rendering = false;

function pump(): void {
  if (rendering) return;
  const next = queued.shift();
  if (!next) return;
  rendering = true;
  void next.run().then(next.resolve, () => next.resolve(null)).finally(() => {
    pending.delete(next.path);
    rendering = false;
    pump();
  });
}

function prioritize(path: string): void {
  const index = queued.findIndex((job) => job.path === path);
  if (index > 0) queued.unshift(...queued.splice(index, 1));
}

/** Render once per file, moving requested playback ahead of queued background work. */
function render(key: string, items: CastLine[], i: number, urgent = false): Promise<string | null> {
  const path = pathFor(key, i, items[i]);
  const known = pending.get(path);
  if (known) {
    if (urgent) prioritize(path);
    return known;
  }
  let finish!: (result: string | null) => void;
  const result = new Promise<string | null>((resolve) => { finish = resolve; });
  pending.set(path, result);
  const job: RenderJob = {
    path,
    resolve: finish,
    run: async () => {
      try {
        if (await RNFS.exists(path)) return path;
        await RNFS.mkdir(dir(key));
        return await synthesizeLineToFile(items[i].text, items[i].voice ?? '', path, items[i].voice ? 1 : items[i].pitch);
      } catch (e: any) {
        logger.warn(`[POD] could not render line ${i}: ${e?.message ?? e}`);
        return null;
      }
    },
  };
  if (urgent) queued.unshift(job); else queued.push(job);
  pump();
  return result;
}

/** Deletes the audio of all but the newest episodes, so the cache does not grow forever. */
export async function pruneEpisodes(keepKey: string): Promise<void> {
  try {
    const dirs = (await RNFS.readDir(root())).filter((d) =>
      d.isDirectory() && d.path !== dir(keepKey) &&
      ![...pending.keys()].some((path) => path.startsWith(`${d.path}/`)));
    const newest = dirs.sort((a, b) => (b.mtime?.getTime() ?? 0) - (a.mtime?.getTime() ?? 0));
    for (const d of newest.slice(KEEP_EPISODES - 1)) {
      for (const p of [...pending.keys()]) if (p.startsWith(`${d.path}/`)) pending.delete(p);
      await RNFS.unlink(d.path);
    }
  } catch { /* nothing cached yet */ }
}

/** Renders a whole episode in the background (right after a briefing is written). */
export function preRenderEpisode(key: string, items: CastLine[]): void {
  if (!renderable(items)) return;
  pruneEpisodes(key).catch(() => undefined);
  items.forEach((_, i) => { render(key, items, i).catch(() => undefined); });
}

let sessionReady = false;
let ctx: any = null;
let source: any = null;
let stopToken = 0;
let settleCurrent: ((result: PlayResult) => void) | null = null;
/** Decoded audio by file, so the next line is ready to start the moment the current one ends. */
const decoded = new Map<string, Promise<any>>();

function audioContext(): any {
  if (!ctx) { const { AudioContext } = require('react-native-audio-api'); ctx = new AudioContext(); }
  return ctx;
}

function decode(path: string): Promise<any> {
  let d = decoded.get(path);
  if (!d) {
    d = Promise.resolve(audioContext().decodeAudioData(path));
    decoded.set(path, d);
    d.catch(() => decoded.delete(path)); // a file that cannot be decoded is tried again, and fails for real, when played
    if (decoded.size > 6) decoded.delete(decoded.keys().next().value as string);
  }
  return d;
}

/**
 * Where the speech starts and ends in a rendered line: voices leave a quarter second or more of silence at the start and
 * end of every file, which made a gap between each line. Returns seconds (offset, and how long to play).
 */
export function speechSpan(samples: ArrayLike<number>, sampleRate: number): { offset: number; duration: number } {
  const total = samples.length / sampleRate;
  const quiet = 0.01;
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) < quiet) first++;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) < quiet) last--;
  if (first >= last) return { offset: 0, duration: total };
  const offset = Math.max(0, first / sampleRate - 0.03);
  const end = Math.min(total, last / sampleRate + 0.08);
  return { offset, duration: Math.max(0.05, end - offset) };
}

/** 'ended' (played through), 'stopped' (the listener stopped it) or 'failed' (the file could not be played). */
type PlayResult = 'ended' | 'stopped' | 'failed';

function playFile(path: string): Promise<PlayResult> {
  const token = stopToken;
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: PlayResult) => {
      if (finished) return;
      finished = true;
      if (settleCurrent === finish) settleCurrent = null;
      resolve(result);
    };
    (async () => {
      // Playback-session setup happens once per listening session, not every 20 seconds.
      if (!sessionReady) { await audioSessionManager.ensurePlayback(); sessionReady = true; }
      const buffer = await decode(path);
      decoded.delete(path);
      if (token !== stopToken) { finish('stopped'); return; }
      const node = audioContext().createBufferSource();
      node.buffer = buffer;
      node.connect(audioContext().destination);
      node.onEnded = () => { if (source === node) source = null; finish(token === stopToken ? 'ended' : 'stopped'); };
      source = node;
      settleCurrent = finish;
      let span = { offset: 0, duration: buffer.duration as number };
      try { span = speechSpan(buffer.getChannelData(0), buffer.sampleRate); } catch { /* play the whole file */ }
      node.start(0, span.offset, span.duration);
    })().catch((e) => { logger.warn(`[POD] playback failed: ${e?.message ?? e}`); finish(token === stopToken ? 'failed' : 'stopped'); });
  });
}

/**
 * Plays line i of an episode: from its saved file when possible (rendering the next lines
 * meanwhile), otherwise spoken live. Resolves false when stopped.
 */
export async function playLine(key: string, items: CastLine[], i: number): Promise<boolean> {
  const line = items[i];
  if (!renderable(items)) return speakAndWait(line.text, line.pitch, 'podcast', line.voice || '');
  const token = stopToken;
  // This line first, then the next few behind it, so it never waits for the others.
  // Queue the next lines in reverse priority order, then put this line first.
  for (let k = Math.min(items.length - 1, i + AHEAD); k > i; k--) render(key, items, k, true).catch(() => undefined);
  const current = render(key, items, i, true);
  // And the next line is decoded now, while this one plays, so the gap between lines is not a decode.
  if (i + 1 < items.length) render(key, items, i + 1).then((next) => { if (next) decode(next).catch(() => undefined); }).catch(() => undefined);
  const path = await current;
  if (token !== stopToken) return false;
  if (!path) return speakAndWait(line.text, line.pitch, 'podcast', line.voice || '');
  // A saved file the system could not play (cleared from the cache, cut short): forget it and say the
  // line live instead of ending the whole podcast.
  const result = await playFile(path);
  if (result === 'failed' && token === stopToken) {
    pending.delete(path);
    await RNFS.unlink(path).catch(() => undefined);
    return speakAndWait(line.text, line.pitch, 'podcast', line.voice || '');
  }
  return result === 'ended' && token === stopToken;
}

/** Stops whatever podcast line is playing from a file. */
export function stopPodcastAudio(): void {
  stopToken++;
  sessionReady = false; // restore the session on the next play after an interruption
  const settle = settleCurrent;
  settleCurrent = null;
  try { source?.stop(); } catch { /* already stopped */ }
  source = null;
  settle?.('stopped'); // some audio backends never fire onEnded after stop
}
