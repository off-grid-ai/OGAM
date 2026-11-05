/** Literature matrix built only from papers the person imported or typed in: no reference is ever invented. */
import { apaReference, type Citation } from './citations';

export interface Paper extends Citation { id: string; question?: string; method?: string; sample?: string; findings?: string; limitations?: string }
export const MATRIX_COLUMNS = ['Source', 'Research question', 'Method', 'Sample', 'Findings', 'Limitations'] as const;

export function matrixRows(papers: Paper[]): string[][] {
  return papers.map((p) => [apaReference(p), p.question ?? '', p.method ?? '', p.sample ?? '', p.findings ?? '', p.limitations ?? '']);
}
/** Markdown table for export. */
export function matrixMarkdown(papers: Paper[]): string {
  const esc = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');
  const head = `| ${MATRIX_COLUMNS.join(' | ')} |\n|${MATRIX_COLUMNS.map(() => ' --- ').join('|')}|`;
  return [head, ...matrixRows(papers).map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
}
/** Reference list, alphabetical, APA 7. Papers missing a title are left out and reported. */
export function referenceListApa(papers: Paper[]): { text: string; skipped: number } {
  const ok = papers.filter((p) => p.title?.trim());
  return { text: ok.map((p) => apaReference(p)).sort((a, b) => a.localeCompare(b)).join('\n'), skipped: papers.length - ok.length };
}
/** Fields still blank for a paper, so the screen can ask the person to fill them from the paper. */
export const gaps = (p: Paper): string[] => (['author', 'year', 'question', 'method', 'sample', 'findings', 'limitations'] as const).filter((k) => !(p as any)[k]?.toString().trim());
