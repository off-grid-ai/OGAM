/** Exam planner: exams in the order taken, a daily target for each, and a check on whether you are on pace. Dates are YYYY-MM-DD. */
export interface PlanExam { name: string; date: string; topics: string[]; done?: string[] }
export interface PlanDay { date: string; exam: string; topics: string[] }

const DAY = 86400000;
const parse = (s: string): number => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) throw new Error(`Use YYYY-MM-DD, got: ${s}`); return Date.UTC(+m[1], +m[2] - 1, +m[3]); };
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Spreads each exam's remaining topics over the days between the previous exam (or today) and its date, with the last `reviewDays` kept free for review. */
export function buildPlan(exams: PlanExam[], today: string, opts: { reviewDays?: number; restDay?: number } = {}): PlanDay[] {
  const review = opts.reviewDays ?? 3;
  let start = parse(today);
  const plan: PlanDay[] = [];
  for (const exam of exams) {
    const end = parse(exam.date);
    if (end <= start) throw new Error(`${exam.name} is on ${exam.date}, which is not after the previous exam or today.`);
    const todo = exam.topics.filter((t) => !(exam.done ?? []).includes(t));
    const studyDays: number[] = [];
    for (let t = start; t < end - review * DAY; t += DAY) if (opts.restDay === undefined || new Date(t).getUTCDay() !== opts.restDay) studyDays.push(t);
    if (todo.length && !studyDays.length) throw new Error(`Not enough days before ${exam.name} for ${todo.length} topics.`);
    todo.forEach((topic, i) => {
      const day = studyDays[Math.min(studyDays.length - 1, Math.floor((i * studyDays.length) / todo.length))];
      const last = plan[plan.length - 1];
      if (last && last.date === iso(day) && last.exam === exam.name) last.topics.push(topic); else plan.push({ date: iso(day), exam: exam.name, topics: [topic] });
    });
    for (let k = review; k >= 1; k--) plan.push({ date: iso(end - k * DAY), exam: exam.name, topics: ['Review: missed questions and weak topics'] });
    start = end + DAY;
  }
  return plan;
}

/** Topics that should be finished by `today` but are not, so the screen can say "2 topics behind". */
export function behind(plan: PlanDay[], doneTopics: string[], today: string): string[] {
  const t = parse(today);
  return plan.filter((d) => parse(d.date) < t).flatMap((d) => d.topics).filter((x) => !x.startsWith('Review') && !doneTopics.includes(x));
}

/** Per-day target text for a given date. */
export function todaysTarget(plan: PlanDay[], today: string): string {
  const d = plan.filter((p) => p.date === today);
  return d.length ? d.map((p) => `${p.exam}: ${p.topics.join('; ')}`).join('\n') : 'Nothing planned today.';
}

/** Calendar events for the plan (title, all-day date) ready for the calendar tool. */
export const planEvents = (plan: PlanDay[]) => plan.map((p) => ({ title: `${p.exam}: ${p.topics.join('; ').slice(0, 80)}`, date: p.date }));
