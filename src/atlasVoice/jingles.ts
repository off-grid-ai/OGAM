/**
 * The short tunes that open and close the daily briefing. They are made from plain musical notes here (no sound files
 * to ship or license), saved once as small WAV files, and played between the spoken lines. Pure sound-making is kept
 * apart from playing so it is tested without a device.
 */
export type JingleKind = 'intro' | 'outro' | 'chime';

const RATE = 24000;
/** Note names to Hz (equal temperament, A4 = 440). */
const NOTE: Record<string, number> = { C4: 261.63, G4: 392, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5 };

interface Note { hz: number; at: number; len: number; gain: number }
const n = (name: string, [at, len]: [number, number], gain = 1): Note => ({ hz: NOTE[name], at, len, gain });

/** What each jingle plays: a quick rising run then a held chord (intro), a falling run that settles (outro), two soft notes (chime). */
export const SCORES: Record<JingleKind, Note[]> = {
  intro: [
    n('C5', [0, 0.35], 0.7), n('E5', [0.14, 0.35], 0.7), n('G5', [0.28, 0.35], 0.7), n('C6', [0.42, 0.5], 0.8),
    n('C5', [0.62, 1.2]), n('E5', [0.62, 1.2]), n('G5', [0.62, 1.2]), n('C6', [0.62, 1.2], 0.8),
  ],
  outro: [
    n('G5', [0, 0.3], 0.7), n('E5', [0.16, 0.3], 0.7), n('D5', [0.32, 0.3], 0.7),
    n('C4', [0.5, 1.4]), n('G4', [0.5, 1.4]), n('C5', [0.5, 1.4], 0.9),
  ],
  chime: [n('E5', [0, 0.3], 0.8), n('A5', [0.12, 0.4], 0.8)],
};

export const jingleSeconds = (kind: JingleKind): number => Math.max(...SCORES[kind].map((x) => x.at + x.len)) + 0.25;

/** 16-bit mono samples of a jingle. Bell-like: a pure tone with two softer overtones, a quick attack and a smooth fade. */
export function makeJingle(kind: JingleKind, rate = RATE): Int16Array {
  const total = Math.ceil(jingleSeconds(kind) * rate);
  const mix = new Float32Array(total);
  for (const note of SCORES[kind]) {
    const start = Math.floor(note.at * rate);
    const count = Math.floor(note.len * rate);
    for (let i = 0; i < count && start + i < total; i++) {
      const t = i / rate;
      const attack = Math.min(1, t / 0.01);
      const decay = Math.exp(-3 * (i / count)) * (1 - i / count);
      const w = 2 * Math.PI * note.hz * t;
      mix[start + i] += (Math.sin(w) + 0.35 * Math.sin(2 * w) + 0.15 * Math.sin(3 * w)) * attack * decay * note.gain;
    }
  }
  let peak = 0;
  for (const v of mix) peak = Math.max(peak, Math.abs(v));
  const scale = peak > 0 ? 0.55 / peak : 0; // leave headroom: the voices are the main thing
  const out = new Int16Array(total);
  for (let i = 0; i < total; i++) out[i] = Math.round(mix[i] * scale * 32767);
  return out;
}

/** A complete mono 16-bit WAV file. */
export function wavBytes(samples: Int16Array, rate = RATE): Uint8Array {
  const data = samples.length * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + data, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  return bytes;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Base64 text of bytes (react-native-fs writes files from base64). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
      + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)])
      + (c === undefined ? '=' : B64[c & 63]);
  }
  return out;
}
