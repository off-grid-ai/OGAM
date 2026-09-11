import { Buffer } from 'buffer';
import { createHash } from 'node:crypto';
import { Volume } from 'memfs';

export interface NativeFileSystemOptions {
  documentDirectoryPath?: string;
  cachesDirectoryPath?: string;
  externalDirectoryPath?: string;
  externalStorageDirectoryPath?: string;
  mainBundlePath?: string;
}

export interface NativeFileSystemBoundary {
  module: NativeFileSystemModule;
  DocumentDirectoryPath: string;
  reset(): void;
  seedFile(path: string, sizeBytes: number): void;
  seedTextFile(
    path: string,
    contents: string,
    reportedSize?: number | string,
  ): void;
  seedDir(path: string): void;
  setReportedFileSize(path: string, size: number | string): void;
  setReportedHash(path: string, algorithm: string, digest: string): void;
  readAscii(path: string, length: number, position?: number): Promise<string>;
  exists(path: string): Promise<boolean>;
}

interface NativeFileSystemEntry {
  path: string;
  name: string;
  /** RNFS types this as a number, although iOS can report a string at runtime. */
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
  mtime: Date;
}

export interface NativeFileSystemModule {
  DocumentDirectoryPath: string;
  CachesDirectoryPath: string;
  ExternalDirectoryPath: string;
  ExternalStorageDirectoryPath: string;
  MainBundlePath: string;
  exists: jest.Mock<Promise<boolean>, [string]>;
  mkdir: jest.Mock<Promise<void>, [string]>;
  stat: jest.Mock<Promise<NativeFileSystemEntry>, [string]>;
  readDir: jest.Mock<Promise<NativeFileSystemEntry[]>, [string]>;
  writeFile: jest.Mock<Promise<void>, [string, string, string?]>;
  write: jest.Mock<Promise<void>, [string, string, number?, string?]>;
  read: jest.Mock<Promise<string>, [string, number?, number?, string?]>;
  readFile: jest.Mock<Promise<string>, [string, string?]>;
  appendFile: jest.Mock<Promise<void>, [string, string, string?]>;
  unlink: jest.Mock<Promise<void>, [string]>;
  moveFile: jest.Mock<Promise<void>, [string, string]>;
  copyFile: jest.Mock<Promise<void>, [string, string]>;
  copyFileAssets: jest.Mock<Promise<void>, [string, string]>;
  hash: jest.Mock<Promise<string>, [string, string]>;
  getFSInfo: jest.Mock<Promise<{ freeSpace: number; totalSpace: number }>, []>;
  downloadFile: jest.Mock<
    {
      jobId: number;
      promise: Promise<{ statusCode: number; bytesWritten: number }>;
    },
    [Record<string, unknown>?]
  >;
  stopDownload: jest.Mock<void, [number?]>;
}

/**
 * The one RNFS boundary used by node tests.
 *
 * memfs owns the directory tree and byte storage. This adapter only translates that real tree to
 * the `react-native-fs` contract. Off Grid services stay real above this boundary.
 */
export function createNativeFileSystemBoundary(
  options: NativeFileSystemOptions = {},
): NativeFileSystemBoundary {
  const DocumentDirectoryPath = options.documentDirectoryPath ?? '/docs';
  const CachesDirectoryPath = options.cachesDirectoryPath ?? '/caches';
  const ExternalDirectoryPath = options.externalDirectoryPath ?? '/external';
  const ExternalStorageDirectoryPath =
    options.externalStorageDirectoryPath ?? ExternalDirectoryPath;
  const MainBundlePath = options.mainBundlePath ?? '/bundle';
  let volume = Volume.fromJSON({});
  const reportedFileSizes = new Map<string, number | string>();
  const logicalFileSizes = new Map<string, number>();
  const reportedHashes = new Map<string, string>();
  let restoreModuleMocks = (): void => {};

  function normalize(path: string): string {
    return path.replace(/^file:\/\//, '').replace(/\/+$/, '') || '/';
  }

  function parent(path: string): string {
    const normalized = normalize(path);
    return normalized.slice(0, normalized.lastIndexOf('/')) || '/';
  }

  function reset(): void {
    volume = Volume.fromJSON({});
    reportedFileSizes.clear();
    logicalFileSizes.clear();
    reportedHashes.clear();
    for (const directory of [
      DocumentDirectoryPath,
      CachesDirectoryPath,
      ExternalDirectoryPath,
      ExternalStorageDirectoryPath,
      MainBundlePath,
    ]) {
      volume.mkdirSync(directory, { recursive: true });
    }
    restoreModuleMocks();
  }

  function stat(path: string): NativeFileSystemEntry {
    const normalized = normalize(path);
    const value = volume.statSync(normalized);
    return {
      path: normalized,
      name: normalized.slice(normalized.lastIndexOf('/') + 1),
      size: (reportedFileSizes.get(normalized) ??
        logicalFileSizes.get(normalized) ??
        Number(value.size)) as number,
      isFile: () => value.isFile(),
      isDirectory: () => value.isDirectory(),
      mtime: value.mtime,
    };
  }

  const module: NativeFileSystemModule = {
    DocumentDirectoryPath,
    CachesDirectoryPath,
    ExternalDirectoryPath,
    ExternalStorageDirectoryPath,
    MainBundlePath,
    exists: jest.fn(async (path: string) => volume.existsSync(normalize(path))),
    mkdir: jest.fn(async (path: string) => {
      volume.mkdirSync(normalize(path), { recursive: true });
    }),
    stat: jest.fn(async (path: string) => stat(path)),
    readDir: jest.fn(async (path: string) => {
      const directory = normalize(path);
      return (volume.readdirSync(directory) as string[]).map(name =>
        stat(`${directory}/${name}`),
      );
    }),
    writeFile: jest.fn(
      async (path: string, contents: string, encoding?: string) => {
        const normalized = normalize(path);
        reportedFileSizes.delete(normalized);
        logicalFileSizes.delete(normalized);
        volume.mkdirSync(parent(normalized), { recursive: true });
        volume.writeFileSync(
          normalized,
          Buffer.from(contents, encoding === 'base64' ? 'base64' : 'utf8'),
        );
      },
    ),
    write: jest.fn(
      async (
        path: string,
        contents: string,
        position = 0,
        encoding?: string,
      ) => {
        const normalized = normalize(path);
        reportedFileSizes.delete(normalized);
        const incoming = Buffer.from(
          contents,
          encoding === 'base64' ? 'base64' : 'utf8',
        );
        volume.mkdirSync(parent(normalized), { recursive: true });
        const currentLength = volume.existsSync(normalized)
          ? logicalFileSizes.get(normalized) ??
            Number(volume.statSync(normalized).size)
          : 0;
        const requiredLength = Math.max(
          currentLength,
          position + incoming.length,
        );
        if (!volume.existsSync(normalized)) {
          volume.writeFileSync(normalized, Buffer.alloc(0));
        }
        const capacity = Number(volume.statSync(normalized).size);
        if (capacity < requiredLength) {
          let nextCapacity = Math.max(capacity, 1024 * 1024);
          while (nextCapacity < requiredLength) nextCapacity *= 2;
          volume.truncateSync(normalized, nextCapacity);
        }
        const descriptor = volume.openSync(normalized, 'r+');
        try {
          volume.writeSync(descriptor, incoming, 0, incoming.length, position);
        } finally {
          volume.closeSync(descriptor);
        }
        logicalFileSizes.set(normalized, requiredLength);
      },
    ),
    read: jest.fn(
      async (
        path: string,
        length?: number,
        position = 0,
        encoding?: string,
      ) => {
        const normalized = normalize(path);
        const contents = volume.readFileSync(normalized) as Buffer;
        const logicalLength =
          logicalFileSizes.get(normalized) ?? contents.length;
        const selected = contents.subarray(
          position,
          length == null
            ? logicalLength
            : Math.min(position + length, logicalLength),
        );
        return selected.toString(
          encoding === 'base64'
            ? 'base64'
            : encoding === 'ascii'
            ? 'ascii'
            : 'utf8',
        );
      },
    ),
    readFile: jest.fn(async (path: string, encoding?: string) => {
      const normalized = normalize(path);
      const contents = volume.readFileSync(normalized) as Buffer;
      return contents
        .subarray(0, logicalFileSizes.get(normalized) ?? contents.length)
        .toString(encoding === 'base64' ? 'base64' : 'utf8');
    }),
    appendFile: jest.fn(
      async (path: string, contents: string, encoding?: string) => {
        const normalized = normalize(path);
        reportedFileSizes.delete(normalized);
        const logicalLength = logicalFileSizes.get(normalized);
        if (logicalLength !== undefined) {
          volume.truncateSync(normalized, logicalLength);
          logicalFileSizes.delete(normalized);
        }
        volume.mkdirSync(parent(normalized), { recursive: true });
        volume.appendFileSync(
          normalized,
          Buffer.from(contents, encoding === 'base64' ? 'base64' : 'utf8'),
        );
      },
    ),
    unlink: jest.fn(async (path: string) => {
      const normalized = normalize(path);
      for (const storedPath of reportedFileSizes.keys()) {
        if (
          storedPath === normalized ||
          storedPath.startsWith(`${normalized}/`)
        ) {
          reportedFileSizes.delete(storedPath);
        }
      }
      for (const storedPath of logicalFileSizes.keys()) {
        if (
          storedPath === normalized ||
          storedPath.startsWith(`${normalized}/`)
        ) {
          logicalFileSizes.delete(storedPath);
        }
      }
      for (const storedKey of reportedHashes.keys()) {
        if (
          storedKey.startsWith(`${normalized}:`) ||
          storedKey.startsWith(`${normalized}/`)
        ) {
          reportedHashes.delete(storedKey);
        }
      }
      volume.rmSync(normalized, { recursive: true, force: true });
    }),
    moveFile: jest.fn(async (from: string, to: string) => {
      const source = normalize(from);
      const target = normalize(to);
      volume.mkdirSync(parent(target), { recursive: true });
      volume.renameSync(source, target);
      const reportedSize = reportedFileSizes.get(source);
      if (reportedSize !== undefined) {
        reportedFileSizes.delete(source);
        reportedFileSizes.set(target, reportedSize);
      }
      const logicalSize = logicalFileSizes.get(source);
      logicalFileSizes.delete(target);
      if (logicalSize !== undefined) {
        logicalFileSizes.delete(source);
        logicalFileSizes.set(target, logicalSize);
      }
      for (const [storedKey, digest] of reportedHashes) {
        if (!storedKey.startsWith(`${source}:`)) continue;
        reportedHashes.delete(storedKey);
        reportedHashes.set(
          `${target}${storedKey.slice(source.length)}`,
          digest,
        );
      }
    }),
    copyFile: jest.fn(async (from: string, to: string) => {
      const source = normalize(from);
      const target = normalize(to);
      volume.mkdirSync(parent(target), { recursive: true });
      volume.copyFileSync(source, target);
      const reportedSize = reportedFileSizes.get(source);
      if (reportedSize !== undefined)
        reportedFileSizes.set(target, reportedSize);
      const logicalSize = logicalFileSizes.get(source);
      logicalFileSizes.delete(target);
      if (logicalSize !== undefined) logicalFileSizes.set(target, logicalSize);
      for (const [storedKey, digest] of reportedHashes) {
        if (!storedKey.startsWith(`${source}:`)) continue;
        reportedHashes.set(
          `${target}${storedKey.slice(source.length)}`,
          digest,
        );
      }
    }),
    copyFileAssets: jest.fn(async (from: string, to: string) => {
      const source = normalize(from);
      const target = normalize(to);
      volume.mkdirSync(parent(target), { recursive: true });
      volume.copyFileSync(source, target);
      const reportedSize = reportedFileSizes.get(source);
      if (reportedSize !== undefined)
        reportedFileSizes.set(target, reportedSize);
      const logicalSize = logicalFileSizes.get(source);
      logicalFileSizes.delete(target);
      if (logicalSize !== undefined) logicalFileSizes.set(target, logicalSize);
    }),
    hash: jest.fn(
      async (path: string, algorithm: string) =>
        reportedHashes.get(`${normalize(path)}:${algorithm}`) ??
        createHash(algorithm)
          .update(
            (() => {
              const normalized = normalize(path);
              const contents = volume.readFileSync(normalized) as Buffer;
              return contents.subarray(
                0,
                logicalFileSizes.get(normalized) ?? contents.length,
              );
            })(),
          )
          .digest('hex'),
    ),
    getFSInfo: jest.fn(async () => ({
      freeSpace: 100 * 1024 * 1024 * 1024,
      totalSpace: 128 * 1024 * 1024 * 1024,
    })),
    downloadFile: jest.fn(() => ({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 0 }),
    })),
    stopDownload: jest.fn(),
  };

  const baseMockImplementations = [
    module.exists,
    module.mkdir,
    module.stat,
    module.readDir,
    module.writeFile,
    module.write,
    module.read,
    module.readFile,
    module.appendFile,
    module.unlink,
    module.moveFile,
    module.copyFile,
    module.copyFileAssets,
    module.hash,
    module.getFSInfo,
    module.downloadFile,
    module.stopDownload,
  ].map(mock => [mock, mock.getMockImplementation()] as const);

  restoreModuleMocks = () => {
    for (const [mock, implementation] of baseMockImplementations) {
      mock.mockReset();
      if (implementation) mock.mockImplementation(implementation as never);
    }
  };

  const seedFile = (path: string, sizeBytes: number): void => {
    const normalized = normalize(path);
    logicalFileSizes.delete(normalized);
    volume.mkdirSync(parent(normalized), { recursive: true });
    // Store only the bytes a reader can need for format sniffing. Metadata reports the device-size
    // value separately, so a 5 GB model test does not allocate 5 GB of process memory.
    volume.writeFileSync(
      normalized,
      Buffer.from('GGUF').subarray(0, Math.min(sizeBytes, 4)),
    );
    reportedFileSizes.set(normalized, sizeBytes);
  };

  const seedTextFile = (
    path: string,
    contents: string,
    reportedSize?: number | string,
  ): void => {
    const normalized = normalize(path);
    logicalFileSizes.delete(normalized);
    volume.mkdirSync(parent(normalized), { recursive: true });
    volume.writeFileSync(normalized, Buffer.from(contents, 'utf8'));
    if (reportedSize !== undefined) {
      reportedFileSizes.set(normalized, reportedSize);
    }
  };

  const seedDir = (path: string): void => {
    volume.mkdirSync(normalize(path), { recursive: true });
  };

  reset();

  return {
    module,
    DocumentDirectoryPath,
    reset,
    seedFile,
    seedTextFile,
    seedDir,
    setReportedFileSize: (path: string, size: number | string) => {
      reportedFileSizes.set(normalize(path), size);
    },
    setReportedHash: (path: string, algorithm: string, digest: string) => {
      reportedHashes.set(`${normalize(path)}:${algorithm}`, digest);
    },
    readAscii: (path: string, length: number, position = 0) =>
      module.read(path, length, position, 'ascii'),
    exists: (path: string) => module.exists(path),
  };
}

/** The default Jest RNFS module. Individual suites seed this device boundary instead of replacing it. */
export const defaultNativeFileSystemBoundary = createNativeFileSystemBoundary({
  documentDirectoryPath: '/mock/documents',
  cachesDirectoryPath: '/mock/caches',
  externalDirectoryPath: '/mock/external',
  externalStorageDirectoryPath: '/mock/external',
  mainBundlePath: '/mock/bundle',
});
