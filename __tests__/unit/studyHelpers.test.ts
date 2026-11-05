import { apaInText, apaReference, quoteAppears, referenceList, sourceStatus, verifyCitations } from '../../src/study/citations';
import { behind, buildPlan, planEvents, todaysTarget } from '../../src/study/planner';
import { checkDraft, parseRubric, rubricSummary } from '../../src/study/rubric';
import { gaps, matrixMarkdown, referenceListApa } from '../../src/study/literature';

describe('citations', () => {
  const text = 'Assets equal liabilities plus equity.  A company with “$500 of assets” has equity.';
  it('verifies quotes against the source and labels the rest', () => {
    expect(quoteAppears('Assets equal liabilities plus equity', text)).toBe(true);
    expect(quoteAppears('with "$500 of assets" has', text)).toBe(true);
    expect(quoteAppears('short', text)).toBe(false);
    const checked = verifyCitations([{ title: 'Book', page: 3, quote: 'Assets equal liabilities plus equity' }, { title: 'Book', quote: 'Depreciation is always straight line' }], () => text);
    expect(checked.map((c) => c.verified)).toEqual([true, false]);
    expect(referenceList(checked)).toMatch(/\[2\].*unverified/);
    expect(sourceStatus(checked)).toBe('1 of 2 quotes found in the source; the rest are unverified.');
    expect(sourceStatus([])).toMatch(/No source/);
  });
  it('writes APA without inventing missing fields', () => {
    expect(apaReference({ title: 'Audit Standards', quote: 'x', publisher: 'AICPA' })).toBe('Audit Standards. (n.d.). AICPA.');
    expect(apaReference({ author: 'Smith, J.', year: '2024', title: 'Tax basics', quote: 'x', url: 'https://x.test' })).toBe('Smith, J. (2024). Tax basics. https://x.test');
    expect(apaInText({ author: 'Smith, J.', year: '2024', title: 't', page: 5, quote: 'x' })).toBe('(Smith, 2024, p. 5)');
  });
});

describe('planner', () => {
  const exams = [
    { name: 'REG', date: '2026-12-20', topics: ['Basis', 'Gains', 'Entities', 'Ethics'] },
    { name: 'TCP', date: '2027-02-10', topics: ['Planning', 'Credits'], done: ['Credits'] },
  ];
  it('orders exams, leaves review days and skips finished topics', () => {
    const plan = buildPlan(exams, '2026-11-05');
    expect(plan.filter((p) => p.exam === 'REG' && !p.topics[0].startsWith('Review')).flatMap((p) => p.topics)).toEqual(['Basis', 'Gains', 'Entities', 'Ethics']);
    expect(plan.filter((p) => p.exam === 'TCP').flatMap((p) => p.topics)).not.toContain('Credits');
    expect(plan.filter((p) => p.topics[0].startsWith('Review') && p.exam === 'REG').map((p) => p.date)).toEqual(['2026-12-17', '2026-12-18', '2026-12-19']);
    expect(plan.every((p, i) => i === 0 || p.date >= plan[i - 1].date)).toBe(true);
    expect(todaysTarget(plan, '2026-11-05')).toMatch(/REG: Basis/);
    expect(behind(plan, [], '2026-12-01').length).toBeGreaterThan(0);
    expect(planEvents(plan)[0]).toHaveProperty('date');
  });
  it('refuses impossible dates', () => {
    expect(() => buildPlan([{ name: 'A', date: '2026-11-01', topics: ['x'] }], '2026-11-05')).toThrow(/not after/);
    expect(() => buildPlan([{ name: 'A', date: '2026-11-07', topics: ['a', 'b'] }], '2026-11-05')).toThrow(/Not enough days/);
  });
});

describe('rubric', () => {
  const rubric = parseRubric('1. Explains the research design and justifies the sampling approach\n2. Applies ethical safeguards for participants\n- ok');
  it('finds criteria a draft does not touch', () => {
    expect(rubric).toHaveLength(2);
    const r = checkDraft(rubric, 'This study uses a case study research design. The sampling approach was purposive and justified by access.');
    expect(r.map((x) => x.covered)).toEqual([true, false]);
    expect(rubricSummary(r)).toMatch(/1 of 2 criteria look unaddressed[\s\S]*#2/);
  });
});

describe('literature', () => {
  const p = [{ id: '1', title: 'Audit quality', author: 'Lee, K.', year: '2022', quote: 'x', method: 'Survey', findings: 'Higher fees | better quality' }, { id: '2', title: '', quote: 'y' }];
  it('builds a matrix and reference list only from what exists', () => {
    expect(matrixMarkdown(p as any)).toMatch(/Lee, K\. \(2022\)\. Audit quality\. \| +\| Survey/);
    expect(matrixMarkdown(p as any)).toContain('Higher fees / better quality');
    expect(referenceListApa(p as any)).toEqual({ text: 'Lee, K. (2022). Audit quality.', skipped: 1 });
    expect(gaps(p[0] as any)).toEqual(['question', 'sample', 'limitations']);
  });
});

import { studyHelpers } from '../../src/study/helperTool';
describe('study helper tool', () => {
  it('runs each action and refuses bad input clearly', () => {
    const plan = JSON.parse(studyHelpers({ action: 'plan', today: '2026-11-05', exams: JSON.stringify([{ name: 'REG', date: '2026-12-20', topics: ['Basis', 'Gains'] }]) }));
    expect(plan.today).toMatch(/REG/);
    expect(studyHelpers({ action: 'rubric', rubric: '1. Explains the research design and sampling approach', draft: 'We used a survey design.' })).toMatch(/unaddressed|mentioned/);
    expect(JSON.parse(studyHelpers({ action: 'apa', source: '{"author":"Lee, K.","year":"2022","title":"Audit quality"}' })).reference).toBe('Lee, K. (2022). Audit quality.');
    expect(() => studyHelpers({ action: 'apa', source: '{nope' })).toThrow(/valid JSON/);
    expect(() => studyHelpers({ action: 'x' })).toThrow(/action must be/);
  });
});

import { findImages, imagesMarkdown, parseCommons } from '../../src/study/images';
describe('image lookup', () => {
  const reply = { query: { pages: {
    1: { index: 2, title: 'File:Periodic table.svg', imageinfo: [{ url: 'https://u/p.svg', thumburl: 'https://u/p-800.png', descriptionurl: 'https://c/File:Periodic', mime: 'image/svg+xml', extmetadata: { Artist: { value: '<a href="x">Jane Doe</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, ImageDescription: { value: 'The <b>periodic</b> table' } } }] },
    2: { index: 1, title: 'File:Fair use logo.png', imageinfo: [{ url: 'https://u/l.png', descriptionurl: 'https://c/File:Logo', mime: 'image/png', extmetadata: { LicenseShortName: { value: 'Copyrighted free use' } } }] },
    3: { index: 3, title: 'File:Nolicence.jpg', imageinfo: [{ url: 'https://u/n.jpg', descriptionurl: 'https://c/File:N', mime: 'image/jpeg', extmetadata: {} }] },
  } } };
  it('keeps only freely licensed pictures with credit, and warns that matches are unchecked', async () => {
    const found = parseCommons(reply);
    expect(found.map((f) => f.title)).toEqual(['Fair use logo.png', 'Periodic table.svg'].filter((t) => t !== 'Fair use logo.png'));
    expect(found[0]).toMatchObject({ author: 'Jane Doe', license: 'CC BY-SA 4.0', description: 'The periodic table' });
    const md = imagesMarkdown(await findImages('periodic table', (async () => ({ ok: true, json: async () => reply })) as any));
    expect(md).toMatch(/By Jane Doe, CC BY-SA 4\.0\. https:\/\/c\/File:Periodic/);
    expect(md).toMatch(/not checked against your question/);
    expect(imagesMarkdown([])).toMatch(/No freely licensed/);
    await expect(findImages('  ')).rejects.toThrow(/Say what picture/);
  });
});
