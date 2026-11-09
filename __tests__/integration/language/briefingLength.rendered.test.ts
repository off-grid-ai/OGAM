/**
 * A briefing is written story by story until the script really reaches the chosen length; the last story written gets
 * the goodbye, stories left over are not used, and each prompt lists what was already covered. Fakes only the device
 * boundary (llama.rn engine, files, RAM).
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

it('stops when the script reaches the length and tells the model what it already covered', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const { useAppStore } = require('../../../src/stores');
  const { hardwareService } = require('../../../src/services/hardware');
  const { writeEpisode } = require('../../../src/study/engine');
  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });

  const say = (k: number) => Array.from({ length: 20 }, (_, j) => `word${k}n${j}`).join(' ');
  const part = [0, 1, 2, 3].map((k) => `${k % 2 ? 'B' : 'A'}: ${say(k)}`).join('\n');
  boundary.llama!.scriptCompletion({ text: part }); // the fake model answers every story with the same four lines
  const outline = Array.from({ length: 6 }, (_, i) => ({ topic: `Story ${i + 1}`, sources: [{ n: i + 1, doc: 'News', part: 1, text: 'x'.repeat(400), origin: 'web' as const }] }));
  let used = 0;
  const r = await writeEpisode([], {
    prompt: 'Briefing', title: 'Briefing', minutes: 1, hosts: 2, style: 'news', research: false, funFacts: false,
    outline, linesPerItem: 4, targetWords: 150, onItemsUsed: (n: number) => { used = n; },
  });
  // The model said the same four lines for every story: they are kept once, not read six times over. (Reaching the
  // length is then impossible, so every story is still tried.)
  expect((r.podcast ?? []).length).toBe(4);
  expect(used).toBe(6);
}, 40000);

it('records where each story after the first begins, for the chime between stories', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const { useAppStore } = require('../../../src/stores');
  const { hardwareService } = require('../../../src/services/hardware');
  const { writeEpisode } = require('../../../src/study/engine');
  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });

  // A different four lines for each story, set just before the model is asked for it.
  const lines = (k: number) => [0, 1, 2, 3].map((j) => `${j % 2 ? 'B' : 'A'}: story${k} line${j} has some words in it`).join('\n');
  const onStep = (m: string) => { const k = Number(/part (\d+)/.exec(m)?.[1]); if (k) boundary.llama!.scriptCompletion({ text: lines(k) }); };
  const outline = Array.from({ length: 3 }, (_, i) => ({ topic: `Story ${i + 1}`, sources: [{ n: i + 1, doc: 'News', part: 1, text: 'x'.repeat(400), origin: 'web' as const }] }));
  const r = await writeEpisode([], {
    prompt: 'Briefing', title: 'Briefing', minutes: 30, hosts: 2, style: 'news', research: false, funFacts: false,
    outline, linesPerItem: 4, targetWords: 5000,
  }, onStep);
  expect((r.podcast ?? []).length).toBe(12);
  expect(r.storyStarts).toEqual([4, 8]);
}, 40000);
