/**
 * Times as the person holding the phone reads them.
 *
 * Every one of these was written with `toLocaleTimeString` / `toLocaleDateString`, which need ICU
 * data that Hermes ships without in most React Native builds - so they silently answered in UTC. A
 * message written at 10:12 in Delhi read "4:42 AM" on the phone while the Mac beside it said 10:12.
 *
 * The date methods used here (`getHours`, `getDay`, `getMonth`) are always the device's own zone and
 * need no locale data, so the answer is right on every build. Defined once because four screens had
 * grown their own copy of the same formatter, and a fix to one of them would have missed the rest.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "4:05 PM" in this device's timezone. */
export function formatClockTime(value: Date | number | string): string {
  const date = asDate(value);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const suffix = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** "Wed" in this device's timezone. */
function formatWeekday(value: Date | number | string): string {
  return WEEKDAYS[asDate(value).getDay()] ?? '';
}

/** "Mar 4" in this device's timezone. */
function formatShortDate(value: Date | number | string): string {
  const date = asDate(value);
  return `${MONTHS[date.getMonth()] ?? ''} ${date.getDate()}`;
}

/**
 * How a list shows when something last happened: the time today, Yesterday, the weekday this week,
 * then the date. The rule lives here so every list answers the same way.
 */
export function formatWhen(value: Date | number | string): string {
  const date = asDate(value);
  const days = calendarDaysAgo(date);
  if (days <= 0) return formatClockTime(date);
  if (days === 1) return 'Yesterday';
  if (days < 7) return formatWeekday(date);
  return formatShortDate(date);
}

/**
 * Whole days between two calendar dates, not 24-hour blocks.
 *
 * A message sent at 11pm was called "Yesterday" at 1am the next day by the old arithmetic, because
 * two hours had passed rather than a day. People count midnights.
 */
function calendarDaysAgo(date: Date, now: Date = new Date()): number {
  const startOf = (value: Date): number =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  return Math.round((startOf(now) - startOf(date)) / 86_400_000);
}

function asDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}
