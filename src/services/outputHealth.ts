/**
 * Is a freshly loaded model actually producing language?
 *
 * Seen on a phone: Gemma 4 12B loaded on the OpenCL GPU, "hi" came back as `<unused19><unused10><unk>...`. The same file
 * on the CPU says "Hello! How can I help you today?" (checked with the llama.cpp bundled in llama.rn), so nothing is
 * wrong with the file, its tokenizer or its chat template: the GPU path computed garbage. A model like that "loads
 * fine" and only shows the problem in the first reply.
 *
 * After an accelerated load of a model that has shown this, `checkAcceleratedOutput` runs one short deterministic
 * reply and looks at it the way llama.cpp sees it: the text, the sampled token ids, and how sure the model was of each
 * (healthy output has a clear winner; broken compute is flat across the whole 262k vocabulary). It records the verdict
 * per model + backend + layer count + llama.rn version, so a bad combination is skipped next time instead of repeated,
 * and a llama.rn upgrade tests it again.
 *
 * Nothing here hides tokens: bad output is a failed load with a report, never a filtered reply.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LlamaContext } from 'llama.rn';
import logger from '../utils/logger';
import { buildThinkingCompletionParams } from './llmHelpers';

const VERDICTS_KEY = 'atlas-gpu-output-verdicts';
const PLACEHOLDER = /<unused\d+>|<unk>|<pad>/gi;
const TEST_PROMPT = 'hi';
const TEST_TOKENS = 12;
const TEST_TIMEOUT_MS = 120_000;
/** A winner this weak, on token after token, is not language: 1/262,144 is what a flat vocabulary gives. */
const FLAT_TOP_PROBABILITY = 0.001;

export interface SampledToken { id?: number; piece: string; topProbability?: number }
export interface OutputCheck {
  ok: boolean;
  /** Why it failed (empty when ok). */
  reason: string;
  text: string;
  tokens: SampledToken[];
  firstTokenMs: number;
  tokensPerSecond: number;
}

export const isGemma4Path = (modelPath: string): boolean => /gemma-?4/i.test(modelPath);

/** Text-level judgement: placeholder tokens (`<unusedN>`, `<unk>`, `<pad>`) standing in for words, or nothing at all. */
export function judgeText(text: string): string {
  const visible = text.replace(/\s+/g, '');
  if (!visible) return 'the model wrote nothing';
  const placeholders = text.match(PLACEHOLDER) ?? [];
  const placeholderChars = placeholders.join('').length;
  if (placeholders.length >= 3 && placeholderChars >= visible.length * 0.5) {
    return `the reply is made of placeholder tokens (${placeholders.length} of them, e.g. ${placeholders.slice(0, 3).join('')}), not words`;
  }
  return '';
}

/** Distribution-level judgement: no clear winner on most tokens means the logits are noise. */
export function judgeConfidence(tokens: SampledToken[]): string {
  const known = tokens.filter((t) => typeof t.topProbability === 'number');
  if (known.length < 5) return '';
  const flat = known.filter((t) => (t.topProbability as number) < FLAT_TOP_PROBABILITY).length;
  return flat >= known.length * 0.8
    ? `the model had no clear choice for ${flat} of ${known.length} tokens (top probability under ${FLAT_TOP_PROBABILITY}), which is what noise looks like`
    : '';
}

/** Runs the short reply and judges it. Never throws: a crash or hang is also a failed check, with its reason. */
export async function runOutputCheck(context: LlamaContext, opts: { isGemma4: boolean; timeoutMs?: number } = { isGemma4: false }): Promise<OutputCheck> {
  const tokens: SampledToken[] = [];
  let text = '';
  const started = Date.now();
  let firstTokenMs = 0;
  const done = (reason: string): OutputCheck => {
    const total = Date.now() - started;
    const generating = Math.max(1, total - firstTokenMs);
    return {
      ok: !reason, reason, text, tokens, firstTokenMs,
      tokensPerSecond: tokens.length > 1 ? Number(((tokens.length - 1) / (generating / 1000)).toFixed(1)) : 0,
    };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = context.completion({
      messages: [{ role: 'user', content: TEST_PROMPT }],
      n_predict: TEST_TOKENS, temperature: 0, top_k: 1,
      // The raw distribution (not the sampler's), so a flat one is visible; one candidate list per token.
      n_probs: 1, post_sampling_probs: false,
      ...buildThinkingCompletionParams(false, opts.isGemma4),
    } as any, (data: any) => {
      if (!data?.token) return;
      if (!firstTokenMs) firstTokenMs = Date.now() - started;
      text += data.token;
      const top = data.completion_probabilities?.[0]?.probs?.[0];
      tokens.push({ piece: data.token, id: typeof top?.tok_id === 'number' ? top.tok_id : undefined, topProbability: typeof top?.prob === 'number' ? top.prob : undefined });
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no complete reply within ${Math.round((opts.timeoutMs ?? TEST_TIMEOUT_MS) / 1000)}s`)), opts.timeoutMs ?? TEST_TIMEOUT_MS);
    });
    const result: any = await Promise.race([work, timeout]);
    if (!text && typeof result?.text === 'string') text = result.text;
  } catch (e: any) {
    try { await context.stopCompletion(); } catch { /* nothing running */ }
    return done(`the test reply failed: ${String(e?.message || e)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return done(judgeText(text) || judgeConfidence(tokens));
}

/** Multi-line report for the log and for "Copy diagnostics": setup, what came back, the token ids. */
export function formatOutputReport(check: OutputCheck, setup: Record<string, string | number | undefined>): string {
  const lines = Object.entries(setup).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `  ${k}: ${v}`);
  const ids = check.tokens.map((t) => `${t.id ?? '?'}${typeof t.topProbability === 'number' ? `(${t.topProbability < 0.001 ? t.topProbability.toExponential(1) : t.topProbability.toFixed(2)})` : ''}`).join(' ');
  return [
    `Output check: ${check.ok ? 'PASSED' : 'FAILED'}${check.reason ? ` - ${check.reason}` : ''}`,
    ...lines,
    `  reply: ${JSON.stringify(check.text.slice(0, 200))}`,
    `  sampled token ids (top probability): ${ids || 'none'}`,
    `  first token: ${check.firstTokenMs} ms, speed: ${check.tokensPerSecond} tok/s`,
  ].join('\n');
}

// ---- Remembering the verdict ------------------------------------------------------------------------------------

export interface VerdictKey { model: string; size: number; backend: string; gpuLayers: number }
export interface Verdict { ok: boolean; reason: string; at: number; build: string }

const llamaRnVersion = (): string => {
  try { return String(require('llama.rn/package.json').version); } catch { return 'unknown'; }
};
const keyOf = (k: VerdictKey) => `${k.model.split('/').pop()}|${k.size}|${k.backend}|${k.gpuLayers}|${llamaRnVersion()}`;

async function readVerdicts(): Promise<Record<string, Verdict>> {
  try { return JSON.parse((await AsyncStorage.getItem(VERDICTS_KEY)) ?? '{}'); } catch { return {}; }
}

export async function recordVerdict(key: VerdictKey, check: Pick<OutputCheck, 'ok' | 'reason'>): Promise<void> {
  try {
    const all = await readVerdicts();
    all[keyOf(key)] = { ok: check.ok, reason: check.reason, at: Date.now(), build: llamaRnVersion() };
    await AsyncStorage.setItem(VERDICTS_KEY, JSON.stringify(all));
  } catch { /* a verdict that is not remembered is simply tested again */ }
}

export async function knownVerdict(key: VerdictKey): Promise<Verdict | null> {
  return (await readVerdicts())[keyOf(key)] ?? null;
}

export async function forgetVerdicts(model?: string): Promise<void> {
  try {
    if (!model) { await AsyncStorage.removeItem(VERDICTS_KEY); return; }
    const all = await readVerdicts();
    const name = model.split('/').pop() as string;
    for (const k of Object.keys(all)) if (k.startsWith(`${name}|`)) delete all[k];
    await AsyncStorage.setItem(VERDICTS_KEY, JSON.stringify(all));
  } catch { /* nothing to forget */ }
}

/**
 * What a failed check means to the person. `explicitChoice` is true when they picked this backend themselves (so it is
 * not quietly replaced); otherwise the loader moves on to the next backend and this text is the logged reason.
 */
const BACKEND_NAMES: Record<string, string> = { opencl: 'OpenCL GPU', htp: 'Hexagon NPU', vulkan: 'Vulkan GPU' };
export function describeBadOutput(backend: string, reason: string, explicitChoice: boolean): string {
  const name = BACKEND_NAMES[backend] ?? `${backend} accelerator`;
  const parts = [`The ${name} gave unusable output for this model (${reason}). The same model file works on the CPU, so this is the accelerated path on this device, not the file.`];
  if (explicitChoice) parts.push('Choose CPU or Automatic for this model, or open Settings > About > Test GPU on this model to see which setting works.');
  return parts.join(' ');
}

export function logOutputReport(check: OutputCheck, setup: Record<string, string | number | undefined>): void {
  const report = formatOutputReport(check, setup);
  if (check.ok) logger.log(`[LLM][OUTPUT-CHECK] ${report}`); else logger.error(`[LLM][OUTPUT-CHECK] ${report}`);
}
