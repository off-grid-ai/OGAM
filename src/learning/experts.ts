/**
 * Which experts' lessons a chat uses. Each subject (Taxes, Law, Psychology...) learns on its own, so a chat is given
 * only the lessons of the subject it is about, picked by how much the message shares with the expert's name and topic.
 * The General expert's lessons are short and always apply. Pure, so it is tested without a device.
 */
const MIN_SCORE = 2;

export interface ExpertView { id: string; name: string; topic: string; lessons: string }

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'how', 'what', 'when', 'about', 'into', 'from', 'are', 'can', 'will', 'does', 'have', 'has', 'not']);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);

/** Shared words between the message and an expert's name (counting triple) and topic. */
export function expertRelevance(message: string, e: ExpertView): number {
  const have = new Set(words(message).map(stem));
  const name = new Set(words(e.name).map(stem));
  const topic = new Set(words(e.topic).map(stem));
  let score = 0;
  for (const w of have) score += (name.has(w) ? 3 : 0) + (topic.has(w) ? 1 : 0);
  return score;
}

/** The expert whose subject the message is about, or undefined when none of them matches well enough. */
export function bestExpert(message: string, experts: ExpertView[]): ExpertView | undefined {
  const best = experts
    .filter((e) => e.lessons.trim())
    .map((e) => ({ e, score: expertRelevance(message, e) }))
    .sort((a, b) => b.score - a.score)[0];
  return best && best.score >= MIN_SCORE ? best.e : undefined;
}

export const GENERAL_CHARS = 600;
export const EXPERT_CHARS = 1400;

/** The prompt note: the general lessons, plus the best-matching expert's lessons when the message is about its subject. */
export function expertsNote(message: string, general: string, experts: ExpertView[]): string {
  const parts: string[] = [];
  const g = general.trim();
  if (g) parts.push(`Lessons learned from practice (follow these):\n${g.slice(0, GENERAL_CHARS)}`);
  const best = bestExpert(message, experts);
  if (best) parts.push(`You are acting as an expert in ${best.name}. What you learned about it (follow these):\n${best.lessons.trim().slice(0, EXPERT_CHARS)}`);
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}
