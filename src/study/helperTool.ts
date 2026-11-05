/** The tutor's second tool: planner, rubric check, APA references and literature matrix, all computed in code from what the person pasted. */
import { apaReference, apaInText } from './citations';
import { buildPlan, behind, todaysTarget, type PlanExam } from './planner';
import { checkDraft, parseRubric, rubricSummary } from './rubric';
import { matrixMarkdown, referenceListApa, type Paper } from './literature';

const json = (v: unknown, what: string): any => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { throw new Error(`${what} must be valid JSON.`); } };

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
    default: throw new Error('action must be one of: plan, rubric, apa, matrix');
  }
}
