import RNFS from 'react-native-fs';

async function sizeOf(path: string): Promise<number> {
  const items = await RNFS.readDir(path).catch(() => []);
  let total = 0;
  for (const item of items) {
    total += item.isDirectory()
      ? await sizeOf(item.path)
      : typeof item.size === 'string'
      ? Number.parseInt(item.size, 10)
      : item.size;
  }
  return total;
}

/** Owns only OS-designated temporary files; user data and model directories are out of scope. */
export const storageCache = {
  usedBytes: (): Promise<number> => sizeOf(RNFS.CachesDirectoryPath),
  async clear(): Promise<void> {
    const items = await RNFS.readDir(RNFS.CachesDirectoryPath).catch(() => []);
    await Promise.all(items.map(item => RNFS.unlink(item.path)));
  },
};
