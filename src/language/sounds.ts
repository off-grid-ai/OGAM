/**
 * Short right / wrong sounds for the language games, played as tones (no sound files): a
 * bright rising chime when right, a soft low buzz when wrong. Can be turned off on the board.
 */
import { useLanguage } from './store';

let ctx: any = null;

function tone([freq, start, length]: [number, number, number], type: 'sine' | 'triangle'): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

export function playFeedback(right: boolean): void {
  if (!useLanguage.getState().sounds) return;
  try {
    if (!ctx) {
      const { AudioContext } = require('react-native-audio-api');
      ctx = new AudioContext();
    }
    const t = ctx.currentTime ?? 0;
    if (right) { tone([660, t, 0.12], 'sine'); tone([990, t + 0.1, 0.18], 'sine'); }
    else { tone([196, t, 0.18], 'triangle'); tone([156, t + 0.15, 0.25], 'triangle'); }
  } catch { /* no audio output (or tests): stay silent */ }
}
