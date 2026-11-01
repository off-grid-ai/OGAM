/**
 * The phone under modelManager: an in-memory disk, the native background downloader, async-storage
 * and (on Android) the content provider a picked file comes from. Everything ours — modelManager,
 * backgroundDownloadService, the Hugging Face URL builder, the Core ML resolver, the stores — runs
 * for real on top.
 *
 * The native downloader here behaves like the device: a finished transfer lands in the downloader's
 * own temp folder and its row turns 'completed'; moveCompletedDownload moves that file to the target
 * the app asks for, and refuses a download that has not finished. So a model reaches the models folder
 * only through the app's own finalize path.
 */
import {
  installNativeBoundary,
  GB,
  type DownloadRow,
  type FsFake,
  type NativeBoundary,
} from './nativeBoundary';

type ModelManagerModule = typeof import('../../src/services/modelManager');

export interface ModelManagerDeviceOpts {
  platform?: 'ios' | 'android';
  /** false = a platform with no background downloader (DownloadManagerModule absent). */
  backgroundDownloads?: boolean;
}

interface NativeRow extends DownloadRow {
  localUri?: string;
}

export interface ModelManagerDevice {
  boundary: NativeBoundary;
  fs: FsFake;
  modelManager: ModelManagerModule['modelManager'];
  modelsDir: string;
  imageModelsDir: string;
  /** The native rows the downloader holds right now. */
  nativeRows(): NativeRow[];
  /** Bytes arrived for a running download. */
  reportProgress(downloadId: string, bytesDownloaded: number, totalBytes: number): Promise<void>;
  /** The native downloader finished the transfer: the file sits in its temp folder, the row is completed. */
  finishDownload(downloadId: string, sizeBytes?: number): Promise<void>;
  /** The native downloader gave up on the transfer. */
  failDownload(downloadId: string, reason: string, reasonCode?: string): Promise<void>;
  /** A transfer that finished while the app was not running: only the completed row and the temp file. */
  seedFinishedNativeRow(row: { downloadId: string; fileName: string; modelId: string; sizeBytes: number; status?: string }): void;
  /** The persisted text-model registry. */
  readRegistry(): Promise<Array<Record<string, any>>>;
  /** The persisted image-model registry. */
  readImageRegistry(): Promise<Array<Record<string, any>>>;
  /** Rows an earlier app version (or an earlier install's container) left in storage. */
  seedRegistry(rows: unknown[] | string): Promise<void>;
  seedImageRegistry(rows: unknown[]): Promise<void>;
  /** A document behind an Android content:// URI, as the picker hands it over. */
  seedContentDocument(uri: string, sizeBytes: number): void;
  /** The next copy writes half the bytes, then waits for release() — a long copy still running. */
  holdNextCopy(): { release(): void };
  /** The next copy writes half the bytes, then the disk refuses the rest. */
  failNextCopy(message: string): void;
  /** Let pending promise chains and native-event handlers settle. */
  settle(): Promise<void>;
}

const MODELS_KEY = '@local_llm/downloaded_models';
const IMAGE_MODELS_KEY = '@local_llm/downloaded_image_models';

export async function installModelManagerDevice(
  opts: ModelManagerDeviceOpts = {},
): Promise<ModelManagerDevice> {
  const boundary = installNativeBoundary({
    fs: true,
    download: opts.backgroundDownloads !== false,
    ram: { platform: opts.platform ?? 'ios', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  const fs = boundary.fs!;
  const download = boundary.download;

  // Storage is a device leaf shared by the whole test file; every test starts from an empty one.
  const storage = require('@react-native-async-storage/async-storage');
  await storage.clear();

  const tempDir = `${fs.module.CachesDirectoryPath}/native-downloads`;
  const rowOf = (id: string): NativeRow | undefined =>
    download?.active().find(row => row.downloadId === id) as NativeRow | undefined;

  if (download) {
    download.module.moveCompletedDownload.mockImplementation(async (id: string, target: string) => {
      const row = rowOf(id);
      if (!row || row.status !== 'completed' || !row.localUri) {
        throw new Error(`Download ${id} not completed yet`);
      }
      await fs.module.moveFile(row.localUri.replace(/^file:\/\//, ''), target);
      download.seedActive({ ...row, localUri: undefined } as NativeRow);
      return target;
    });
  }

  // The Android content provider: a picked document is readable only through its content:// URI.
  const contentDocuments = new Map<string, string>();
  const copyFromDisk = fs.module.copyFile.getMockImplementation()!;
  let nextCopy: ((from: string, to: string) => Promise<void>) | null = null;
  const writeHalf = async (from: string, to: string) => {
    const source = contentDocuments.get(from) ?? from;
    const size = (await fs.module.stat(source)).size;
    fs.seedFile(to, Math.floor(Number(size) / 2));
  };
  fs.module.copyFile.mockImplementation(async (from: string, to: string) => {
    const scripted = nextCopy;
    nextCopy = null;
    if (scripted) return scripted(from, to);
    return copyFromDisk(contentDocuments.get(from) ?? from, to);
  });

  const { modelManager } = require('../../src/services/modelManager') as ModelManagerModule;

  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve));
  };

  const readKey = async (key: string) => {
    const raw = await storage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  };

  return {
    boundary,
    fs,
    modelManager,
    modelsDir: modelManager.getModelsDirectory(),
    imageModelsDir: modelManager.getImageModelsDirectory(),
    nativeRows: () => (download?.active() ?? []) as NativeRow[],
    reportProgress: async (downloadId, bytesDownloaded, totalBytes) => {
      download!.events.emit('DownloadProgress', { downloadId, bytesDownloaded, totalBytes, status: 'running' });
      await settle();
    },
    finishDownload: async (downloadId, sizeBytes) => {
      const row = rowOf(downloadId);
      if (!row) throw new Error(`No native download ${downloadId}`);
      const bytes = sizeBytes ?? (row.totalBytes || 1024);
      const tempPath = `${tempDir}/${downloadId}-${row.fileName}`;
      fs.seedFile(tempPath, bytes);
      download!.seedActive({ ...row, status: 'completed', bytesDownloaded: bytes, localUri: `file://${tempPath}` } as NativeRow);
      download!.events.emit('DownloadComplete', {
        downloadId,
        fileName: row.fileName,
        modelId: row.modelId,
        bytesDownloaded: bytes,
        totalBytes: bytes,
        status: 'completed',
        localUri: `file://${tempPath}`,
      });
      await settle();
    },
    failDownload: async (downloadId, reason, reasonCode) => {
      const row = rowOf(downloadId);
      if (row) download!.seedActive({ ...row, status: 'failed', reason });
      download!.events.emit('DownloadError', { downloadId, status: 'failed', reason, reasonCode });
      await settle();
    },
    seedFinishedNativeRow: ({ downloadId, fileName, modelId, sizeBytes, status = 'completed' }) => {
      const tempPath = `${tempDir}/${downloadId}-${fileName}`;
      if (status === 'completed') fs.seedFile(tempPath, sizeBytes);
      download!.seedActive({
        downloadId, fileName, modelId, status,
        bytesDownloaded: status === 'completed' ? sizeBytes : 0,
        totalBytes: sizeBytes,
        ...(status === 'completed' ? { localUri: `file://${tempPath}` } : {}),
      } as NativeRow);
    },
    readRegistry: () => readKey(MODELS_KEY),
    readImageRegistry: () => readKey(IMAGE_MODELS_KEY),
    seedRegistry: async rows => {
      await storage.setItem(MODELS_KEY, typeof rows === 'string' ? rows : JSON.stringify(rows));
    },
    seedImageRegistry: async rows => {
      await storage.setItem(IMAGE_MODELS_KEY, JSON.stringify(rows));
    },
    seedContentDocument: (uri, sizeBytes) => {
      const backing = `/content-provider/${contentDocuments.size}`;
      fs.seedFile(backing, sizeBytes);
      contentDocuments.set(uri, backing);
    },
    holdNextCopy: () => {
      let release!: () => void;
      const released = new Promise<void>(resolve => { release = resolve; });
      nextCopy = async (from, to) => {
        await writeHalf(from, to);
        await released;
        await copyFromDisk(contentDocuments.get(from) ?? from, to);
      };
      return { release: () => release() };
    },
    failNextCopy: message => {
      nextCopy = async (from, to) => {
        await writeHalf(from, to);
        throw new Error(message);
      };
    },
    settle,
  };
}
