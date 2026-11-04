import { withoutRepeats } from '../../src/study/engine';
import { greetingLine } from '../../src/atlasTools/dailyBrief';
import { briefingSummary, briefingTranscript } from '../../src/study/exportFiles';
import { linesPerStory, storyBudget, WORDS_PER_MINUTE } from '../../src/atlasTools/newsSources';

describe('briefing fixes', () => {
  it('drops a line said again, even reworded slightly', () => {
    const before = [{ host: 'A' as const, text: 'Iran has named a new negotiator for the stalled nuclear talks in Geneva.' }];
    const fresh = [
      { host: 'B' as const, text: 'Iran has named a new negotiator for the stalled nuclear talks in Geneva!' },
      { host: 'B' as const, text: 'Hinojosa says she will keep campaigning against Abbott.' },
    ];
    expect(withoutRepeats(fresh, before).map((l) => l.text)).toEqual([fresh[1].text]);
  });
  it('opens with the weekday, date and year', () => {
    expect(greetingLine(new Date(2026, 10, 4, 8))).toBe('Good morning. Today is Wednesday, November 4, 2026, and this is your briefing.');
  });
  it('sizes a 15 minute briefing to about 15 minutes of words', () => {
    const stories = storyBudget(15, true);
    expect(stories * linesPerStory(15, stories) * 20).toBeGreaterThanOrEqual(15 * WORDS_PER_MINUTE * 0.95);
  });
  it('exports the script in order and a story summary', () => {
    const r: any = { kind: 'podcast', createdAt: 1, sources: [], hosts: 2, minutes: 15,
      podcast: [{ host: 'A', text: 'First.' }, { host: 'B', text: 'Second.' }],
      headlines: [{ title: 'Floods hit Texas', source: 'AP', interest: 'world', url: 'https://x.test/a' }] };
    const t = briefingTranscript(r, 'Daily briefing - Wednesday');
    expect(t.indexOf('First.')).toBeLessThan(t.indexOf('Second.'));
    expect(t).toContain('about 15 min');
    expect(briefingSummary(r, 'Daily briefing')).toContain('- Floods hit Texas (AP) https://x.test/a');
  });
});
