/**
 * Makes courses and their squares with the AI on the phone. Everything the AI writes is checked by formats.ts; a bad answer is
 * asked for once more before giving up with a message the person can act on.
 */
import { askModel } from '../study/engine';
import { contentMessages, gradeMessages, parseContent, parseGrade, parsePlan, planMessages, type CourseRequest, type SquareContent } from './formats';
import { useTopics, type Course } from './store';
import { makeSource, parsePicks, pickPrompt, relevantExcerpts, type Candidate, type CourseSource } from './sources';

const MAX_TRIES = 2;

async function askUntil<T>(prompt: { system: string; user: string }, read: (raw: string) => T | null, what: string): Promise<T> {
  const { system, user } = prompt;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const raw = await askModel(system, attempt ? `${user}\n\nYour last answer could not be read. Reply with ONLY the JSON, nothing else.` : user);
    const value = read(raw);
    if (value) return value;
  }
  throw new Error(`The AI did not write ${what} in a form Atlas can use. Try again, or use a bigger model.`);
}

/** Plans a course for the request and saves it. Returns its id. */
export async function createCourse(request: CourseRequest, sources: CourseSource[] = [], projectId?: string): Promise<string> {
  const plan = await askUntil(planMessages(request, sources), parsePlan, 'a course plan');
  return useTopics.getState().add(request, plan, sources, projectId);
}

/** Passages from the shared documents of the course's project that match the square (none when there is no project or no documents). */
async function projectExcerpts(projectId: string | undefined, query: string): Promise<{ source: string; text: string }[]> {
  if (!projectId) return [];
  try {
    const { ragService } = require('../services/rag');
    const found = await ragService.searchProject(projectId, query);
    return (found?.chunks ?? []).slice(0, 3).map((c: { name: string; content: string }) => ({ source: c.name, text: String(c.content).slice(0, 700) }));
  } catch { return []; }
}

/** The content of a square: kept from before, or written now. */
export async function squareContent(course: Course, key: string): Promise<SquareContent> {
  const kept = course.content[key];
  if (kept) return kept;
  const index = course.squares.findIndex((s) => s.key === key);
  const square = course.squares[index];
  if (!square) throw new Error('That square is not in this course.');
  const before = course.squares.slice(0, index).map((s) => s.title);
  const content = await askUntil(contentMessages({
    courseTitle: course.title, topic: course.topic, level: course.request.level, how: course.request.how, style: course.style,
    square, before, minutes: course.request.minutes,
    excerpts: [...await projectExcerpts(course.projectId, `${square.title} ${square.focus}`), ...relevantExcerpts(course.sources ?? [], `${square.title} ${square.focus}`)].slice(0, 5),
  }), (raw) => parseContent(square.format, raw), `the "${square.title}" square`);
  useTopics.getState().setContent(course.id, key, content);
  return content;
}

/** Asks the AI to mark a practice answer. */
export async function gradeAnswer(input: { task: string; model: string; rubric: string[]; answer: string }): Promise<{ score: number; feedback: string }> {
  return askUntil(gradeMessages(input), parseGrade, 'a mark');
}

/**
 * Finds pages online worth learning this topic from: searches, has the AI pick the best few, reads them. Nothing is kept
 * until the caller saves it, and the person can remove any source afterwards. Needs the internet (not in off-grid mode).
 */
export async function findSources(topic: string, goal: string, onStep: (m: string) => void = () => undefined): Promise<CourseSource[]> {
  const { offGridOn } = require('../atlasTools/offGrid');
  if (offGridOn()) throw new Error('Off-grid mode is on, so Atlas will not look online. Turn it off, or add your own notes instead.');
  const { searchWeb } = require('../services/tools/webSearchProviders');
  const { braveSearch, readPage } = require('../services/tools/handlers');
  onStep('Searching the web...');
  const found: Candidate[] = [];
  for (const query of [`${topic} beginner guide`, `${topic} explained tutorial`]) {
    try {
      const { results } = await searchWeb(query, braveSearch);
      for (const r of results) if (r.url && /^https?:/.test(r.url) && !found.some((f) => f.url === r.url)) found.push({ title: r.title || r.url, snippet: r.snippet || '', url: r.url });
    } catch { /* the other search may still work */ }
  }
  if (!found.length) throw new Error('Could not find anything online. Check the internet connection, or add your own notes instead.');
  const candidates = found.slice(0, 10);
  onStep('Choosing the best sources...');
  let picks: number[] = [];
  try {
    const prompt = pickPrompt({ topic, goal, found: candidates });
    picks = parsePicks(await askModel(prompt.system, prompt.user), candidates.length);
  } catch { /* use the first few */ }
  const chosen = (picks.length ? picks : [0, 1, 2, 3]).map((i) => candidates[i]).filter(Boolean).slice(0, 4);
  const sources: CourseSource[] = [];
  for (const c of chosen) {
    onStep(`Reading ${c.title.slice(0, 40)}...`);
    try {
      const text: string = await readPage(c.url, 6000);
      if (text && text.length >= 300) sources.push(makeSource({ title: c.title, kind: 'web', url: c.url, text }, `src-${Date.now()}-${sources.length}`));
    } catch { /* skip a page that will not load */ }
  }
  if (!sources.length) throw new Error('The pages found could not be read. Try again, or add your own notes instead.');
  return sources;
}
