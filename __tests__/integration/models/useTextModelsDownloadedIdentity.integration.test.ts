import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import {
  installNativeBoundary,
  type NativeBoundary,
} from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));

const REPOSITORY = 'unsloth/gemma-4-E2B-it-GGUF';
const COMPOSITE_FILE = 'gemma-4-E2B-it-Q4_K_M.gguf';
const RECOVERED_FILE = 'gemma-4-E2B-it-Q4_0.gguf';
const RECOVERED_ID = `recovered_${RECOVERED_FILE}_1783000000000`;

let boundary: NativeBoundary;
let fixture: MobileApplicationFixture | null = null;
let RTL: ReturnType<typeof import('../../harness/nativeBoundary').requireRTL>;

beforeEach(async () => {
  boundary = installNativeBoundary({ fs: true, llama: true });
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({}),
  } as Response);
  RTL = require('../../harness/nativeBoundary').requireRTL() as typeof RTL;

  const directory = `${boundary.fs!.DocumentDirectoryPath}/models`;
  const records = [
    {
      id: `${REPOSITORY}/${COMPOSITE_FILE}`,
      name: 'Gemma 4 E2B Q4 K M',
      author: 'unsloth',
      filePath: `${directory}/${COMPOSITE_FILE}`,
      fileName: COMPOSITE_FILE,
      fileSize: 1024,
      quantization: 'Q4_K_M',
      downloadedAt: new Date(0).toISOString(),
      engine: 'llama',
    },
    {
      id: RECOVERED_ID,
      name: 'Gemma 4 E2B Q4 0',
      author: 'unsloth',
      filePath: `${directory}/${RECOVERED_FILE}`,
      fileName: RECOVERED_FILE,
      fileSize: 1024,
      quantization: 'Q4_0',
      downloadedAt: new Date(0).toISOString(),
      engine: 'llama',
    },
  ];
  boundary.fs!.seedFile(records[0].filePath, records[0].fileSize);
  boundary.fs!.seedFile(records[1].filePath, records[1].fileSize);

  const storageModule = require('@react-native-async-storage/async-storage');
  const storage = storageModule.default ?? storageModule;
  await storage.clear();
  await storage.setItem(
    '@local_llm/downloaded_models',
    JSON.stringify(records),
  );

  const { startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  fixture = await startMobileApplicationFixture();
});

afterEach(async () => {
  RTL.cleanup();
  await fixture?.dispose();
  fixture = null;
  jest.restoreAllMocks();
});

describe('useTextModels downloaded identity (real application)', () => {
  it('resolves composite and recovered records by their public file identity', async () => {
    const { useTextModels } =
      require('../../../src/screens/ModelsScreen/useTextModels') as typeof import('../../../src/screens/ModelsScreen/useTextModels');
    const hook = RTL.renderHook(() => useTextModels(jest.fn()));

    await RTL.waitFor(() => {
      expect(
        hook.result.current.isModelDownloaded(REPOSITORY, COMPOSITE_FILE),
      ).toBe(true);
      expect(
        hook.result.current.isModelDownloaded(REPOSITORY, RECOVERED_FILE),
      ).toBe(true);
    });

    await fixture!.refreshModels();
    expect(
      fixture!.application.models.snapshot().inventory.map(model => model.id),
    ).toEqual(
      expect.arrayContaining([`${REPOSITORY}/${COMPOSITE_FILE}`, RECOVERED_ID]),
    );

    expect(
      hook.result.current.getDownloadedModel(REPOSITORY, COMPOSITE_FILE),
    ).toEqual(
      expect.objectContaining({
        id: `${REPOSITORY}/${COMPOSITE_FILE}`,
        quantization: 'Q4_K_M',
      }),
    );
    expect(
      hook.result.current.getDownloadedModel(REPOSITORY, RECOVERED_FILE),
    ).toEqual(
      expect.objectContaining({ id: RECOVERED_ID, quantization: 'Q4_0' }),
    );
  });
});
