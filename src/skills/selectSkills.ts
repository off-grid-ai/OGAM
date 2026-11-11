/**
 * Which installed skill applies to a message, and the note that puts its instructions in the prompt. A skill applies when the
 * person calls it by name ("/summarize-notes ...") or when the message shares enough words with its name and description.
 * Only the best match is used and it is cut to fit the model's context (a small model has little room), so a skill never
 * crowds out the chat. Pure, so it is tested without a device.
 */
import type { Skill } from './skillsStore';

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'use', 'when', 'from', 'are', 'can', 'will', 'has', 'have', 'not', 'any', 'all', 'how', 'what', 'please', 'about', 'into', 'its', 'they', 'them', 'then', 'also', 'such', 'like', 'make', 'just']);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);

/** The skill named at the start of the message ("/name rest"), if it can be called that way. */
export function calledSkill(message: string, skills: Skill[]): Skill | undefined {
  const m = /^\s*\/([a-z0-9-]+)\b/i.exec(message);
  return m ? skills.find((s) => s.enabled && s.userInvocable && s.name === m[1].toLowerCase()) : undefined;
}

/** Words shared between the message and a skill, name words counting triple. */
export function relevance(message: string, skill: Skill): number {
  const have = new Set(words(message).map(stem));
  const name = new Set(words(skill.name.replace(/-/g, ' ')).map(stem));
  const description = new Set(words(skill.description).map(stem));
  let score = 0;
  for (const w of have) score += (name.has(w) ? 3 : 0) + (description.has(w) ? 1 : 0);
  return score;
}

/** Skill text that fits: the model's context decides how much room there is. */
export const skillBudgetChars = (contextTokens: number) => (contextTokens <= 4096 ? 1500 : contextTokens <= 8192 ? 3500 : 6000);

/** Needs a clear match: a name word, or three description words. */
const MIN_SCORE = 3;

export function pickSkill(message: string, skills: Skill[]): Skill | undefined {
  const on = skills.filter((s) => s.enabled);
  const named = calledSkill(message, on);
  if (named) return named;
  const best = on.map((s) => ({ s, score: relevance(message, s) })).sort((a, b) => b.score - a.score)[0];
  return best && best.score >= MIN_SCORE ? best.s : undefined;
}

/** The note added under the chat's instructions, or '' when no skill applies. */
export function skillsNote(message: string, skills: Skill[], contextTokens: number): string {
  const skill = pickSkill(message, skills);
  if (!skill) return '';
  const room = skillBudgetChars(contextTokens);
  const body = skill.body.length > room ? `${skill.body.slice(0, room).trimEnd()}\n[... the rest of this skill was left out to fit the model's memory]` : skill.body;
  return `\n\nSKILL "${skill.name}" (instructions the user installed; follow them for this request):\n${body}`;
}
