/**
 * What this phone offers a peer when they ask "what models can you send me".
 *
 * Getting this list wrong is worse than showing nothing. Every entry is a promise: the user taps it, waits
 * through a multi-gigabyte transfer over their own network, and expects a model that RUNS on the other device.
 * The three ways to break that promise are all decided here:
 *
 *  - offering something the receiver cannot run at all (a LiteRT package to an iPhone),
 *  - offering a package this device cannot actually assemble (a vision model whose projector file is gone -
 *    the peer would receive half a model and a broken load),
 *  - offering a file that was never a model package to begin with.
 *
 * Real modelTransferService, real modelLibrary reading the real on-disk registry, real shared transfer rules.
 * The models live in an in-memory filesystem (memfs, through the repo's RNFS boundary) and the native TCP
 * module is stood in for; nothing in these cases reaches it, which is the point.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

jest.mock('react-native-fs', () => {
  const { modelTransferFsBoundary } = require('../../utils/modelTransferFsBoundary');
  return {
    __esModule: true,
    default: modelTransferFsBoundary.module,
    ...modelTransferFsBoundary.module,
  };
});

import { proIsPresent } from '../helpers/requirePro';

const describePro = proIsPresent() ? describe : describe.skip;
const REGISTRY_KEY = '@local_llm/downloaded_models';

type Model = Record<string, unknown>;

const gguf = (over: Model = {}): Model => ({
  id: 'gemma-text',
  name: 'Gemma 4 E2B',
  author: 'google',
  engine: 'llama',
  fileName: 'gemma.gguf',
  filePath: '/docs/models/gemma.gguf',
  fileSize: 2048,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

/** Seed the on-disk registry and the files it points at, then ask what is offerable. */
async function offers(models: Model[], receiverPlatform?: string): Promise<string[]> {
  jest.resetModules();
  const { modelTransferFsBoundary } = require('../../utils/modelTransferFsBoundary');
  modelTransferFsBoundary.reset();
  for (const model of models) {
    const path = model.filePath as string;
    modelTransferFsBoundary.module.mkdir(path.slice(0, path.lastIndexOf('/')));
    modelTransferFsBoundary.module.writeFile(path, 'x'.repeat(Number(model.fileSize) || 8), 'utf8');
    // A projector file exists only when the fixture says it does; a vision model missing it is a real case.
    if (model.mmProjPath && model.mmProjExistsOnDisk !== false) {
      modelTransferFsBoundary.module.writeFile(model.mmProjPath as string, 'p'.repeat(64), 'utf8');
    }
  }
  await AsyncStorage.setItem(
    REGISTRY_KEY,
    JSON.stringify(models.map(({ mmProjExistsOnDisk: _drop, ...rest }) => rest)),
  );

  const {
    modelTransferService,
  } = require('../../../pro/sync/modelTransferService') as typeof import('../../../pro/sync/modelTransferService');
  const offered = await modelTransferService.getTransferableModels(receiverPlatform as never);
  return offered.map(entry => entry.id);
}

describePro('what this phone offers a peer', () => {
  it('offers a plain GGUF text model', async () => {
    expect(await offers([gguf()])).toContain('gemma-text');
  });

  it('offers a vision model when its projector file is really there', async () => {
    const offered = await offers([
      gguf({
        id: 'gemma-vision',
        mmProjPath: '/docs/models/gemma-mmproj.gguf',
        mmProjFileName: 'gemma-mmproj.gguf',
        mmProjFileSize: 64,
      }),
    ]);

    expect(offered).toContain('gemma-vision');
  });

  it('does NOT offer a vision model whose projector file is gone', async () => {
    // The registry still claims a projector; the file is not on disk and its size cannot be read. Offering it
    // would send the peer half a model: the transfer succeeds and the load fails on the other device.
    const offered = await offers([
      gguf({
        id: 'gemma-vision-broken',
        mmProjPath: '/docs/models/missing-mmproj.gguf',
        mmProjFileName: undefined,
        mmProjFileSize: undefined,
        mmProjExistsOnDisk: false,
      }),
    ]);

    expect(offered).not.toContain('gemma-vision-broken');
  });

  it('does NOT offer a LiteRT model, which is not a GGUF package', async () => {
    const offered = await offers([
      gguf({
        id: 'litert-model',
        engine: 'litert',
        fileName: 'model.litertlm',
        filePath: '/docs/models/model.litertlm',
      }),
    ]);

    expect(offered).not.toContain('litert-model');
  });

  it('does NOT offer a file that is not a GGUF at all', async () => {
    const offered = await offers([
      gguf({ id: 'not-a-model', fileName: 'notes.txt', filePath: '/docs/models/notes.txt' }),
    ]);

    expect(offered).not.toContain('not-a-model');
  });

  it('offers nothing when this phone has downloaded nothing', async () => {
    expect(await offers([])).toEqual([]);
  });
});
