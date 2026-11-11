import { lessonsFileName, lessonsMarkdown } from '../../src/learning/lessonsFile';

describe('lessons file', () => {
  it('names the file after the agent', () => {
    expect(lessonsFileName('Math Tutor!')).toBe('math-tutor-lessons.md');
    expect(lessonsFileName('')).toBe('atlas-lessons.md');
  });
  it('lists each lesson once as a bullet', () => {
    const md = lessonsMarkdown('Jake', '- Check units\n* Show steps\n\nAsk first', new Date('2026-11-09T10:30:00Z'));
    expect(md).toContain('# What Jake has learned');
    expect(md).toContain('Updated 2026-11-09 10:30');
    expect(md).toContain('- Check units\n- Show steps\n- Ask first');
  });
  it('says so when there are none', () => {
    expect(lessonsMarkdown('Jake', '')).toContain('(No lessons yet.)');
  });
});

import { reportsFileName, reportsMarkdown } from '../../src/learning/lessonsFile';

describe('reports file', () => {
  const r = (over: object = {}) => ({ q: 'How long to boil water?', text: 'ANSWER: three minutes.', status: 'pass', score: 8, why: 'Matches the source', sources: 'WHO note', at: Date.parse('2026-11-10T09:30:00Z'), ...over });
  it('is named after the expert', () => expect(reportsFileName('Taxes')).toBe('taxes-reports.md'));
  it('lists every report in full with the judge verdict and sources', () => {
    const md = reportsMarkdown('Taxes', [r(), r({ q: 'Second?', status: 'fail', score: 3, why: 'No source', sources: '' })]);
    expect(md).toContain('# Reports on Taxes');
    expect(md).toContain('2 reports, newest first.');
    expect(md).toContain('## How long to boil water?');
    expect(md).toContain('Judge passed it (8/10) · 2026-11-10 09:30');
    expect(md).toContain('ANSWER: three minutes.');
    expect(md).toContain('Judge: Matches the source');
    expect(md).toContain('Sources it had');
    expect(md).toContain('Judge failed it (3/10)');
  });
  it('says so when there are none', () => expect(reportsMarkdown('', [])).toContain('0 reports'));
});

describe('numbered sources in reports', () => {
  it('lists the sources 1, 2, 3 in the exported file', () => {
    const md = reportsMarkdown('Taxes', [{ q: 'Deadline?', text: 'Due April 15 [1].', status: 'pass', at: 1,
      sourceList: [{ n: 1, title: 'IRS: deadlines', kind: 'web', url: 'https://irs.example' }, { n: 2, title: 'Tax guide', kind: 'project' }] }]);
    expect(md).toContain('**Sources**');
    expect(md).toContain('1. IRS: deadlines (web) https://irs.example');
    expect(md).toContain('2. Tax guide (project)');
    expect(md).not.toContain('Sources it had');
  });
});
