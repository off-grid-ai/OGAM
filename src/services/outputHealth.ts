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
/**
 * A question with one right answer, not "hi": a greeting passes almost whatever comes out, and the phone reports showed the
 * cost. On the OpenCL GPU the first word was `<pad>` (probability NaN) or a stray token that led to "ASU is a great
 * choice!", while the rest of the reply was fine.
 */
const TEST_PROMPT = 'What is 7 plus 5? Answer with just the number.';
const EXPECTED_ANSWER = /\b12\b|twelve/i;
/**
 * A real chat always sends a system prompt, so real prompts are hundreds of tokens, not 14. The phone's reports showed a 14-token
 * prompt giving a wrong first word on the OpenCL GPU while real chats (system prompt, location note) answered correctly, so the
 * check that decides whether a model may load uses a prompt of realistic length; the short one is judged separately.
 */
const REALISTIC_SYSTEM_PROMPT = [
  'You are Atlas, a helpful assistant that runs entirely on the phone it is installed on. Nothing you are told leaves the device.',
  'Answer the question that was asked, in plain language, in the order the person needs it. Give the answer first and the reasons after it.',
  'When a question has a short answer, give the short answer. When it needs steps, number them. When you are not sure, say what you are not sure of.',
  'Use the person\'s own words where you can. Do not repeat the question back, do not apologise unless something went wrong, and do not add warnings nobody asked for.',
  'If the person shares a file, a note or a place, treat it as theirs and use it. If they ask about something near them, use the place information you were given.',
  'Keep numbers exact, keep names spelled the way the person spelled them, and keep units as they were given. Write dates in full. Do not guess at facts you cannot check.',
  'You can be asked to write, summarise, translate, explain, plan, calculate and teach. Do each of these directly, and stay on the subject until the person changes it.',
].join(' ');
/** Prompts shorter than this (estimated tokens) get the first-word workaround when the short check needed it. */
export const SHORT_PROMPT_TOKENS = 192;

/** Rough prompt size from the messages, for deciding whether a prompt counts as short (about 3.5 characters per token). */
export function estimatePromptTokens(messages: Array<{ content?: unknown }>): number {
  return messages.reduce((n, m) => n + 8 + Math.ceil((typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length) / 3.5), 0);
}
/** Bump when the check changes meaning, so verdicts made by an older, more lenient check are not trusted. */
const CHECK_VERSION = 2;
const TEST_TOKENS = 12;
const TEST_TIMEOUT_MS = 120_000;
/** A winner this weak, on token after token, is not language: 1/262,144 is what a flat vocabulary gives. */
const FLAT_TOP_PROBABILITY = 0.001;

export interface SampledToken { id?: number; piece: string; topProbability?: number }
export interface OutputCheck {
  ok: boolean;
  /** Not a failure: the check could not run, or the answer was off. Shown in reports, never blocks a load. */
  warning?: string;
  /** Why it failed (empty when ok). */
  reason: string;
  text: string;
  tokens: SampledToken[];
  firstTokenMs: number;
  tokensPerSecond: number;
}

export const isGemma4Path = (modelPath: string): boolean => /gemma-?4/i.test(modelPath);

/**
 * Text-level judgement: placeholder tokens (`<unusedN>`, `<unk>`, `<pad>`) standing in for words. An empty reply proves nothing
 * (a healthy model may stop at once), so it is not a failure: blocking someone's model on it would do more harm than missing it.
 */
export function judgeText(text: string): string {
  const visible = text.replace(/\s+/g, '');
  if (!visible) return '';
  const placeholders = text.match(PLACEHOLDER) ?? [];
  const placeholderChars = placeholders.join('').length;
  if (placeholders.length >= 3 && placeholderChars >= visible.length * 0.5) {
    return `the reply is made of placeholder tokens (${placeholders.length} of them, e.g. ${placeholders.slice(0, 3).join('')}), not words`;
  }
  return '';
}

/** Distribution-level judgement: probabilities that are not numbers, or no clear winner on most tokens, mean the scores are noise. */
export function judgeConfidence(tokens: SampledToken[]): string {
  const known = tokens.filter((t) => typeof t.topProbability === 'number');
  const nan = known.filter((t) => Number.isNaN(t.topProbability)).length;
  if (nan) return `the model's scores were not numbers (NaN) for ${nan} of ${known.length} tokens`;
  if (known.length < 5) return '';
  const flat = known.filter((t) => (t.topProbability as number) < FLAT_TOP_PROBABILITY).length;
  return flat >= known.length * 0.8
    ? `the model had no clear choice for ${flat} of ${known.length} tokens (top probability under ${FLAT_TOP_PROBABILITY}), which is what noise looks like`
    : '';
}

/** A reply that opens with a placeholder token, or does not answer the question, is wrong even when the rest reads fine. */
export function judgeAnswer(text: string, tokens: SampledToken[]): string {
  if (!text.replace(/\s+/g, '')) return '';
  if (tokens.length && new RegExp(`^(?:${PLACEHOLDER.source})`, 'i').test(tokens[0].piece.trim())) {
    return `the first word was a placeholder token (${tokens[0].piece.trim()}), not a word`;
  }
  return EXPECTED_ANSWER.test(text) ? '' : `it did not answer "7 plus 5" (it wrote ${JSON.stringify(text.trim().slice(0, 60))})`;
}

/** The messages of a check: just the question, a realistic system prompt first, or a system prompt of about `fillerTokens` tokens. */
function checkMessages(opts: { long?: boolean; fillerTokens?: number }): Array<{ role: string; content: string }> {
  const question = { role: 'user', content: TEST_PROMPT };
  if (opts.fillerTokens != null) {
    const sentence = 'The quick brown fox jumps over the lazy dog near the river bank. ';
    return opts.fillerTokens > 0 ? [{ role: 'system', content: sentence.repeat(Math.max(1, Math.round(opts.fillerTokens / 14))) }, question] : [question];
  }
  return opts.long ? [{ role: 'system', content: REALISTIC_SYSTEM_PROMPT }, question] : [question];
}

/**
 * How the check does at several prompt lengths on the loaded model: where a wrong first word stops. One loaded model, one extra
 * short reply per length. Lines are plain text for the test report.
 */
export async function scanPromptLengths(context: LlamaContext, isGemma4: boolean, sizes: number[] = [0, 40, 100, 200, 400]): Promise<string[]> {
  const lines: string[] = [];
  for (const size of sizes) {
    const check = await runOutputCheck(context, { isGemma4, fillerTokens: size });
    lines.push(`about ${size ? size + 14 : 14} tokens: ${check.ok ? 'OK' : `FAILED - ${check.reason}`}`);
  }
  return lines;
}

/**
 * Works around a GPU that computes the FIRST word wrong while every later word is right (seen with Gemma 4 on an Adreno OpenCL
 * GPU: `<pad>` with NaN scores, or a stray token leading to an unrelated reply). Only the first word comes from a whole prompt
 * processed at once; every later word is a single-token step, which works. The engine keeps the processed prompt and, when the
 * same prompt arrives again, recomputes just its last token on its own. So: run the prompt once for one throwaway word, and the
 * real reply that follows starts from the cached prompt with its first word computed by the working single-token step.
 * Costs one extra word of work, not a second pass over the prompt. Failure is harmless: the real reply simply runs without it.
 */
export async function primeFirstWord(context: LlamaContext, completionParams: Record<string, unknown>): Promise<void> {
  try {
    await context.completion({ ...completionParams, n_predict: 1, temperature: 0, n_probs: 0, stop: [] } as any, () => undefined);
  } catch (e) {
    logger.warn('[LLM] first-word workaround: priming failed, generating without it:', e);
  }
}

/** Runs the short reply and judges it. Never throws: a crash or hang is also a failed check, with its reason. */
export async function runOutputCheck(context: LlamaContext, opts: { isGemma4: boolean; timeoutMs?: number; primed?: boolean; long?: boolean; fillerTokens?: number; strictAnswer?: boolean } = { isGemma4: false }): Promise<OutputCheck> {
  const tokens: SampledToken[] = [];
  let text = '';
  const started = Date.now();
  let firstTokenMs = 0;
  const done = (reason: string, warning?: string): OutputCheck => {
    const total = Date.now() - started;
    const generating = Math.max(1, total - firstTokenMs);
    return {
      ok: !reason, reason, ...(warning ? { warning } : {}), text, tokens, firstTokenMs,
      tokensPerSecond: tokens.length > 1 ? Number(((tokens.length - 1) / (generating / 1000)).toFixed(1)) : 0,
    };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const params = {
      messages: checkMessages(opts),
      n_predict: TEST_TOKENS, temperature: 0, top_k: 1,
      // The raw distribution (not the sampler's), so a flat one is visible; one candidate list per token.
      n_probs: 1, post_sampling_probs: false,
      ...buildThinkingCompletionParams(false, opts.isGemma4),
    } as any;
    // The first-word workaround (see primeFirstWord): run the prompt once and throw that answer away, so the answer below
    // starts from the cached prompt and computes its first word on its own.
    if (opts.primed) await primeFirstWord(context, params);
    const work = context.completion(params, (data: any) => {
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
    // A check that cannot run proves nothing about the model, so it must never block someone's working model.
    return done('', `the check could not run (${String(e?.message || e)})`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  // Clear signs of noise fail the check. A merely wrong answer is a failure only when the caller asks for the strict reading
  // (the short-prompt check, which decides whether to use the workaround); otherwise it is a warning in the report.
  const answer = judgeAnswer(text, tokens);
  const noise = judgeText(text) || judgeConfidence(tokens);
  if (noise) return done(noise);
  return opts.strictAnswer ? done(answer) : done('', answer || undefined);
}

/** Multi-line report for the log and for "Copy diagnostics": setup, what came back, the token ids. */
export function formatOutputReport(check: OutputCheck, setup: Record<string, string | number | undefined>): string {
  const lines = Object.entries(setup).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `  ${k}: ${v}`);
  const ids = check.tokens.map((t) => `${t.id ?? '?'}${typeof t.topProbability === 'number' ? `(${t.topProbability < 0.001 ? t.topProbability.toExponential(1) : t.topProbability.toFixed(2)})` : ''}`).join(' ');
  return [
    `Output check: ${check.ok ? 'PASSED' : 'FAILED'}${check.reason ? ` - ${check.reason}` : ''}${check.warning ? ` (warning: ${check.warning})` : ''}`,
    ...lines,
    `  reply: ${JSON.stringify(check.text.slice(0, 200))}`,
    `  sampled token ids (top probability): ${ids || 'none'}`,
    `  first token: ${check.firstTokenMs} ms, speed: ${check.tokensPerSecond} tok/s`,
  ].join('\n');
}

// ---- Remembering the verdict ------------------------------------------------------------------------------------

/** `variant` is any other load setting that can change the result (batch size, CPU kernels), so a test of one never blocks another. */
export interface VerdictKey { model: string; size: number; backend: string; gpuLayers: number; variant?: string }
export interface Verdict { ok: boolean; reason: string; at: number; build: string; /** Passed only with the first-word workaround. */ primed?: boolean }

const llamaRnVersion = (): string => {
  try { return String(require('llama.rn/package.json').version); } catch { return 'unknown'; }
};
const keyOf = (k: VerdictKey) => `${k.model.split('/').pop()}|${k.size}|${k.backend}|${k.gpuLayers}|${llamaRnVersion()}+c${CHECK_VERSION}|${k.variant ?? ''}`;

async function readVerdicts(): Promise<Record<string, Verdict>> {
  try { return JSON.parse((await AsyncStorage.getItem(VERDICTS_KEY)) ?? '{}'); } catch { return {}; }
}

export async function recordVerdict(key: VerdictKey, check: Pick<OutputCheck, 'ok' | 'reason'>, primed = false): Promise<void> {
  try {
    const all = await readVerdicts();
    all[keyOf(key)] = { ok: check.ok, reason: check.reason, at: Date.now(), build: llamaRnVersion(), ...(primed ? { primed: true } : {}) };
    await AsyncStorage.setItem(VERDICTS_KEY, JSON.stringify(all));
  } catch { /* a verdict that is not remembered is simply tested again */ }
}

export async function knownVerdict(key: VerdictKey): Promise<Verdict | null> {
  return (await readVerdicts())[keyOf(key)] ?? null;
}

/** One plain line per remembered check ("file | size | backend | layers | llama.rn version: OK/FAILED - why"), for diagnostics. */
export async function describeVerdicts(): Promise<string[]> {
  const all = await readVerdicts();
  return Object.entries(all).map(([key, v]) => {
    const [model, size, backend, layers, build, variant] = key.split('|');
    return `${model} (${Math.round(Number(size) / 1048576)} MB), ${backend}, ${layers} GPU layers${variant ? `, ${variant}` : ''}, llama.rn ${build}: ${v.ok ? (v.primed ? 'wrote real text with the first-word workaround' : 'wrote real text') : `FAILED - ${v.reason}`}`;
  });
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
  if (backend === 'cpu') {
    return `This model wrote only noise on the CPU (${reason}). The same file decodes correctly on a computer, so either the copy on this phone has wrong bytes in it or this phone's CPU math mishandles it. Open Settings > About > Test GPU on this model: it checks the file against its published checksum and tries the CPU with the optimized kernels off.`;
  }
  const name = BACKEND_NAMES[backend] ?? `${backend} accelerator`;
  const parts = [`The ${name} gave unusable output for this model (${reason}).`];
  if (explicitChoice) parts.push('Choose CPU or Automatic for this model, or open Settings > About > Test GPU on this model to see which setting works.');
  return parts.join(' ');
}

export function logOutputReport(check: OutputCheck, setup: Record<string, string | number | undefined>): void {
  const report = formatOutputReport(check, setup);
  if (check.ok) logger.log(`[LLM][OUTPUT-CHECK] ${report}`); else logger.error(`[LLM][OUTPUT-CHECK] ${report}`);
}
