import { Buffer } from 'buffer';
import { createHash } from 'node:crypto';
import { createNativeFileSystemBoundary } from './nativeFileSystem';

describe('native filesystem boundary', () => {
  it('writes bytes at their requested position without replacing adjacent bytes', async () => {
    const fileSystem = createNativeFileSystemBoundary();
    const path = `${fileSystem.DocumentDirectoryPath}/positioned.bin`;

    await fileSystem.module.writeFile(path, 'abcdef', 'utf8');
    await fileSystem.module.write(
      path,
      Buffer.from('XY').toString('base64'),
      2,
      'base64',
    );

    await expect(fileSystem.readAscii(path, 6)).resolves.toBe('abXYef');
    await expect(fileSystem.module.stat(path)).resolves.toEqual(
      expect.objectContaining({ size: 6 }),
    );
  });

  it('extends a file when a positioned write starts after its current end', async () => {
    const fileSystem = createNativeFileSystemBoundary();
    const path = `${fileSystem.DocumentDirectoryPath}/extended.bin`;

    await fileSystem.module.write(path, 'QQ==', 3, 'base64');

    await expect(fileSystem.module.stat(path)).resolves.toEqual(
      expect.objectContaining({ size: 4 }),
    );
    await expect(fileSystem.module.read(path, 4, 0, 'base64')).resolves.toBe(
      'AAAAQQ==',
    );
  });

  it('preserves logical bytes through hashing, copying, moving, and appending', async () => {
    const fileSystem = createNativeFileSystemBoundary();
    const source = `${fileSystem.DocumentDirectoryPath}/source.bin`;
    const copied = `${fileSystem.DocumentDirectoryPath}/copied.bin`;
    const moved = `${fileSystem.DocumentDirectoryPath}/moved.bin`;

    await fileSystem.module.write(source, 'QQ==', 3, 'base64');
    await expect(fileSystem.module.hash(source, 'sha256')).resolves.toBe(
      createHash('sha256')
        .update(Buffer.from([0, 0, 0, 65]))
        .digest('hex'),
    );

    await fileSystem.module.copyFile(source, copied);
    await expect(fileSystem.module.stat(copied)).resolves.toEqual(
      expect.objectContaining({ size: 4 }),
    );
    await expect(fileSystem.module.read(copied, 4, 0, 'base64')).resolves.toBe(
      'AAAAQQ==',
    );

    await fileSystem.module.moveFile(copied, moved);
    await fileSystem.module.appendFile(moved, 'Qg==', 'base64');
    await expect(fileSystem.module.stat(moved)).resolves.toEqual(
      expect.objectContaining({ size: 5 }),
    );
    await expect(fileSystem.module.read(moved, 5, 0, 'base64')).resolves.toBe(
      'AAAAQUI=',
    );
  });
});
