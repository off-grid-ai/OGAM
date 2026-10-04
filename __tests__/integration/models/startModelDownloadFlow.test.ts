/**
 * startModelDownload through the real Shared application and Mobile projections.
 * Only the native download and filesystem boundaries are faked.
 */
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import {
  installNativeBoundary,
  type DownloadFake,
} from '../../harness/nativeBoundary';

const FILE = {
  name: 'model.Q4_K_M.gguf',
  size: 1_024,
  quantization: 'Q4_K_M',
  downloadUrl:
    'https://huggingface.co/author/model/resolve/main/model.Q4_K_M.gguf',
};

let boundary: DownloadFake;
let fixture: MobileApplicationFixture | null = null;
let startModelDownload: typeof import('../../../src/services/startModelDownload')['startModelDownload'];

const repositoryResponse = () =>
  ({
    ok: true,
    json: async () => ({
      siblings: [{ rfilename: FILE.name, lfs: { size: FILE.size } }],
    }),
  } as Response);

function downloads() {
  if (!fixture) throw new Error('Mobile application fixture is not started');
  return fixture.application.models.snapshot().control.downloads;
}

function downloadedModels() {
  if (!fixture) throw new Error('Mobile application fixture is not started');
  return fixture.application.models.snapshot().inventory;
}

async function settle(assertion: () => void): Promise<void> {
  let failure: unknown;
  for (let turn = 0; turn < 30; turn += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      failure = error;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
  throw failure;
}

beforeEach(async () => {
  const installed = installNativeBoundary({ download: true, fs: true });
  boundary = installed.download!;
  jest.spyOn(global, 'fetch').mockResolvedValue(repositoryResponse());
  const mobileFixture =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await mobileFixture.seedMobileDownloadJournal([]);
  fixture = await mobileFixture.startMobileApplicationFixture();
  ({ startModelDownload } =
    require('../../../src/services/startModelDownload') as typeof import('../../../src/services/startModelDownload'));
  boundary.module.startDownload.mockClear();
});

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
  jest.restoreAllMocks();
});

describe('startModelDownload flow (real application)', () => {
  it('completion registers the model and leaves no in-flight entry', async () => {
    await startModelDownload('author/model', FILE);
    const transferId = boundary.active()[0].downloadId;

    boundary.complete(transferId);

    await settle(() => {
      expect(
        downloadedModels().some(
          model => model.id === 'author/model/model.Q4_K_M.gguf',
        ),
      ).toBe(true);
      expect(downloads()).toEqual([
        expect.objectContaining({
          status: 'completed',
          bytesDownloaded: FILE.size,
          totalBytes: FILE.size,
          localUri: `/docs/models/${FILE.name}`,
        }),
      ]);
    });
  });

  it('does not start a second download when one is already active', async () => {
    await startModelDownload('author/model', FILE);
    await startModelDownload('author/model', FILE);

    expect(boundary.module.startDownload).toHaveBeenCalledTimes(1);
  });

  it('publishes preparation before the native transfer starts', async () => {
    let release!: () => void;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          release = () => resolve(repositoryResponse());
        }),
    );

    const starting = startModelDownload('author/model', FILE);
    await settle(() => {
      expect(downloads()).toEqual([
        expect.objectContaining({
          status: 'preparing',
          modelId: 'author/model',
          fileName: FILE.name,
        }),
      ]);
      expect(boundary.active()).toEqual([]);
    });
    release();
    await starting;
  });

  it('dedups a rapid second tap while the first is preparing', async () => {
    let release!: () => void;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          release = () => resolve(repositoryResponse());
        }),
    );

    const first = startModelDownload('author/model', FILE);
    await settle(() =>
      expect(downloads()).toEqual([
        expect.objectContaining({
          status: 'preparing',
          modelId: 'author/model',
          fileName: FILE.name,
        }),
      ]),
    );
    const second = startModelDownload('author/model', FILE);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(downloads()).toHaveLength(1);
    expect(boundary.active()).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(boundary.module.startDownload).toHaveBeenCalledTimes(1);
  });

  it('projects failed when the native transfer reports an error', async () => {
    await startModelDownload('author/model', FILE);
    boundary.fail(boundary.active()[0].downloadId, 'net');

    await settle(() => {
      expect(downloads()).toEqual([
        expect.objectContaining({ status: 'failed', reason: 'net' }),
      ]);
    });
  });
});
