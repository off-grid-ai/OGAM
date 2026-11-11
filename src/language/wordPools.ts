/** Pools of words the course draws on: a unit's own, the built-in phrases, a level's, an exam's, and the word of the day. */
import { PHRASE_LANGUAGES, PHRASES_EN } from '../phrases/data';
import { UNITS, unitById, unitsForLevel, type Unit } from './curriculum';
import { boardFor, lessonKey, unitDone } from './board';
import { dueItems } from './review';
import type { Item } from './lessons';
import type { LevelId } from './teaching';
import { useLanguage } from './store';

export function builtInWords(unit: Unit, code: string): Item[] {
  const lang = PHRASE_LANGUAGES.find((l) => l.code === code);
  return unit.items.map((en) => {
    const p = lang?.phrases[PHRASES_EN.indexOf(en)];
    return { en, t: p?.[0] ?? '', ...(p?.[1] ? { r: p[1] } : {}) };
  }).filter((x) => x.t);
}

const wordsOf = (units: Unit[], code: string): Item[] => {
  const { content } = useLanguage.getState();
  return units.flatMap((u) => (u.builtIn ? builtInWords(u, code) : content[code]?.[u.id] ?? []));
};

/** A short word or phrase, the same all day, from the current level's lessons and the built-in phrases. */
export function wordOfTheDayFor(date: Date): Item | null {
  const { language: code, level, content } = useLanguage.getState();
  const lang = PHRASE_LANGUAGES.find((l) => l.code === code);
  const builtIn = PHRASES_EN.map((en, i) => ({ en, t: lang?.phrases[i]?.[0] ?? '', ...(lang?.phrases[i]?.[1] ? { r: lang.phrases[i][1] } : {}) }));
  const written = unitsForLevel(level).flatMap((u) => (u.builtIn ? [] : content[code]?.[u.id] ?? []));
  const pool = [...written, ...builtIn].filter((x, i, all) => x.t && x.t.split(/\s+/).length <= 3 && all.findIndex((y) => y.t === x.t) === i);
  if (!pool.length) return null;
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
  return pool[(day * 7919) % pool.length];
}

export function levelWordsFor(level: LevelId, code: string): Item[] {
  const words = wordsOf(unitsForLevel(level), code);
  if (words.length < 6) throw new Error('Do this level\'s lessons first: the checkpoint tests all of them.');
  return words;
}

export function examWordsFor(level: LevelId, examKey: string | undefined, code: string): Item[] {
  const spaces = boardFor(level);
  const at = Math.max(0, spaces.findIndex((s) => s.key === examKey));
  let from = at;
  while (from > 0 && spaces[from - 1].kind !== 'exam') from--;
  const units = [...new Set(spaces.slice(from, at).filter((s) => s.kind === 'lesson' && s.unitId).map((s) => s.unitId!))]
    .map((id) => unitById(id)).filter((u): u is Unit => !!u);
  const words = wordsOf(units, code);
  if (words.length < 6) throw new Error('Do the lessons before this exam first: it tests them.');
  return words;
}

/** Every word the learner has met: finished units and saved words. */
export function knownItemsFor(code: string): Item[] {
  const { content, myWords, progress } = useLanguage.getState();
  const done = UNITS.filter((u) => unitDone(u, (k) => (progress[code]?.[k]?.stars ?? 0) > 0));
  return [...done.flatMap((u) => (u.builtIn ? builtInWords(u, code) : content[code]?.[u.id] ?? [])), ...(myWords[code] ?? [])];
}

/** Items from every unit the learner has practised at least once (for review). */
export function studiedItemsFor(code: string): Item[] {
  const { content, progress, myWords } = useLanguage.getState();
  const studied = UNITS.filter((u) => (progress[code]?.[lessonKey(u.id, 1)]?.lessons ?? 0) > 0);
  return [...studied.flatMap((u) => (u.builtIn ? builtInWords(u, code) : content[code]?.[u.id] ?? [])), ...(myWords[code] ?? [])];
}

export function wordBookFor(code: string): { t: string; en: string; r?: string; box: number; due: number | null }[] {
  const memory = useLanguage.getState().memory[code] ?? {};
  const seen = new Set<string>();
  return studiedItemsFor(code).filter((x) => !seen.has(x.t) && seen.add(x.t))
    .map((x) => ({ ...x, box: memory[x.t]?.box ?? 0, due: memory[x.t]?.due ?? null }));
}

/** The words missed most and not yet made up for, most missed first. */
export function mistakeItemsFor(code: string, n = 10): Item[] {
  const memory = useLanguage.getState().memory[code] ?? {};
  const seen = new Set<string>();
  return studiedItemsFor(code).filter((x) => (memory[x.t]?.misses ?? 0) > 0 && !seen.has(x.t) && seen.add(x.t))
    .sort((a, b) => (memory[b.t].misses ?? 0) - (memory[a.t].misses ?? 0)).slice(0, n);
}

export function dueCountFor(code: string): number {
  return dueItems(studiedItemsFor(code), useLanguage.getState().memory[code] ?? {}, { n: 1000 }).length;
}

export function reviewSquareWordsFor(code: string): Item[] {
  const studied = studiedItemsFor(code);
  const due = dueItems(studied, useLanguage.getState().memory[code] ?? {}, { n: 10 });
  const more = studied.slice().reverse().filter((x) => !due.some((d) => d.t === x.t));
  const words = [...due, ...more].slice(0, 10);
  if (words.length < 4) throw new Error('Finish a few lessons first, then this square reviews their words.');
  return words;
}
