/**
 * Rubric checker: split a rubric into criteria, then check a draft against each one in code (key-term coverage and length),
 * citing the rubric line. It cannot judge quality; it finds criteria the draft does not touch, and says so.
 */
export interface Criterion { id: number; text: string; terms: string[] }
export interface CriterionResult { id: number; text: string; covered: boolean; missing: string[]; hits: number }

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'will', 'your', 'their', 'into', 'about', 'which', 'what', 'when', 'where', 'such', 'than', 'then', 'them', 'been', 'have', 'has', 'does', 'not', 'any', 'all', 'can', 'may', 'must', 'should', 'would', 'could', 'using', 'used', 'use', 'also', 'each', 'both', 'more', 'most', 'other', 'some', 'only', 'very', 'well', 'including', 'include', 'includes', 'demonstrates', 'demonstrate', 'provides', 'provide', 'clearly', 'effectively', 'accurately', 'distinguished', 'proficient', 'basic', 'non-performance', 'nonperformance']);
const stem = (w: string) => w.replace(/(ing|ed|es|s|ly)$/i, '');
const words = (t: string) => (t.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w));

/** One criterion per bullet/numbered/row line of at least a few words. */
export function parseRubric(text: string): Criterion[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|[a-z][.)])\s*/i, '').trim()).filter((l) => l.split(/\s+/).length >= 4);
  return lines.map((l, i) => ({ id: i + 1, text: l, terms: [...new Set(words(l).map(stem))].slice(0, 8) }));
}

export function checkDraft(rubric: Criterion[], draft: string, minShare = 0.5): CriterionResult[] {
  const have = new Set(words(draft).map(stem));
  return rubric.map((c) => {
    const hit = c.terms.filter((t) => have.has(t));
    const covered = c.terms.length === 0 ? true : hit.length / c.terms.length >= minShare;
    return { id: c.id, text: c.text, covered, missing: c.terms.filter((t) => !have.has(t)), hits: hit.length };
  });
}

export const rubricSummary = (r: CriterionResult[]): string => {
  const open = r.filter((x) => !x.covered);
  return open.length ? `${open.length} of ${r.length} criteria look unaddressed:\n${open.map((x) => `- #${x.id} ${x.text} (missing: ${x.missing.join(', ')})`).join('\n')}\nThis checks wording only, not quality.` : `All ${r.length} criteria are mentioned in the draft. This checks wording only, not quality.`;
};
