/**
 * Stories and podcasts for the language course: short pieces in simple words, with a question
 * every so often and a list of the new words in them. Pure parsing and checks, tested without a device.
 */
import { parseJsonLoose, str } from '../study/games/json';

export interface Line { speaker?: string; t: string; en: string }
export interface Question { q: string; options: string[]; answer: number }
export interface Part { lines: Line[]; question?: Question }
export interface Word { t: string; en: string }
export interface Listening {
  kind: 'story' | 'podcast'; title: string; parts: Part[]; vocab: Word[]; createdAt: number;
  /** The pre-made piece this is (library.ts), if it is one. */
  pieceId?: string;
}

const plain = (w: string) => w.toLowerCase().replace(/[.!?¡¿,;:"«»]/g, '').trim();

/** Words the learner has already met in finished units or saved to My words. */
export function knownSet(items: { t: string }[]): Set<string> {
  return new Set(items.flatMap((x) => x.t.split(/\s+/).map(plain)).filter(Boolean));
}

/** Only the new words: drops words the learner knows and repeats. */
export function newWords(vocab: Word[], known: Set<string>): Word[] {
  const seen = new Set<string>();
  return vocab.filter((v) => {
    const k = plain(v.t);
    if (!k || !v.en || known.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Reads the model's reply. Needs at least two parts with text and English; a question needs a valid answer. */
export function parseListening(raw: string, kind: Listening['kind'], known: Set<string>): Listening | null {
  const d = parseJsonLoose<any>(raw);
  if (!d || !Array.isArray(d.parts)) return null;
  const parts: Part[] = d.parts.map((p: any) => {
    const lines: Line[] = (Array.isArray(p?.lines) ? p.lines : [p]).map((l: any) => ({
      ...(kind === 'podcast' && l?.speaker ? { speaker: str(l.speaker, 20) } : {}),
      t: str(l?.t ?? l?.text, 400), en: str(l?.en ?? l?.english, 400),
    })).filter((l: Line) => l.t && l.en);
    const q = p?.question;
    const options = Array.isArray(q?.options) ? q.options.map((o: unknown) => str(o, 120)).filter(Boolean) : [];
    const answer = Number(q?.answer);
    const question = q && str(q.q, 200) && options.length >= 2 && Number.isInteger(answer) && answer >= 0 && answer < options.length
      ? { q: str(q.q, 200), options, answer } : undefined;
    return { lines, ...(question ? { question } : {}) };
  }).filter((p: Part) => p.lines.length);
  if (parts.length < 2) return null;
  const vocab = newWords((Array.isArray(d.vocab) ? d.vocab : []).map((v: any) => ({ t: str(v?.t ?? v?.word, 60), en: str(v?.en ?? v?.meaning, 80) })), known);
  return { kind, title: str(d.title, 80) || (kind === 'story' ? 'A short story' : 'A short podcast'), parts, vocab, createdAt: Date.now() };
}
