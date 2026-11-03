/**
 * A course as a file you can send to another phone and open there. The file holds the plan and every square already
 * written (so it opens at once, even offline) and your own notes; it never holds your progress, your project link, or the
 * text of web pages (only their titles and addresses). Pure, so it is tested without a device.
 */
import { FORMAT_IDS, type PlannedSquare, type SquareContent } from './formats';
import type { Course } from './store';

export const COURSE_FILE_EXTENSION = 'atlascourse.json';
export const MAX_COURSE_FILE_CHARS = 3_000_000;

export interface SharedCourse {
  atlasCourse: 1;
  title: string; topic: string; summary: string; style: string; theme: string;
  request: Course['request'];
  squares: PlannedSquare[];
  content: Record<string, SquareContent>;
  sources: { title: string; kind: 'web' | 'note' | 'file'; url?: string; text: string }[];
}

export function courseToFile(course: Course): string {
  const shared: SharedCourse = {
    atlasCourse: 1, title: course.title, topic: course.topic, summary: course.summary, style: course.style, theme: course.theme,
    request: course.request, squares: course.squares, content: course.content,
    sources: (course.sources ?? []).map((s) => ({ title: s.title, kind: s.kind, url: s.url, text: s.kind === 'web' ? '' : s.text })),
  };
  return JSON.stringify(shared);
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

const isStr = (v: unknown) => typeof v === 'string';
const list = (v: unknown, min = 1, each: (x: any) => boolean = () => true): boolean =>
  Array.isArray(v) && v.length >= min && v.length <= 60 && v.every(each);
const inRange = (n: unknown, size: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < size;

/** What each kind of square needs before it can be played. */
const CHECKS: Record<string, (c: any) => boolean> = {
  lesson: (c) => list(c.sections, 1, (s) => isStr(s?.text)),
  quiz: (c) => list(c.questions, 1, (q) => isStr(q?.q) && Array.isArray(q.options) && inRange(q.answer, q.options.length)),
  cards: (c) => list(c.cards, 1, (x) => isStr(x?.front) && isStr(x?.back)),
  match: (c) => list(c.pairs, 1, (p) => isStr(p?.left) && isStr(p?.right)),
  order: (c) => list(c.steps, 1, isStr),
  practice: (c) => isStr(c.task) && isStr(c.model) && Array.isArray(c.rubric),
  numeric: (c) => isStr(c.task) && Number.isFinite(c.answer) && Number.isFinite(c.tolerance) && Array.isArray(c.working),
  worked: (c) => isStr(c.problem) && list(c.steps, 2, (x) => isStr(x?.step)),
  table: (c) => isStr(c.markdown),
  typed: (c) => list(c.items, 1, (x) => isStr(x?.prompt) && isStr(x?.answer) && Array.isArray(x.alternatives)),
  tablefill: (c) => list(c.columns, 2) && list(c.rows, 2) && list(c.answers, 2) && c.answers.length === c.rows.length,
  sort: (c) => list(c.groups, 2) && list(c.items, 4, (x) => isStr(x?.text) && inRange(x.group, c.groups.length)),
  dictation: (c) => list(c.sentences, 3, isStr),
};

/** True when a square's content has the parts its kind needs (the file may come from anyone). */
export function validContent(c: any): c is SquareContent {
  return !!c && typeof c === 'object' && Object.prototype.hasOwnProperty.call(CHECKS, c.kind) && CHECKS[c.kind](c);
}

/** The course in a file, checked square by square; throws a message the person can read when it is not an Atlas course. */
export function parseCourseFile(raw: string): SharedCourse {
  if (raw.length > MAX_COURSE_FILE_CHARS) throw new Error('That file is too big to be a course.');
  let json: any;
  try { json = JSON.parse(raw); } catch { throw new Error('That is not an Atlas course file.'); }
  if (json?.atlasCourse !== 1 || !Array.isArray(json.squares)) throw new Error('That is not an Atlas course file.');
  const squares: PlannedSquare[] = json.squares.slice(0, 40).filter((s: any) => s && typeof s.key === 'string' && /^[\w-]{1,20}$/.test(s.key) && FORMAT_IDS.includes(s.format) && text(s.title, 80))
    .map((s: any) => ({ key: s.key, format: s.format, title: text(s.title, 60), focus: text(s.focus, 240) || text(s.title, 60), unit: text(s.unit, 80) || 'Course', ...(s.checkpoint ? { checkpoint: true } : {}), ...(s.remedial ? { remedial: true } : {}) }));
  if (squares.length < 2) throw new Error('That course has no squares in it.');
  const keys = new Set(squares.map((s) => s.key));
  const content: Record<string, SquareContent> = {};
  for (const [key, value] of Object.entries(json.content ?? {})) if (keys.has(key) && validContent(value)) content[key] = value;
  const req = json.request ?? {};
  return {
    atlasCourse: 1, title: text(json.title, 80) || 'Shared course', topic: text(json.topic, 120) || text(json.title, 80), summary: text(json.summary, 200), style: text(json.style, 200), theme: text(json.theme, 60),
    request: { topic: text(req.topic, 120) || text(json.topic, 120), goal: text(req.goal, 300), level: text(req.level, 40) || 'Complete beginner', how: text(req.how, 300), minutes: Number(req.minutes) > 0 && Number(req.minutes) <= 60 ? Number(req.minutes) : 10 },
    squares, content,
    sources: (Array.isArray(json.sources) ? json.sources : []).slice(0, 12).filter((s: any) => s && text(s.title, 80)).map((s: any) => ({ title: text(s.title, 80), kind: ['web', 'note', 'file'].includes(s.kind) ? s.kind : 'note', url: typeof s.url === 'string' && /^https?:/.test(s.url) ? s.url : undefined, text: text(s.text, 12000) })),
  };
}
