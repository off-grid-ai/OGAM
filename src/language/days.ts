/** Calendar-day helpers for the course's daily history. Pure, so they are tested without a device. */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Keeps the last 90 days of history. */
export const keepDays = (h: Record<string, { xp: number; lessons: number }>) => {
  const cutoff = Date.now() - 90 * 864e5;
  const time = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  return Object.fromEntries(Object.entries(h).filter(([d]) => time(d) >= cutoff));
};

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** The last seven days, oldest first, for the weekly chart. */
export function weekOf(history: Record<string, { xp: number; lessons: number }>, now: Date): { day: string; label: string; xp: number; lessons: number; today: boolean }[] {
  return Array.from({ length: 7 }, (_, k) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - k));
    const key = dayKey(d);
    return { day: key, label: WEEKDAYS[d.getDay()], xp: history[key]?.xp ?? 0, lessons: history[key]?.lessons ?? 0, today: k === 6 };
  });
}
