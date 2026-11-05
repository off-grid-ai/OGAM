/**
 * ONE exercise format for every subject. An exercise is data: what is asked, the answer key, and where in the user's own
 * material it comes from. Answers are checked in code (numbers, dropdown tables, orders, matches); the model only writes the
 * question. Exercises the material does not support are dropped (grounding), and malformed model output never throws.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ExerciseSource { doc: string; page?: number; section?: string; quote: string }
interface Base { id: string; topic?: string; prompt: string; explain?: string; source?: ExerciseSource }
export type TableRow = { label: string; options?: string[]; account?: string; amount?: number; group?: string };
export type Exercise = Base & (
  | { kind: 'mcq'; choices: string[]; answer: number }
  | { kind: 'truefalse'; answer: boolean; why?: string }
  | { kind: 'fill'; answers: string[] }
  | { kind: 'calc'; answer: number; tolerance?: number; unit?: string }
  | { kind: 'order'; items: string[] }
  | { kind: 'match'; pairs: Array<[string, string]> }
  | { kind: 'table'; rows: TableRow[]; totals?: Array<{ name: string; groups: string[]; equals: string[] }> }
  | { kind: 'short'; keyTerms: string[]; minTerms?: number }
  | { kind: 'testlet'; stem: string; items: Exercise[] }
);
export type Response = unknown;
export interface Verdict { correct: boolean; parts?: boolean[]; note?: string }

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9.%$ -]+/g, ' ').replace(/\s+/g, ' ').trim();
const toNum = (v: unknown): number | null => { const n = Number(String(v ?? '').replace(/[$,%\s]/g, '').replace(/^\((.*)\)$/, '-$1')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null; };
const same = (a: number, b: number, tol = 0) => Math.abs(a - b) <= Math.max(tol, 0.005);

/** Checks a response against the key. Never calls a model. */
export function check(ex: Exercise, res: Response): Verdict {
  switch (ex.kind) {
    case 'mcq': return { correct: Number(res) === ex.answer };
    case 'truefalse': return { correct: res === ex.answer || (typeof res === 'string' && (res === 'true') === ex.answer) };
    case 'fill': return { correct: ex.answers.some((a) => norm(a) === norm(res) || (toNum(a) !== null && toNum(a) === toNum(res))) };
    case 'calc': { const n = toNum(res); return { correct: n !== null && same(n, ex.answer, ex.tolerance ?? 0) }; }
    case 'order': { const r = Array.isArray(res) ? res : []; const parts = ex.items.map((it, i) => r[i] === it); return { correct: r.length === ex.items.length && parts.every(Boolean), parts }; }
    case 'match': { const r = (res ?? {}) as Record<string, string>; const parts = ex.pairs.map(([k, v]) => r[k] === v); return { correct: parts.every(Boolean), parts }; }
    case 'short': { const t = norm(res); const hit = ex.keyTerms.filter((k) => t.includes(norm(k))).length; return { correct: hit >= (ex.minTerms ?? ex.keyTerms.length), note: `${hit} of ${ex.keyTerms.length} key terms` }; }
    case 'table': return checkTable(ex, res);
    case 'testlet': { const r = Array.isArray(res) ? res : []; const parts = ex.items.map((it, i) => check(it, r[i]).correct); return { correct: parts.every(Boolean), parts }; }
  }
}

/** A table row is right when the chosen account and the typed amount both match; totals (e.g. assets = liabilities + equity) are then checked from the typed amounts. */
function checkTable(ex: Extract<Exercise, { kind: 'table' }>, res: Response): Verdict {
  const r = (Array.isArray(res) ? res : []) as Array<{ account?: string; amount?: string | number }>;
  const parts = ex.rows.map((row, i) => {
    const got = r[i]; if (!got) return false;
    const accountOk = row.account === undefined || norm(got.account) === norm(row.account);
    const amount = toNum(got.amount);
    return accountOk && (row.amount === undefined || (amount !== null && same(amount, row.amount)));
  });
  const sum = (groups: string[]) => ex.rows.reduce((s, row, i) => (row.group && groups.includes(row.group) ? s + (toNum(r[i]?.amount) ?? 0) : s), 0);
  const failed = (ex.totals ?? []).filter((t) => !same(sum(t.groups), sum(t.equals), 0.01)).map((t) => t.name);
  return { correct: parts.every(Boolean) && failed.length === 0, parts, note: failed.length ? `Does not balance: ${failed.join(', ')}` : undefined };
}

// ---------------------------------------------------------------- generation: parse and ground
const clean = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
export interface SourceChunk { doc: string; page?: number; section?: string; text: string }

/** Pulls a JSON array of exercises out of model text; returns [] for anything unreadable. */
export function readExercises(text: string): unknown[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v : []; } catch { return []; }
}

const isStrs = (v: unknown, min = 1) => Array.isArray(v) && v.length >= min;
const FORMS: Record<string, (x: any) => boolean> = {
  mcq: (x) => isStrs(x.choices, 2) && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < x.choices.length,
  truefalse: (x) => typeof x.answer === 'boolean',
  fill: (x) => isStrs(x.answers),
  calc: (x) => typeof x.answer === 'number' && Number.isFinite(x.answer),
  order: (x) => isStrs(x.items, 2),
  match: (x) => isStrs(x.pairs, 2) && x.pairs.every((p: unknown) => Array.isArray(p) && p.length === 2),
  table: (x) => isStrs(x.rows) && x.rows.every((r: any) => typeof r?.label === 'string'),
  short: (x) => isStrs(x.keyTerms),
  testlet: (x) => typeof x.stem === 'string' && isStrs(x.items) && x.items.every(wellFormed),
};
function wellFormed(x: any): x is Exercise {
  if (!x || typeof x !== 'object' || typeof x.prompt !== 'string' || !x.prompt.trim()) return false;
  return !!FORMS[x.kind]?.(x);
}

/**
 * Keeps only exercises that are well formed AND grounded: the exercise's quote must appear in one of the supplied chunks.
 * The page, section and document are then taken from that chunk, not from what the model claimed. Returns what was dropped
 * and why, so the screen can say "5 questions skipped: not supported by your material".
 */
export function groundExercises(raw: unknown[], chunks: SourceChunk[], topic?: string): { kept: Exercise[]; dropped: Array<{ why: string }> } {
  const kept: Exercise[] = []; const dropped: Array<{ why: string }> = [];
  raw.forEach((x: any, i) => {
    if (!wellFormed(x)) { dropped.push({ why: 'malformed' }); return; }
    const quote = clean(String(x.source?.quote ?? ''));
    const chunk = quote.length >= 12 ? chunks.find((c) => clean(c.text).includes(quote)) : undefined;
    if (!chunk) { dropped.push({ why: 'not supported by the material' }); return; }
    kept.push({ ...x, id: `${Date.now().toString(36)}-${i}-${Math.abs(hash(x.prompt))}`, topic: topic ?? x.topic,
      source: { doc: chunk.doc, page: chunk.page, section: chunk.section, quote: String(x.source?.quote ?? '').trim() } });
  });
  return { kept, dropped };
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// ---------------------------------------------------------------- progress, review and difficulty
export interface Progress { box: number; due: number; attempts: number; correct: number; last?: boolean; saved?: unknown; /** The person's own note on why they got it wrong. */ note?: string }
const DAYS = [0, 1, 2, 4, 8, 16];

const MAX_BANK = 600;
/**
 * Keeps the saved questions from growing without limit (every drill press adds some, and they are all saved on the phone).
 * Over the limit, the oldest questions you already know (last answer right, no note) go first, then the oldest of the rest.
 * The questions just added are never dropped.
 */
export function pruneBank(bank: Record<string, Exercise>, progress: Record<string, Progress>, keep: string[]): { exercises: Record<string, Exercise>; progress?: Record<string, Progress> } {
  const ids = Object.keys(bank);
  if (ids.length <= MAX_BANK) return { exercises: bank };
  const protectedIds = new Set(keep);
  const known = (id: string) => progress[id]?.last === true && !progress[id]?.note;
  const order = ids.filter((id) => !protectedIds.has(id)).sort((a, b) => Number(known(b)) - Number(known(a))); // stable: known first, then insertion order
  const drop = new Set(order.slice(0, ids.length - MAX_BANK));
  const exercises = Object.fromEntries(ids.filter((id) => !drop.has(id)).map((id) => [id, bank[id]]));
  const kept = Object.fromEntries(Object.entries(progress).filter(([id]) => !drop.has(id)));
  return { exercises, progress: kept };
}

interface ExerciseState {
  progress: Record<string, Progress>;
  /** Questions answered per day (YYYY-MM-DD), for the optional streak and daily goal. */
  daily: Record<string, number>;
  goal: { on: boolean; perDay: number };
  setGoal: (g: Partial<{ on: boolean; perDay: number }>) => void;
  setNote: (id: string, note: string) => void;
  exercises: Record<string, Exercise>;
  addSet: (set: Exercise[]) => void;
  record: (id: string, correct: boolean, now?: number) => void;
  /** Unfinished answers survive leaving the screen. */
  saveDraft: (id: string, draft: unknown) => void;
  clearSet: (topic: string) => void;
}
export const useExerciseStore = create<ExerciseState>()(persist((set) => ({
  progress: {}, exercises: {}, daily: {}, goal: { on: false, perDay: 10 },
  setGoal: (g) => set((st) => ({ goal: { ...st.goal, ...g } })),
  setNote: (id, note) => set((st) => ({ progress: { ...st.progress, [id]: { ...(st.progress[id] ?? { box: 0, due: 0, attempts: 0, correct: 0 }), note: note.slice(0, 400) } } })),
  addSet: (s) => set((st) => pruneBank({ ...st.exercises, ...Object.fromEntries(s.map((e) => [e.id, e])) }, st.progress, s.map((e) => e.id))),
  record: (id, correct, now = Date.now()) => set((st) => {
    const p = st.progress[id] ?? { box: 0, due: 0, attempts: 0, correct: 0 };
    const box = correct ? Math.min(DAYS.length - 1, p.box + 1) : 0;
    const day = new Date(now).toISOString().slice(0, 10);
    return { progress: { ...st.progress, [id]: { ...p, box, due: now + DAYS[box] * 86400000, attempts: p.attempts + 1, correct: p.correct + (correct ? 1 : 0), last: correct, saved: undefined } }, daily: { ...st.daily, [day]: (st.daily[day] ?? 0) + 1 } };
  }),
  saveDraft: (id, draft) => set((st) => ({ progress: { ...st.progress, [id]: { ...(st.progress[id] ?? { box: 0, due: 0, attempts: 0, correct: 0 }), saved: draft } } })),
  clearSet: (topic) => set((st) => {
    const ids = Object.values(st.exercises).filter((e) => e.topic === topic).map((e) => e.id);
    const exercises = { ...st.exercises }; const progress = { ...st.progress };
    ids.forEach((i) => { delete exercises[i]; delete progress[i]; });
    return { exercises, progress };
  }),
}), { name: 'atlas-exercises', storage: createJSONStorage(() => AsyncStorage) }));

/** A practice set: due and missed first, then unseen, then the rest; optional topic filter. Harder boxes come after easier ones. */
export function practiceSet(exercises: Exercise[], progress: Record<string, Progress>, opts: { topic?: string; count?: number; now?: number } = {}): Exercise[] {
  const now = opts.now ?? Date.now();
  const pool = exercises.filter((e) => !opts.topic || e.topic === opts.topic);
  const rank = (e: Exercise) => { const p = progress[e.id]; if (!p) return 1; if (p.last === false || p.due <= now) return 0; return 2 + p.box; };
  return [...pool].sort((a, b) => rank(a) - rank(b)).slice(0, opts.count ?? 10);
}

/** Share right per topic, from recorded attempts: shows which topics are weak. */
export function topicScores(exercises: Exercise[], progress: Record<string, Progress>): Array<{ topic: string; attempts: number; percent: number }> {
  const by = new Map<string, { a: number; c: number }>();
  for (const e of exercises) { const p = progress[e.id]; if (!p?.attempts) continue; const t = e.topic ?? 'General'; const cur = by.get(t) ?? { a: 0, c: 0 }; by.set(t, { a: cur.a + p.attempts, c: cur.c + p.correct }); }
  return [...by].map(([topic, v]) => ({ topic, attempts: v.a, percent: Math.round((v.c / v.a) * 100) })).sort((a, b) => a.percent - b.percent);
}

/** The prompt the model gets to write exercises. The model writes; check() decides what is right. */
export function exercisePrompt(chunks: SourceChunk[], kinds: Exercise['kind'][], count: number): string {
  const material = chunks.map((c, i) => `[${i + 1}] (${c.doc}${c.page ? `, p. ${c.page}` : ''}${c.section ? `, ${c.section}` : ''})\n${c.text}`).join('\n\n');
  return `Write ${count} study exercises using ONLY this material. Output a JSON array and nothing else. Each exercise: {"kind":one of ${kinds.join('|')},"prompt":string,"explain":string,"source":{"quote":"an exact sentence copied from the material"}} plus the fields for its kind:
mcq: choices[], answer (index). truefalse: answer (boolean). fill: answers[]. calc: answer (number), tolerance, unit. order: items[] in the correct order. match: pairs [[term,definition],...]. table: rows [{label,options[] (account choices),account,amount,group}] and optional totals [{name,groups[],equals[]}]. short: keyTerms[]. testlet: stem, items[] (exercises).
Never invent facts, numbers or quotes that are not in the material. If the material does not support a question, leave it out.

MATERIAL:
${material}`;
}

/** The right answer in words, for a flashcard back. */
export function answerText(ex: Exercise): string {
  switch (ex.kind) {
    case 'mcq': return ex.choices[ex.answer];
    case 'truefalse': return `${ex.answer ? 'True' : 'False'}${ex.why ? `. ${ex.why}` : ''}`;
    case 'fill': return ex.answers[0];
    case 'calc': return `${ex.answer}${ex.unit ? ` ${ex.unit}` : ''}`;
    case 'order': return ex.items.join(' > ');
    case 'match': return ex.pairs.map(([a, b]) => `${a} = ${b}`).join('; ');
    case 'short': return ex.keyTerms.join(', ');
    case 'table': return ex.rows.map((r) => `${r.account ?? r.label}${r.amount !== undefined ? `: ${r.amount}` : ''}`).join('; ');
    case 'testlet': return ex.items.map((i, n) => `${n + 1}. ${answerText(i)}`).join('  ');
  }
}

/** Days in a row, ending today or yesterday, with at least `perDay` questions answered. */
export function streak(daily: Record<string, number>, today: string, perDay: number): number {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  let t = Date.parse(`${today}T00:00:00Z`);
  if ((daily[day(t)] ?? 0) < perDay) t -= 86400000; // today may still be in progress
  let n = 0;
  while ((daily[day(t)] ?? 0) >= perDay) { n++; t -= 86400000; }
  return n;
}

/** Missed questions (last attempt wrong), most recent first by due date, for the flashcards. */
export const missedExercises = (exercises: Exercise[], progress: Record<string, Progress>): Exercise[] => exercises.filter((e) => progress[e.id]?.last === false);
