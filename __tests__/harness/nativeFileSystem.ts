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
  seedTextFile(path: string, contents: string, reportedSize?: number | string): void;
  seedDir(path: string): void;
  setReportedFileSize(path: string, size: number | string): void;
  readAscii(path: string, length: number, position?: number): Promise<string>;
  exists(path: string): Promise<boolean>;
  /** Serve `url` to RNFS.downloadFile, the way a remote host answers a real transfer. */
  serveRemoteFile(url: string, file: RemoteFile): RemoteTransfer;
  /** Paths of the files currently inside `directory` (empty when it does not exist). */
  listFiles(directory: string): string[];
}

/** What a remote host answers to a download. */
export interface RemoteFile {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Park the transfer after the first half of the body is on disk, until release() or stop. */
  hold?: boolean;
  /** false = the transfer finishes even after stopDownload (it was already complete natively). */
  honorsStop?: boolean;
}

export interface RemoteTransfer {
  /** True while a transfer of this file is parked mid-body. */
  held(): boolean;
  /** Let a parked transfer finish. */
  release(): void;
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
  const remoteFiles = new Map<string, RemoteFile & { parked: (() => void) | null }>();
  const activeDownloads = new Map<number, () => void>();
  let nextJobId = 1;
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
    remoteFiles.clear();
    activeDownloads.clear();
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
      size: (reportedFileSizes.get(normalized) ?? Number(value.size)) as number,
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
        const current = volume.existsSync(normalized)
          ? (volume.readFileSync(normalized) as Buffer)
          : Buffer.alloc(0);
        const next = Buffer.alloc(
          Math.max(current.length, position + incoming.length),
        );
        current.copy(next);
        incoming.copy(next, position);
        volume.mkdirSync(parent(normalized), { recursive: true });
        volume.writeFileSync(normalized, next);
      },
    ),
    read: jest.fn(
      async (
        path: string,
        length?: number,
        position = 0,
        encoding?: string,
      ) => {
        const contents = volume.readFileSync(normalize(path)) as Buffer;
        const selected = contents.subarray(
          position,
          length == null ? undefined : position + length,
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
    readFile: jest.fn(
      async (path: string, encoding?: string) =>
        volume.readFileSync(
          normalize(path),
          encoding === 'base64' ? 'base64' : 'utf8',
        ) as string,
    ),
    appendFile: jest.fn(
      async (path: string, contents: string, encoding?: string) => {
        const normalized = normalize(path);
        reportedFileSizes.delete(normalized);
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
    }),
    copyFile: jest.fn(async (from: string, to: string) => {
      const source = normalize(from);
      const target = normalize(to);
      volume.mkdirSync(parent(target), { recursive: true });
      volume.copyFileSync(source, target);
      const reportedSize = reportedFileSizes.get(source);
      if (reportedSize !== undefined)
        reportedFileSizes.set(target, reportedSize);
    }),
    copyFileAssets: jest.fn(async (from: string, to: string) => {
      const source = normalize(from);
      const target = normalize(to);
      volume.mkdirSync(parent(target), { recursive: true });
      volume.copyFileSync(source, target);
      const reportedSize = reportedFileSizes.get(source);
      if (reportedSize !== undefined)
        reportedFileSizes.set(target, reportedSize);
    }),
    hash: jest.fn(async (path: string, algorithm: string) =>
      createHash(algorithm)
        .update(volume.readFileSync(normalize(path)))
        .digest('hex'),
    ),
    getFSInfo: jest.fn(async () => ({
      freeSpace: 100 * 1024 * 1024 * 1024,
      totalSpace: 128 * 1024 * 1024 * 1024,
    })),
    downloadFile: jest.fn((request?: Record<string, unknown>) => {
      const served = remoteFiles.get(String(request?.fromUrl ?? ''));
      if (!served) {
        return { jobId: 1, promise: Promise.resolve({ statusCode: 200, bytesWritten: 0 }) };
      }
      const jobId = nextJobId++;
      const target = normalize(String(request?.toFile));
      const body = Buffer.from(served.body ?? '', 'utf8');
      const promise = (async () => {
        volume.mkdirSync(parent(target), { recursive: true });
        // Bytes land on disk as they arrive, so a stopped or failed transfer leaves a partial file.
        volume.writeFileSync(target, body.subarray(0, Math.ceil(body.length / 2)));
        if (served.hold) {
          const stopped = await new Promise<boolean>(resolve => {
            served.parked = () => resolve(false);
            if (served.honorsStop !== false) activeDownloads.set(jobId, () => resolve(true));
          });
          served.parked = null;
          activeDownloads.delete(jobId);
          if (stopped) throw new Error('Download has been aborted');
        }
        volume.writeFileSync(target, body);
        return {
          jobId,
          statusCode: served.statusCode ?? 200,
          headers: served.headers ?? {},
          bytesWritten: body.length,
        };
      })();
      return { jobId, promise };
    }),
    stopDownload: jest.fn((jobId?: number) => {
      if (jobId !== undefined) activeDownloads.get(jobId)?.();
    }),
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
    readAscii: (path: string, length: number, position = 0) =>
      module.read(path, length, position, 'ascii'),
    exists: (path: string) => module.exists(path),
    serveRemoteFile: (url: string, file: RemoteFile) => {
      const entry = { ...file, parked: null as (() => void) | null };
      remoteFiles.set(url, entry);
      return {
        held: () => entry.parked !== null,
        release: () => entry.parked?.(),
      };
    },
    listFiles: (directory: string) => {
      const normalized = normalize(directory);
      if (!volume.existsSync(normalized)) return [];
      return (volume.readdirSync(normalized) as string[]).map(name => `${normalized}/${name}`);
    },
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
