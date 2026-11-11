/**
 * The briefing asks the AI on the phone which headlines are about a topic to avoid, so stories the word lists miss
 * ("Bears" never says sports) are dropped. Fakes only the device boundary (llama.rn engine, files, RAM).
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

it('drops the headlines the AI says are about a topic to avoid', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const { useAppStore } = require('../../../src/stores');
  const { hardwareService } = require('../../../src/services/hardware');
  const { aiScreen } = require('../../../src/atlasTools/dailyBrief');
  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });

  boundary.llama!.scriptCompletion({ text: '2' });
  const dropped = await aiScreen(['Mars water found', 'Local team clinches playoff spot', 'New battery doubles range'], ['sports']);
  expect([...dropped]).toEqual([1]);

  // No topics to avoid means nothing is asked.
  expect((await aiScreen(['Mars water found'], [])).size).toBe(0);
}, 40000);
