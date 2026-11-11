import { playEpisode } from '../../src/study/playEpisode';

const make = (over: Partial<Parameters<typeof playEpisode>[1]> = {}) => {
  const log: string[] = [];
  const hooks = {
    stopped: () => false,
    jingle: async (k: string) => { log.push(`jingle:${k}`); return true; },
    onLine: (i: number) => { log.push(`on:${i}`); },
    line: async (i: number) => { log.push(`line:${i}`); return true; },
    ...over,
  } as Parameters<typeof playEpisode>[1];
  return { log, hooks };
};

describe('playing an episode', () => {
  it('plays every line in order and says it finished', async () => {
    const { log, hooks } = make();
    expect(await playEpisode({ count: 3, from: 0 }, hooks)).toBe(true);
    expect(log).toEqual(['on:0', 'line:0', 'on:1', 'line:1', 'on:2', 'line:2']);
  });
  it('a briefing opens with a tune, chimes at each story start after the first line played, and closes with a tune', async () => {
    const { log, hooks } = make();
    expect(await playEpisode({ count: 4, from: 0, tunes: { storyStarts: [0, 2] } }, hooks)).toBe(true);
    expect(log).toEqual(['jingle:intro', 'on:0', 'line:0', 'on:1', 'line:1', 'jingle:chime', 'on:2', 'line:2', 'on:3', 'line:3', 'jingle:outro']);
  });
  it('starting from the middle plays no opening tune and no chime for the line it starts on', async () => {
    const { log, hooks } = make();
    await playEpisode({ count: 3, from: 2, tunes: { storyStarts: [2] } }, hooks);
    expect(log).toEqual(['on:2', 'line:2', 'jingle:outro']);
  });
  it('stops when a line reports it was stopped, with no closing tune, and is not finished', async () => {
    const { log, hooks } = make({ line: async (i: number) => i < 1 });
    expect(await playEpisode({ count: 4, from: 0, tunes: { storyStarts: [] } }, hooks)).toBe(false);
    expect(log).not.toContain('jingle:outro');
  });
  it('stops at once when the opening tune says playback was stopped', async () => {
    const { log, hooks } = make({ jingle: async () => false });
    expect(await playEpisode({ count: 2, from: 0, tunes: { storyStarts: [] } }, hooks)).toBe(false);
    expect(log).toEqual([]);
  });
  it('does not start a line once playback was stopped', async () => {
    const { log, hooks } = make({ stopped: () => true });
    expect(await playEpisode({ count: 2, from: 0 }, hooks)).toBe(false);
    expect(log).toEqual([]);
  });
});
