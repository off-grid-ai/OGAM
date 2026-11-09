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
