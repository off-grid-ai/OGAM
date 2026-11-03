/**
 * Makes courses and their squares with the AI on the phone. Everything the AI writes is checked by formats.ts; a bad answer is
 * asked for once more before giving up with a message the person can act on.
 */
import { askModel } from '../study/engine';
import { contentMessages, gradeMessages, parseContent, parseGrade, parsePlan, planMessages, type CourseRequest, type SquareContent } from './formats';
import { useTopics, type Course } from './store';

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
export async function createCourse(request: CourseRequest): Promise<string> {
  const plan = await askUntil(planMessages(request), parsePlan, 'a course plan');
  return useTopics.getState().add(request, plan);
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
  }), (raw) => parseContent(square.format, raw), `the "${square.title}" square`);
  useTopics.getState().setContent(course.id, key, content);
  return content;
}

/** Asks the AI to mark a practice answer. */
export async function gradeAnswer(input: { task: string; model: string; rubric: string[]; answer: string }): Promise<{ score: number; feedback: string }> {
  return askUntil(gradeMessages(input), parseGrade, 'a mark');
}
