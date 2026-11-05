/** The tutor's second tool: planner, rubric check, APA references and literature matrix, all computed in code from what the person pasted. */
import { apaReference, apaInText } from './citations';
import { buildPlan, behind, todaysTarget, type PlanExam } from './planner';
import { checkDraft, parseRubric, rubricSummary } from './rubric';
import { matrixMarkdown, referenceListApa, type Paper } from './literature';

const json = (v: unknown, what: string): any => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { throw new Error(`${what} must be valid JSON.`); } };

/** Reading statistics for a passage: counts, Flesch reading ease, grade level and the words used most. */
export function textStats(text: string) {
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  if (!words.length) throw new Error('Give some text to measure.');
  const syllables = (w: string) => Math.max(1, (w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g) ?? []).length);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const wps = words.length / sentences; const spw = syl / words.length;
  const counts = new Map<string, number>();
  for (const w of words.map((x) => x.toLowerCase())) if (w.length > 3) counts.set(w, (counts.get(w) ?? 0) + 1);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { words: words.length, sentences, wordsPerSentence: r1(wps), averageWordLength: r1(words.reduce((n, w) => n + w.length, 0) / words.length),
    fleschReadingEase: r1(206.835 - 1.015 * wps - 84.6 * spw), fleschKincaidGrade: r1(0.39 * wps + 11.8 * spw - 15.59),
    mostUsed: [...counts].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w, c]) => `${w} (${c})`) };
}

export function studyHelpers(a: Record<string, unknown>): string {
  switch (a.action) {
    case 'plan': {
      const exams = json(a.exams, 'exams') as PlanExam[];
      const today = String(a.today ?? new Date().toISOString().slice(0, 10));
      const plan = buildPlan(exams, today, { reviewDays: a.review_days ? Number(a.review_days) : undefined });
      const done = Array.isArray(a.done_topics) ? (a.done_topics as string[]) : [];
      return JSON.stringify({ today: todaysTarget(plan, today), behind: behind(plan, done, today), days: plan.length, first: plan.slice(0, 14) });
    }
    case 'rubric': {
      const crit = parseRubric(String(a.rubric ?? ''));
      if (!crit.length) throw new Error('No criteria found. Paste the rubric one criterion per line.');
      return rubricSummary(checkDraft(crit, String(a.draft ?? '')));
    }
    case 'apa': {
      const c = json(a.source, 'source');
      return JSON.stringify({ reference: apaReference({ quote: '', ...c }), inText: apaInText({ quote: '', ...c }) });
    }
    case 'matrix': {
      const papers = json(a.papers, 'papers') as Paper[];
      return `${matrixMarkdown(papers)}\n\nReferences (APA 7):\n${referenceListApa(papers).text}`;
    }
    case 'text_stats': return JSON.stringify(textStats(String(a.text ?? a.draft ?? '')));
    default: throw new Error('action must be one of: plan, rubric, apa, matrix, text_stats');
  }
}
