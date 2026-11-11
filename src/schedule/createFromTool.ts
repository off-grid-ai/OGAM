/**
 * Lets the AI make a scheduled task from what you say ("remind me every morning at 7 to read me the news"). The model fills in
 * the fields; this checks them and saves the task, and returns the sentence the model tells you. Pure apart from the store.
 */
import { describeTiming, nextTimeOfDay, type Repeat } from './due';
import { useSchedule } from './store';

const REPEATS: Repeat[] = ['once', 'daily', 'weekdays', 'weekly'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "07:30", "7:30", "7am", "7 pm", "19" -> hour and minute, or null. */
export function parseClock(text: string): { hour: number; minute: number } | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (m[3]) { hour %= 12; if (m[3].toLowerCase() === 'pm') hour += 12; }
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

export function createScheduledTask(args: Record<string, unknown>, now = Date.now()): string {
  const clock = parseClock(String(args.time ?? ''));
  if (!clock) return 'The time was not clear. Ask the user for a time like 07:30.';
  const repeat = String(args.repeat ?? 'daily').toLowerCase() as Repeat;
  if (!REPEATS.includes(repeat)) return 'The repeat must be once, daily, weekdays or weekly.';
  const weekday = DAYS.indexOf(String(args.weekday ?? '').toLowerCase());
  if (repeat === 'weekly' && weekday < 0) return 'For a weekly task, say which day of the week.';
  const isBriefing = String(args.kind ?? '').toLowerCase() === 'briefing';
  const prompt = String(args.task ?? '').trim();
  if (!isBriefing && !prompt) return 'Say what the task should do.';
  const name = String(args.name ?? '').trim().slice(0, 60) || (isBriefing ? 'Daily briefing' : prompt.slice(0, 40));
  const timing = { repeat, hour: clock.hour, minute: clock.minute, ...(repeat === 'weekly' ? { weekday } : {}), ...(repeat === 'once' ? { onceAt: nextTimeOfDay(clock.hour, clock.minute, now) } : {}) };
  useSchedule.getState().add({ name, kind: isBriefing ? 'briefing' : 'prompt', prompt: isBriefing ? '' : prompt, ...timing });
  return `Scheduled "${name}": ${describeTiming({ ...timing, createdAt: now }).toLowerCase()}. The user gets a notification then, and can see or change it in Settings > Scheduled tasks.`;
}
