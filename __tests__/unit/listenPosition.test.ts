import { resumeLine } from '../../src/study/listenPosition';

describe('carrying on a briefing from where you stopped', () => {
  const saved = { key: 'daily-brief-1', line: 12 };
  it('starts at the saved line for the same briefing', () => expect(resumeLine(saved, 'daily-brief-1', 40)).toBe(12));
  it('starts at the beginning for a different briefing or nothing saved', () => {
    expect(resumeLine(saved, 'daily-brief-2', 40)).toBe(0);
    expect(resumeLine(null, 'daily-brief-1', 40)).toBe(0);
  });
  it('starts at the beginning when the saved line is the last one or outside the briefing', () => {
    expect(resumeLine({ key: 'k', line: 39 }, 'k', 40)).toBe(0);
    expect(resumeLine({ key: 'k', line: 90 }, 'k', 40)).toBe(0);
    expect(resumeLine({ key: 'k', line: -3 }, 'k', 40)).toBe(0);
  });
});
