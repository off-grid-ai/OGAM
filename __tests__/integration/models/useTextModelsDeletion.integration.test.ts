import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));

const FILE = {
  name: 'delete-me.Q4_K_M.gguf',
  size: 1024,
  quantization: 'Q4_K_M',
  downloadUrl: 'https://huggingface.co/author/delete-me/resolve/main/delete-me.Q4_K_M.gguf',
};

let fixture: MobileApplicationFixture | null = null;
let boundary: ReturnType<typeof installNativeBoundary>;
let RTL: ReturnType<typeof import('../../harness/nativeBoundary').requireRTL>;
let useTextModels: typeof import('../../../src/screens/ModelsScreen/useTextModels')['useTextModels'];

async function settle(assertion: () => void): Promise<void> {
  let failure: unknown;
  for (let turn = 0; turn < 40; turn += 1) {
    try { assertion(); return; } catch (error) { failure = error; }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw failure;
}

beforeEach(async () => {
  boundary = installNativeBoundary({ download: true, fs: true, llama: true });
  RTL = (require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary')).requireRTL();
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ siblings: [{ rfilename: FILE.name, lfs: { size: FILE.size } }] }),
  } as Response);
  const mobileFixture = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await mobileFixture.seedMobileDownloadJournal([]);
  fixture = await mobileFixture.startMobileApplicationFixture();
  ({ useTextModels } = require('../../../src/screens/ModelsScreen/useTextModels'));
});

afterEach(async () => {
  RTL.cleanup();
  await fixture?.dispose();
  fixture = null;
  jest.restoreAllMocks();
});

async function installModel(repositoryId: string) {
  const { startModelDownload } = require('../../../src/services/startModelDownload') as typeof import('../../../src/services/startModelDownload');
  await startModelDownload(repositoryId, FILE);
  const transfer = boundary.download!.active()[0];
  expect(transfer).toBeDefined();
  boundary.download!.complete(transfer.downloadId);
  await settle(() => expect(
    fixture!.application.models.snapshot().inventory.some(model => model.id.includes(repositoryId)),
  ).toBe(true));
  const model = fixture!.application.models.snapshot().inventory.find(row => row.id.includes(repositoryId))!;
  return { model, path: `${boundary.fs!.DocumentDirectoryPath}/models/${FILE.name}` };
}

async function deleteThroughHook(modelId: string) {
  const setAlertState = jest.fn();
  const hook = RTL.renderHook(() => useTextModels(setAlertState));
  await RTL.act(async () => { await hook.result.current.handleDeleteModel(modelId); });
  expect(setAlertState).not.toHaveBeenCalled();
}

async function startDownload(repositoryId: string) {
  const { startModelDownload } = require('../../../src/services/startModelDownload') as typeof import('../../../src/services/startModelDownload');
  await startModelDownload(repositoryId, FILE);
  const row = fixture!.application.models.snapshot().control.downloads.find(
    downloadRow => downloadRow.modelId === repositoryId && downloadRow.fileName === FILE.name,
  );
  expect(row).toBeDefined();
  return row!;
}

describe('useTextModels cancellation journeys (real application)', () => {
  it('cancels the selected in-flight artifact through the public projection', async () => {
    const row = await startDownload('author/cancel-me');
    expect(boundary.download!.active()).toHaveLength(1);
    const setAlertState = jest.fn();
    const hook = RTL.renderHook(() => useTextModels(setAlertState));

    await RTL.act(async () => {
      await hook.result.current.handleCancelDownload(`author/cancel-me/${FILE.name}`);
    });

    expect(fixture!.application.models.snapshot().control.downloads.find(
      item => item.downloadId === row.downloadId,
    )?.status).toBe('cancelled');
    expect(boundary.download!.active()).toHaveLength(0);
    expect(setAlertState).not.toHaveBeenCalled();
  });

  it('leaves public download state unchanged for an unknown artifact', async () => {
    await startDownload('author/keep-me');
    const before = fixture!.application.models.snapshot().control.downloads;
    const setAlertState = jest.fn();
    const hook = RTL.renderHook(() => useTextModels(setAlertState));

    await RTL.act(async () => {
      await hook.result.current.handleCancelDownload('author/missing/missing.gguf');
    });

    expect(fixture!.application.models.snapshot().control.downloads).toBe(before);
    expect(boundary.download!.active()).toHaveLength(1);
    expect(setAlertState).not.toHaveBeenCalled();
  });
});

describe('useTextModels deletion journeys (real application)', () => {
  it('deletes the active text model from public inventory and disk', async () => {
    const installed = await installModel('author/active-delete');
    expect(await boundary.fs!.exists(installed.path)).toBe(true);
    const selected = await fixture!.application.models.select({ modality: 'text', modelId: installed.model.id });
    expect(selected.ok).toBe(true);
    await deleteThroughHook(installed.model.id);
    expect(fixture!.application.models.snapshot().inventory.some(row => row.id === installed.model.id)).toBe(false);
    expect(await boundary.fs!.exists(installed.path)).toBe(false);
  });

  it('deletes an inactive text model from public inventory and disk', async () => {
    const installed = await installModel('author/inactive-delete');
    expect(await boundary.fs!.exists(installed.path)).toBe(true);
    expect(fixture!.application.models.snapshot().active.text?.model?.id).not.toBe(installed.model.id);
    await deleteThroughHook(installed.model.id);
    expect(fixture!.application.models.snapshot().inventory.some(row => row.id === installed.model.id)).toBe(false);
    expect(await boundary.fs!.exists(installed.path)).toBe(false);
  });
});
