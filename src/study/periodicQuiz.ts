/** "Tap the element" questions for the periodic-table square. Made in code from the element data, so every answer is exactly one element. */
import { ELEMENTS, type Element } from './science';

export interface PeriodicQuestion { prompt: string; answer: string; explain: string }

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const describe = (e: Element) => `${e.name} (${e.symbol}), atomic number ${e.number}, ${e.group === null ? 'f-block' : `group ${e.group}`}, period ${e.period}, ${e.category}`;
const COMMON = ELEMENTS.filter((e) => e.number <= 56 || [74, 78, 79, 80, 82, 92].includes(e.number)); // the ones a first course meets

/** Question kinds, each with exactly one right element. */
const MAKERS: Array<(e: Element, all: Element[]) => PeriodicQuestion | null> = [
  (e) => ({ prompt: `Tap the element with the symbol ${e.symbol}.`, answer: e.symbol, explain: describe(e) }),
  (e) => ({ prompt: `Tap the element with atomic number ${e.number}.`, answer: e.symbol, explain: describe(e) }),
  (e) => ({ prompt: `Tap ${e.name}.`, answer: e.symbol, explain: describe(e) }),
  (e, all) => (e.group !== null && all.filter((x) => x.group === e.group && x.period === e.period).length === 1 ? { prompt: `Tap the element in group ${e.group}, period ${e.period}.`, answer: e.symbol, explain: describe(e) } : null),
  (e, all) => (['alkali metal', 'alkaline earth metal', 'noble gas', 'halogen', 'metalloid'].includes(e.category) && all.filter((x) => x.category === e.category && x.period === e.period).length === 1
    ? { prompt: `Tap the ${e.category} in period ${e.period}.`, answer: e.symbol, explain: describe(e) } : null),
];

export function makePeriodicQuestions(seed: number, count = 8): PeriodicQuestion[] {
  const r = rng(seed * 2654435761 + 17);
  const out: PeriodicQuestion[] = []; const used = new Set<string>();
  let guard = 0;
  while (out.length < count && guard++ < 400) {
    const e = COMMON[Math.floor(r() * COMMON.length)];
    const q = MAKERS[Math.floor(r() * MAKERS.length)](e, ELEMENTS);
    if (q && !used.has(q.prompt)) { used.add(q.prompt); out.push(q); }
  }
  return out;
}

/** Where each element sits on the printed table: rows 0-6 for periods 1-7, rows 8 and 9 for the lanthanides and actinides. Columns 0-17. */
export function tablePosition(e: Element): { row: number; col: number } {
  if (e.group !== null) return { row: e.period - 1, col: e.group - 1 };
  const base = e.number <= 71 ? 57 : 89;
  return { row: e.number <= 71 ? 8 : 9, col: 2 + (e.number - base) };
}
