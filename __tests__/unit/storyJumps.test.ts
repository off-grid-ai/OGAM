import { storyJumps, currentStory } from '../../src/study/storyJumps';

describe('jump to a story', () => {
  const briefing = { storyStarts: [5, 11], headlines: [{ title: 'Floods hit the coast' }, { title: 'A new telescope sees further than ever before' }, { title: 'Markets close higher' }] };
  it('lists every story, the first one after the greeting', () => {
    expect(storyJumps(briefing)).toEqual([
      { line: 1, label: 'Floods hit the coast' },
      { line: 5, label: 'A new telescope sees furt…' },
      { line: 11, label: 'Markets close higher' },
    ]);
  });
  it('starts the first part at line 0 when there is no greeting, and names parts without headlines', () => {
    expect(storyJumps({ storyStarts: [4] })).toEqual([{ line: 0, label: 'Part 1' }, { line: 4, label: 'Part 2' }]);
  });
  it('shows no chips for a single story', () => expect(storyJumps({ storyStarts: [] })).toEqual([]));
  it('knows which story is playing', () => {
    const j = storyJumps(briefing);
    expect(currentStory(j, null)).toBe(-1);
    expect(currentStory(j, 0)).toBe(-1); // the greeting
    expect(currentStory(j, 3)).toBe(0);
    expect(currentStory(j, 5)).toBe(1);
    expect(currentStory(j, 40)).toBe(2);
  });
});
