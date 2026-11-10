/**
 * Podcast and briefing lines play from audio saved ahead of time, in each host's voice,
 * rendered a few lines ahead of what is playing, so there is no wait before a line. Fakes
 * only the device boundary: the voice engine, files and the audio output.
 */
const mockFiles = new Set<string>();
const mockRendered: string[] = [];
const mockPlayed: string[] = [];
const mockRates: number[] = [];
let mockFailDecode = false;
jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  exists: jest.fn(async (p: string) => mockFiles.has(p)),
  mkdir: jest.fn(async () => undefined),
  readDir: jest.fn(async () => Array.from({ length: 9 }, (_, i) => ({
    path: `/cache/podcast-audio/ep${i}`, isDirectory: () => true, mtime: new Date(1000 * i),
  }))),
  unlink: jest.fn(async (p: string) => { mockDeleted.push(p); }),
  writeFile: jest.fn(async (p: string) => { mockFiles.add(p); mockWritten.push(p); }),
}));
const mockWritten: string[] = [];
const mockDeleted: string[] = [];
jest.mock('react-native-audio-api', () => ({
  AudioContext: jest.fn().mockImplementation(() => ({
    destination: {},
    decodeAudioData: jest.fn(async (path: string) => { if (mockFailDecode) throw new Error('cannot decode'); return { path }; }),
    createBufferSource: jest.fn(() => {
      const node: any = { connect: jest.fn(), stop: jest.fn(), onEnded: null, buffer: null, playbackRate: { value: 1 } };
      node.start = jest.fn(() => { mockPlayed.push(node.buffer.path); mockRates.push(node.playbackRate.value); setTimeout(() => node.onEnded?.(), 0); });
      return node;
    }),
  })),
}));

import { NativeModules, Platform } from 'react-native';

beforeAll(() => {
  Platform.OS = 'android';
  NativeModules.AtlasTts = {
    setRate: jest.fn(async () => true),
    setVoice: jest.fn(async (v: string) => { (NativeModules.AtlasTts as any).voice = v; return true; }),
    synthesizeToFile: jest.fn(async (text: string, out: string) => {
      mockRendered.push(`${(NativeModules.AtlasTts as any).voice}:${text}`);
      mockFiles.add(out);
      return out;
    }),
    addListener: jest.fn(), removeListeners: jest.fn(),
  };
});

it('plays each line from a file rendered ahead in its host voice, without rendering it twice', async () => {
  const { playLine } = require('../../../src/atlasVoice/podcastAudio');
  const items = [
    { text: 'Welcome to the news.', pitch: 1, voice: 'sid:0' },
    { text: 'Thanks, here is the first story.', pitch: 1, voice: 'sid:9' },
    { text: 'And the second one.', pitch: 1, voice: 'sid:0' },
    { text: 'Goodbye.', pitch: 1, voice: 'sid:9' },
    { text: 'Extra line.', pitch: 1, voice: 'sid:0' },
  ];
  expect(await playLine('daily-brief-1', items, 0)).toBe(true);
  // Line 0 plus the next three, in order, each in its own voice.
  await new Promise((r) => setTimeout(r, 10));
  expect(mockRendered).toEqual([
    'sid:0:Welcome to the news.', 'sid:9:Thanks, here is the first story.', 'sid:0:And the second one.', 'sid:9:Goodbye.',
  ]);
  expect(mockPlayed[0]).toMatch(/^\/cache\/podcast-audio\/daily-brief-1\/0-/);
  expect(await playLine('daily-brief-1', items, 1)).toBe(true);
  await new Promise((r) => setTimeout(r, 10));
  expect(mockRendered).toHaveLength(5); // only the new line ahead (4) was rendered
  expect(mockPlayed[1]).toMatch(/\/1-/);
});

it('keeps the audio of only the newest episodes', async () => {
  const { pruneEpisodes } = require('../../../src/atlasVoice/podcastAudio');
  await pruneEpisodes('ep0');
  // ep0 is the one being rendered: kept. Of the other eight, the five newest are kept.
  expect(mockDeleted.sort()).toEqual(['/cache/podcast-audio/ep1', '/cache/podcast-audio/ep2', '/cache/podcast-audio/ep3']);
});

it('says a line live when its saved audio cannot be played, instead of ending the podcast', async () => {
  const { playLine } = require('../../../src/atlasVoice/podcastAudio');
  const { useAtlasVoiceStore } = require('../../../src/atlasVoice/store');
  const spoken: string[] = [];
  (NativeModules.AtlasTts as any).speak = jest.fn(async (text: string, key: string) => {
    spoken.push(text);
    // The engine says the line, then reports it finished.
    setTimeout(() => useAtlasVoiceStore.getState().setSpeaking(null), 0);
    return key;
  });
  const items = [{ text: 'Broken file line.', pitch: 1, voice: 'sid:4' }];
  mockFailDecode = true;
  try {
    await playLine('fallback-episode', items, 0);
  } finally { mockFailDecode = false; }
  expect(spoken).toEqual(['Broken file line.']);
});

it('makes a jingle file once and plays it each time', async () => {
  const { playJingle } = require('../../../src/atlasVoice/podcastAudio');
  mockWritten.length = 0; mockPlayed.length = 0;
  expect(await playJingle('intro')).toBe(true);
  expect(await playJingle('intro')).toBe(true);
  expect(mockWritten).toEqual(['/cache/podcast-audio/_jingles/intro-normal-v2.wav']);
  expect(mockPlayed).toHaveLength(2);
});

it('a jingle that cannot be played never stops the show', async () => {
  const { playJingle } = require('../../../src/atlasVoice/podcastAudio');
  mockFailDecode = true;
  try { expect(await playJingle('intro')).toBe(true); } finally { mockFailDecode = false; }
});

it('plays saved lines at the chosen speed', async () => {
  const { playLine, setPodcastSpeed } = require('../../../src/atlasVoice/podcastAudio');
  mockRates.length = 0;
  const items = [{ text: 'Speed line.', pitch: 1, voice: 'sid:0' }];
  try {
    setPodcastSpeed(1.25);
    await playLine('speed-episode', items, 0);
    setPodcastSpeed(1);
    await playLine('speed-episode', items, 0);
  } finally { setPodcastSpeed(1); }
  expect(mockRates).toEqual([1.25, 1]);
});

it('a jingle that never reports its end is cut off after its length plus a few seconds', async () => {
  jest.useFakeTimers();
  try {
    const { playJingle } = require('../../../src/atlasVoice/podcastAudio');
    const { AudioContext } = require('react-native-audio-api');
    // A source that never fires onEnded.
    AudioContext.mockImplementationOnce(() => ({
      destination: {}, decodeAudioData: jest.fn(async (path: string) => ({ path })),
      createBufferSource: jest.fn(() => ({ connect: jest.fn(), stop: jest.fn(), start: jest.fn(), onEnded: null, buffer: null })),
    }));
    jest.resetModules();
    const fresh = require('../../../src/atlasVoice/podcastAudio');
    const done = fresh.playJingle('chime');
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(done).resolves.toBe(true);
    void playJingle;
  } finally { jest.useRealTimers(); }
});

it('makes a separate file for each volume', async () => {
  const { playJingle } = require('../../../src/atlasVoice/podcastAudio');
  mockWritten.length = 0;
  await playJingle('chime', 'quiet');
  await playJingle('chime', 'loud');
  expect(mockWritten).toEqual(['/cache/podcast-audio/_jingles/chime-quiet-v2.wav', '/cache/podcast-audio/_jingles/chime-loud-v2.wav']);
});
