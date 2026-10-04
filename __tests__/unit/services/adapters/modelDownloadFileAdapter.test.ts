import { installNativeBoundary } from '../../../harness/nativeBoundary';

describe('ModelDownloadFileAdapter filesystem I/O', () => {
  it('uses the canonical SHA-256 fact supplied by the native filesystem', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const { ModelDownloadFileAdapter } =
      require('../../../../src/services/adapters/downloads/modelDownloadFileAdapter') as typeof import('../../../../src/services/adapters/downloads/modelDownloadFileAdapter');
    const adapter = new ModelDownloadFileAdapter('/docs');
    const path = '/docs/model.bin';
    boundary.fs!.seedTextFile(path, 'verified model bytes');
    boundary.fs!.setReportedHash(path, 'sha256', 'a'.repeat(64));

    await expect(adapter.sha256(path)).resolves.toBe('a'.repeat(64));
    expect(boundary.fs!.module.hash).toHaveBeenCalledWith(path, 'sha256');
  });

  it('maps a native hashing failure to a stable filesystem error', async () => {
    const boundary = installNativeBoundary({ fs: true });
    boundary.fs!.module.hash.mockRejectedValueOnce('native unavailable');
    const { ModelDownloadFileAdapter } =
      require('../../../../src/services/adapters/downloads/modelDownloadFileAdapter') as typeof import('../../../../src/services/adapters/downloads/modelDownloadFileAdapter');
    const adapter = new ModelDownloadFileAdapter('/docs');

    await expect(adapter.sha256('/docs/model.bin')).rejects.toThrow(
      'Could not calculate SHA-256 for /docs/model.bin: native unavailable',
    );
  });

  it('delegates partial cleanup to the canonical idempotent removal path', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const { ModelDownloadFileAdapter } =
      require('../../../../src/services/adapters/downloads/modelDownloadFileAdapter') as typeof import('../../../../src/services/adapters/downloads/modelDownloadFileAdapter');
    const adapter = new ModelDownloadFileAdapter('/docs');
    const path = '/docs/offgrid-download-staging/model.part';
    boundary.fs!.seedFile(path, 128);

    await adapter.removePartial(path);
    await adapter.removePartial(path);

    expect(await boundary.fs!.exists(path)).toBe(false);
    expect(boundary.fs!.module.unlink).toHaveBeenCalledTimes(1);
  });
});
