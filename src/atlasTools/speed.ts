import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../stores/appStore';

/**
 * Remembers how fast each model runs on THIS device (learned from real replies and the model tester),
 * so chat can say "first words in about 6 s" and My models can show a speed.
 * Units are tokens (word-pieces; ~0.75 words each).
 */
export interface ModelSpeed {
  /** writing speed, tokens per second */
  decode: number;
  /** reading speed (prompt processing), tokens per second */
  prefill: number;
  /** typical reply length in tokens */
  outLen: number;
  samples: number;
}

interface SpeedState {
  byModel: Record<string, ModelSpeed>;
  record: (modelId: string, s: { decode?: number; prefill?: number; outLen?: number }) => void;
  forget: (modelId: string) => void;
}

const ema = (old: number, v: number, a: number) => (old > 0 ? old * (1 - a) + v * a : v);
const sane = (v: number | undefined, max: number): v is number => typeof v === 'number' && isFinite(v) && v > 0 && v < max;

export const useSpeedStats = create<SpeedState>()(persist((set) => ({
  byModel: {},
  record: (modelId, s) => set((st) => {
    if (!modelId) return st;
    const cur: ModelSpeed = st.byModel[modelId] ?? { decode: 0, prefill: 0, outLen: 0, samples: 0 };
    const next: ModelSpeed = {
      decode: sane(s.decode, 2000) ? ema(cur.decode, s.decode, 0.35) : cur.decode,
      prefill: sane(s.prefill, 50000) ? ema(cur.prefill, s.prefill, 0.35) : cur.prefill,
      outLen: sane(s.outLen, 32768) && s.outLen >= 16 ? ema(cur.outLen, s.outLen, 0.25) : cur.outLen,
      samples: cur.samples + 1,
    };
    return { byModel: { ...st.byModel, [modelId]: next } };
  }),
  forget: (modelId) => set((st) => {
    const { [modelId]: _drop, ...rest } = st.byModel;
    return { byModel: rest };
  }),
}), {
  name: 'atlas-model-speed',
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s) => ({ byModel: s.byModel }),
}));

/** Models whose settings were tuned with "Find the best settings" (so the slow-reply hint stops suggesting it). */
interface TunedState { at: Record<string, number>; mark: (modelId: string) => void }
export const useTuned = create<TunedState>()(persist((set) => ({
  at: {},
  mark: (modelId) => set((st) => ({ at: { ...st.at, [modelId]: Date.now() } })),
}), { name: 'atlas-tuned-models', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ at: s.at }) }));

/** Models whose slow-reply hint was dismissed. */
interface HintState { off: Record<string, true>; dismiss: (modelId: string) => void }
export const useSlowHint = create<HintState>()(persist((set) => ({
  off: {},
  dismiss: (modelId) => set((st) => ({ off: { ...st.off, [modelId]: true } })),
}), { name: 'atlas-slow-hint', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ off: s.off }) }));

/** Below this writing speed (tokens per second) answers are a real wait. */
export const SLOW_TPS = 3;

/** True when chat should suggest finding better settings: a local model that is slow on at least two replies, not tuned or dismissed yet. */
export function shouldSuggestTuning(o: { modelId: string | null | undefined; speed: ModelSpeed | undefined; tuned: boolean; dismissed: boolean }): boolean {
  const { modelId, speed } = o;
  return !!modelId && !o.tuned && !o.dismissed && !!speed && speed.samples >= 2 && speed.decode > 0 && speed.decode < SLOW_TPS;
}

const THINK_MULT: Record<string, number> = { low: 1.6, medium: 2.5, high: 4 };

/** Record a finished generation for the model that's in use now. Never throws. */
export function recordSpeed(s: { decode?: number; prefill?: number; promptTokens?: number; outLen?: number }): void {
  try {
    const id = useAppStore.getState().activeModelId;
    if (!id) return;
    // Reading speed from a tiny prompt is mostly overhead - only trust real-sized ones.
    const prefill = (s.promptTokens ?? 0) >= 64 ? s.prefill : undefined;
    // Store the length of a plain answer; thinking replies are scaled back down (estimate scales them up again).
    const st = useAppStore.getState().settings as any;
    const mult = st?.thinkingEnabled ? THINK_MULT[st.thinkingLevel || 'medium'] ?? 1 : 1;
    const outLen = s.outLen ? s.outLen / mult : undefined;
    useSpeedStats.getState().record(id, { decode: s.decode, prefill, outLen });
  } catch { /* stats are best-effort */ }
}

/** Rough token count for text (no model needed). */
export const roughTokens = (chars: number) => Math.ceil(chars / 3.6);

export type SpeedHealth = 'unknown' | 'slow' | 'usable' | 'good' | 'very-fast';

/** Human-facing decode-speed bands for on-device chat. They describe usability,
 * not a universal hardware benchmark: larger models naturally land lower. */
export function classifyDecodeSpeed(tps: number | null | undefined): SpeedHealth {
  if (!sane(tps ?? undefined, 2000)) return 'unknown';
  if ((tps as number) < 3) return 'slow';
  if ((tps as number) < 7) return 'usable';
  if ((tps as number) < 20) return 'good';
  return 'very-fast';
}

export function speedHealthLabel(tps: number | null | undefined): string {
  const health = classifyDecodeSpeed(tps);
  if (health === 'slow') return 'slow';
  if (health === 'usable') return 'usable';
  if (health === 'good') return 'good';
  if (health === 'very-fast') return 'very fast';
  return 'unknown';
}

export interface ReplyEstimate { firstWordsSec: number; totalSec: number; outTokens: number; decode: number }

/** Estimate how long a reply takes. promptTokens = NEW text the model must read this turn. */
export function estimateReply(modelId: string | null | undefined, promptTokens: number, thinking?: string | null): ReplyEstimate | null {
  if (!modelId) return null;
  const sp = useSpeedStats.getState().byModel[modelId];
  if (!sp || !sp.decode) return null;
  const prefill = sp.prefill || sp.decode * 8; // typical ratio when reading speed isn't known yet
  const outTokens = Math.round((sp.outLen || 250) * (thinking ? THINK_MULT[thinking] ?? 1 : 1));
  const firstWordsSec = 0.4 + promptTokens / prefill;
  return { firstWordsSec, totalSec: firstWordsSec + outTokens / sp.decode, outTokens, decode: sp.decode };
}

export function fmtSec(s: number): string {
  if (!isFinite(s) || s < 0) return '?';
  if (s < 1.5) return 'a second';
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return r ? `${m} min ${r} s` : `${m} min`;
}
