import RNFS from 'react-native-fs';
import {
  DownloadInstallTransaction,
  parseInstallRecoveryState,
  type InstallRecoveryState,
} from '../../../src/services/modelServices/downloadInstallTransaction';

const fs = RNFS as jest.Mocked<typeof RNFS>;

describe('model install crash recovery', () => {
  let files: Set<string>;

  beforeEach(async () => {
    jest.clearAllMocks();
    files = new Set();
    fs.exists.mockImplementation(path => Promise.resolve(files.has(String(path))));
    fs.moveFile.mockImplementation(async (source, destination) => {
      const from = String(source);
      if (!files.delete(from)) throw new Error(`missing: ${from}`);
      files.add(String(destination));
    });
    fs.unlink.mockImplementation(async path => {
      if (!files.delete(String(path))) throw new Error(`missing: ${String(path)}`);
    });
  });

  it('restores the prior file after a crash during an unowned promotion', async () => {
    const state: InstallRecoveryState = { version: 1, moves: [{
      source: '/mock/documents/offgrid-download-staging/model',
      destination: '/mock/documents/models/model',
      backup: '/mock/documents/models/model.offgrid-replacement-0',
    }] };
    files.add('/mock/documents/models/model');
    files.add('/mock/documents/offgrid-download-staging/model');
    const transaction = new DownloadInstallTransaction(state);
    await transaction.move(0);

    const recovered = new DownloadInstallTransaction(parseInstallRecoveryState(transaction.recoveryState));
    await recovered.rollback();

    expect(files).toEqual(new Set([
      '/mock/documents/models/model',
      '/mock/documents/offgrid-download-staging/model',
    ]));
  });

  it('restores a backup after a crash before the staged file is promoted', async () => {
    files.add('/mock/documents/models/model.offgrid-replacement-0');
    files.add('/mock/documents/offgrid-download-staging/model');
    const state = JSON.stringify({
      version: 1,
      moves: [{
        source: '/mock/documents/offgrid-download-staging/model',
        destination: '/mock/documents/models/model',
        backup: '/mock/documents/models/model.offgrid-replacement-0',
      }],
    });

    await new DownloadInstallTransaction(parseInstallRecoveryState(state)).rollback();

    expect(files).toEqual(new Set([
      '/mock/documents/models/model',
      '/mock/documents/offgrid-download-staging/model',
    ]));
  });

  it('preserves the last good install when a crash happens before prepare starts', async () => {
    files.add('/mock/documents/image_models/model');
    const state = JSON.stringify({
      version: 1,
      moves: [{
        source: '/mock/documents/offgrid-download-staging/model/prepared-image',
        destination: '/mock/documents/image_models/model',
        backup: '/mock/documents/image_models/model.offgrid-replacement-0',
        discardSourceOnRollback: true,
      }],
    });

    await new DownloadInstallTransaction(parseInstallRecoveryState(state)).rollback();

    expect(files).toEqual(new Set(['/mock/documents/image_models/model']));
  });

  it('restores a registry write that did not reach application ownership', async () => {
    const prior = [{
      id: 'owner/repo/model.gguf',
      name: 'Model',
      author: 'owner',
      filePath: `${RNFS.DocumentDirectoryPath}/models/model.gguf`,
      fileName: 'model.gguf',
      fileSize: 100,
      quantization: 'Q4_K_M',
      downloadedAt: '2026-09-04T00:00:00.000Z',
      engine: 'llama' as const,
    }];
    const restoreTextRegistry = jest.fn(async () => undefined);
    const transaction = new DownloadInstallTransaction({
      version: 1,
      moves: [],
      priorTextModels: prior,
    }, restoreTextRegistry);

    const recovered = new DownloadInstallTransaction(
      parseInstallRecoveryState(transaction.recoveryState),
      restoreTextRegistry,
    );
    await recovered.rollback();

    expect(restoreTextRegistry).toHaveBeenCalledWith(prior);
  });

  it('keeps the new file and removes its backup after ownership is durable', async () => {
    files.add('/mock/documents/models/model');
    files.add('/mock/documents/offgrid-download-staging/model');
    const transaction = new DownloadInstallTransaction({ version: 1, moves: [{
      source: '/mock/documents/offgrid-download-staging/model',
      destination: '/mock/documents/models/model',
      backup: '/mock/documents/models/model.offgrid-replacement-0',
    }] });
    await transaction.move(0);

    await new DownloadInstallTransaction(
      parseInstallRecoveryState(transaction.recoveryState),
    ).commit();

    expect(files).toEqual(new Set(['/mock/documents/models/model']));
  });

  it('keeps recovery state usable when backup cleanup fails and retries it', async () => {
    files.add('/mock/documents/models/model');
    files.add('/mock/documents/offgrid-download-staging/model');
    const transaction = new DownloadInstallTransaction({ version: 1, moves: [{
      source: '/mock/documents/offgrid-download-staging/model',
      destination: '/mock/documents/models/model',
      backup: '/mock/documents/models/model.offgrid-replacement-0',
    }] });
    await transaction.move(0);
    fs.unlink.mockRejectedValueOnce(new Error('disk unavailable'));

    const state = parseInstallRecoveryState(transaction.recoveryState);
    await expect(new DownloadInstallTransaction(state).commit())
      .rejects.toThrow('disk unavailable');

    await new DownloadInstallTransaction(state).commit();
    expect(files).toEqual(new Set(['/mock/documents/models/model']));
  });

  it.each([
    ['unsupported version', JSON.stringify({ version: 2, moves: [] })],
    ['traversal', JSON.stringify({ version: 1, moves: [{ source: '/mock/documents/offgrid-download-staging/../secret', destination: '/mock/documents/models/a', backup: null }] })],
    ['outside root', JSON.stringify({ version: 1, moves: [{ source: '/etc/passwd', destination: '/mock/documents/models/a', backup: null }] })],
    ['wrong destination root', JSON.stringify({ version: 1, moves: [{ source: '/mock/documents/offgrid-download-staging/a', destination: '/mock/documents/private/a', backup: null }] })],
    ['unrelated backup', JSON.stringify({ version: 1, moves: [{ source: '/mock/documents/offgrid-download-staging/a', destination: '/mock/documents/models/a', backup: '/mock/documents/models/b' }] })],
    ['wrong field type', JSON.stringify({ version: 1, moves: [{ source: 4, destination: '/mock/documents/models/a', backup: null }] })],
    ['path collision', JSON.stringify({ version: 1, moves: [
      { source: '/mock/documents/offgrid-download-staging/a', destination: '/mock/documents/models/a', backup: null },
      { source: '/mock/documents/offgrid-download-staging/a', destination: '/mock/documents/models/b', backup: null },
    ] })],
    ['invalid registry row', JSON.stringify({ version: 1, moves: [], priorTextModels: [{ id: 'only-an-id' }] })],
    ['registry path outside app storage', JSON.stringify({
      version: 1,
      moves: [],
      priorTextModels: [{
        id: 'owner/repo/model.gguf',
        name: 'Model',
        author: 'owner',
        filePath: '/private/arbitrary/model.gguf',
        fileName: 'model.gguf',
        fileSize: 100,
        quantization: 'Q4_K_M',
        downloadedAt: '2026-09-04T00:00:00.000Z',
        engine: 'llama',
      }],
    })],
  ])('rejects hostile %s recovery state', (_name, state) => {
    expect(() => parseInstallRecoveryState(state)).toThrow();
  });

  it('rejects oversized recovery state', () => {
    expect(() => parseInstallRecoveryState('x'.repeat(2_000_001))).toThrow('too large');
  });
});
