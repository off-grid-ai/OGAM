/**
 * Practice phone calls: the AI plays a person in a short everyday situation (a waiter, a hotel
 * clerk...) and speaks only the language being learned, at the learner's level. Pure, so the
 * prompts and the parsing are tested without a device.
 */
import { levelGuide, methodFor, type LevelId } from './teaching';

export interface Scenario {
  id: string;
  title: string;
  icon: string;
  /** Who the AI plays, and where the learner is calling. */
  role: string;
  /** What the learner is trying to do on the call. */
  goal: string;
  /** Course units whose board squares offer this call. */
  units: string[];
}

export const SCENARIOS: Scenario[] = [
  { id: 'cafe', title: 'Order at a cafe', icon: 'coffee', role: 'a friendly waiter at a cafe', goal: 'order a drink and something to eat, and ask for the bill', units: ['food', 'fruit'] },
  { id: 'intro', title: 'Meet someone new', icon: 'users', role: 'a friendly person the learner has just met at a party', goal: 'say your name, where you are from and how you are', units: ['basics', 'intro', 'family'] },
  { id: 'hotel', title: 'Book a hotel room', icon: 'home', role: 'a hotel receptionist taking a phone booking', goal: 'book a room for two nights and ask the price', units: ['numbers', 'days', 'time'] },
  { id: 'directions', title: 'Ask for directions', icon: 'map-pin', role: 'a helpful stranger on the street', goal: 'find the way to the station or a shop', units: ['directions'] },
  { id: 'shop', title: 'Shop for clothes', icon: 'shopping-bag', role: 'a shop assistant in a clothes shop', goal: 'ask for a size and a colour, and pay', units: ['colors', 'shopping'] },
  { id: 'taxi', title: 'Call a taxi', icon: 'truck', role: 'a taxi dispatcher on the phone', goal: 'ask for a taxi to an address at a certain time', units: ['time', 'travel'] },
  { id: 'doctor', title: 'Make a doctor visit', icon: 'activity', role: 'a doctor\'s receptionist on the phone', goal: 'say you feel ill and make an appointment', units: ['help', 'health'] },
  { id: 'friend', title: 'Chat with a friend', icon: 'message-circle', role: 'a friend calling to catch up', goal: 'talk about your day and make plans for the weekend', units: [] },
];

/** The call a board square offers: the one that matches the unit before it, else one by the square's place. */
export function scenarioFor(unitId: string | undefined, index = 0): Scenario {
  return SCENARIOS.find((s) => unitId && s.units.includes(unitId)) ?? SCENARIOS[index % SCENARIOS.length];
}

/** A call the learner described themselves ("calling a plumber about a leak"). */
export function customScenario(text: string): Scenario {
  const what = text.trim().slice(0, 140);
  return { id: 'custom', title: what, icon: 'phone', role: `the other person in this situation: ${what}`, goal: 'handle the situation in a natural conversation', units: [] };
}

/** How many things the learner must say before a board call counts as done. */
export const CALL_TURNS_TO_PASS = 3;

export function callSystemPrompt(s: Scenario, language: string, level: LevelId): string {
  const guide = levelGuide(level);
  return [
    methodFor(guide, language),
    `This is a practice phone call. You play ${s.role}. The learner wants to ${s.goal}.`,
    `Speak only ${language}. Never use English, even if the learner does.`,
    `Say one to two short sentences per turn (at most ${guide.maxWords} words each) and end with a question or a prompt so the call keeps going.`,
    'If the learner makes a mistake, understand it and carry on naturally without correcting them. If you did not follow, ask them to repeat in the simplest words.',
    'Plain spoken words only: no lists, no brackets, no stage directions, no emojis.',
    'When the goal is done, say a short friendly goodbye.',
  ].join(' ');
}

/** Splits a reply into sentences to speak one by one (so the first is heard while the rest are read out). */
export function sentencesOf(text: string): string[] {
  return (text.replace(/<think>[\s\S]*?<\/think>/g, '').match(/[^.!?…。！？]+[.!?…。！？]*/g) ?? [])
    .map((x) => x.replace(/[*_#`]/g, '').trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
}

export type Turn = { who: 'me' | 'them'; text: string };

/** The call so far as chat messages for the model (the AI's lines are "assistant"). */
export function callMessages(system: string, turns: Turn[]) {
  return [
    { id: 'sys', role: 'system' as const, content: system, timestamp: 0 },
    // Most chat templates want the user to speak first: the AI starts by answering the phone.
    { id: 'go', role: 'user' as const, content: '(The phone rings and you pick up.)', timestamp: 0 },
    ...turns.map((t, i) => ({ id: `t${i}`, role: t.who === 'me' ? ('user' as const) : ('assistant' as const), content: t.text, timestamp: 0 })),
  ];
}

export function hintMessages(system: string, turns: Turn[], language: string) {
  return [
    { id: 'sys', role: 'system' as const, content: `${system} Now you are the teacher, not the caller: suggest what the learner could say next.`, timestamp: 0 },
    { id: 'u', role: 'user' as const, content: `The call so far:\n${turns.map((t) => `${t.who === 'me' ? 'Learner' : 'Caller'}: ${t.text}`).join('\n') || '(the caller just answered)'}\n\nReply with exactly two lines. Line 1: one short sentence the learner could say next, in ${language}. Line 2: its English meaning. Nothing else.`, timestamp: 0 },
  ];
}

/** The hint as the sentence to say and what it means, or null when the reply was not in that shape. */
export function parseHint(raw: string): { say: string; en: string } | null {
  const lines = raw.replace(/<think>[\s\S]*?<\/think>/g, '').split('\n').map((l) => l.replace(/^(line\s*\d+[:.)]?|[-*\d.)]+)\s*/i, '').trim()).filter(Boolean);
  return lines.length >= 2 ? { say: lines[0], en: lines[1].replace(/^[("']|[)"']$/g, '') } : null;
}

export function reviewMessages(language: string, turns: Turn[]) {
  const mine = turns.filter((t) => t.who === 'me').map((t) => `- ${t.text}`).join('\n');
  return [
    { id: 'sys', role: 'system' as const, content: `You are a kind ${language} teacher checking what an English speaker said on a practice call. The lines were typed by a speech recognizer, so ignore accents, capital letters and punctuation. Only point out real mistakes in grammar, word choice or word order.`, timestamp: 0 },
    { id: 'u', role: 'user' as const, content: `What the learner said:\n${mine}\n\nFor each line with a real mistake write one line: what they said | the corrected sentence | a few words saying why in English. Skip lines that are fine. If there are no mistakes write exactly: NONE`, timestamp: 0 },
  ];
}

export interface Correction { said: string; fixed: string; why: string }

/** The corrections from a review reply; an empty list means "no mistakes". */
export function parseReview(raw: string): Correction[] {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (/^none\b/i.test(text)) return [];
  return text.split('\n').map((l) => l.replace(/^[-*\d.)\s]+/, '').split('|').map((p) => p.trim()))
    .filter((p) => p.length >= 2 && p[0] && p[1])
    .map(([said, fixed, why]) => ({ said, fixed, why: why ?? '' }))
    .filter((c) => c.said.toLocaleLowerCase() !== c.fixed.toLocaleLowerCase());
}
