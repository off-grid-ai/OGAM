import type { ModelsSnapshot } from '@offgrid/application';
import { projectModelFileCardState } from '../../../src/screens/ModelsScreen/modelFileCardState';

const file = {
  name: 'gemma-Q4_K_M.gguf',
  size: 1_000,
  quantization: 'Q4_K_M',
  downloadUrl: 'https://models.test/gemma-Q4_K_M.gguf',
  mmProjFile: {
    name: 'mmproj-gemma.gguf',
    size: 100,
    downloadUrl: 'https://models.test/mmproj-gemma.gguf',
  },
};

test('the Models card reads active projector progress from the Shared operation', () => {
  const operations: ModelsSnapshot['operations']['active'] = [{
    operationId: 'repair-1',
    kind: 'projector_repair',
    state: 'active',
    modality: 'vision',
    modelId: 'org/gemma/gemma-Q4_K_M.gguf',
    progress: {
      bytesDownloaded: 40,
      totalBytes: 100,
      percent: 40,
      bytesPerSecond: 20,
    },
  }];

  const state = projectModelFileCardState({
    modelId: 'org/gemma',
    file,
    downloads: [],
    projectorRepairs: operations,
    downloaded: true,
    downloadedModel: {
      id: 'org/gemma/gemma-Q4_K_M.gguf',
      name: 'Gemma',
      fileName: file.name,
      filePath: '/models/gemma-Q4_K_M.gguf',
      fileSize: file.size,
      quantization: file.quantization,
      author: 'org',
      downloadedAt: '2026-09-09T00:00:00.000Z',
      engine: 'llama',
      isVisionModel: true,
    },
    locallyRepairing: false,
  });

  expect(state.repairingVision).toBe(true);
  expect(state.repairOperationId).toBe('repair-1');
  expect(state.progress).toEqual(expect.objectContaining({
    progress: 0.4,
    bytesDownloaded: 40,
    totalBytes: 100,
    bytesPerSecond: 20,
  }));
});
