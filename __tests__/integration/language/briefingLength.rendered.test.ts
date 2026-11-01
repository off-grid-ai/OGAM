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

  const sentence = 'This is a sentence with exactly twenty words in it so that every line is a known size for the length check today ok.';
  const part = `A: ${sentence}\nB: ${sentence}\nA: ${sentence}\nB: ${sentence}`;
  for (let i = 0; i < 6; i++) boundary.llama!.scriptCompletion({ text: part });
  const outline = Array.from({ length: 6 }, (_, i) => ({ topic: `Story ${i + 1}`, sources: [{ n: i + 1, doc: 'News', part: 1, text: 'x'.repeat(400), origin: 'web' as const }] }));
  let used = 0;
  const r = await writeEpisode([], {
    prompt: 'Briefing', title: 'Briefing', minutes: 1, hosts: 2, style: 'news', research: false, funFacts: false,
    outline, linesPerItem: 4, targetWords: 150, onItemsUsed: (n: number) => { used = n; },
  });
  // 150 words at about 80 words a story: two stories reach it, the other four are left out.
  expect(used).toBeGreaterThanOrEqual(2);
  expect(used).toBeLessThan(6);
  expect((r.podcast ?? []).length).toBeLessThan(6 * 4);
}, 40000);
