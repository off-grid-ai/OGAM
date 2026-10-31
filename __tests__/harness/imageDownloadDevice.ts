/**
 * The device side of an image-model download, for tests that run the real download code above it.
 *
 * Two native leaves are faked here, both writing real bytes into the in-memory file system:
 *  - react-native-zip-archive: a "zip" on the fake disk is the bytes `PK` followed by a JSON list of
 *    the files it holds. unzip reads that file from the fake disk and writes each entry into the
 *    destination folder. A file that is missing or does not start with `PK` makes unzip throw, as a
 *    corrupt archive does on a device.
 *  - the background-download native module (DownloadManagerModule): each started download finishes on
 *    the next macrotask with a DownloadComplete (or a DownloadError when its URL is served as failing),
 *    and moveCompletedDownload writes what the URL served to the target path. A URL served with
 *    `hold: true` stays running until the test finishes or fails it.
 *
 * Nothing here decides an outcome the app owns (completeness, registration, store rows). Requires a
 * boundary installed with { fs: true, download: true }.
 */
import type { NativeBoundary } from './nativeBoundary';

/** One file inside a fake zip: its name inside the archive, and its size in bytes. */
export type ZipEntries = Record<string, number>;

/** What a remote host answers for one URL. */
export interface ServedDownload {
  /** The completed file is a zip holding these entries. */
  zip?: ZipEntries;
  /** The completed file is this many bytes (default: the size the download was started with). */
  bytes?: number;
  /** The completed file is this text (e.g. a zip with a bad header). */
  text?: string;
  /** The download ends in DownloadError with this reason. */
  failReason?: string;
  /** The download stays running until finish()/fail() is called for it. */
  hold?: boolean;
}

export interface ImageDownloadDevice {
  /** Answer downloads of `url` with `served`. */
  serve(url: string, served: ServedDownload): void;
  /** Write a fake zip holding `entries` at `path`. */
  seedZip(path: string, entries: ZipEntries): void;
  /** URLs of every native download started, in start order. */
  startedUrls(): string[];
  /** Finish a held download now (DownloadComplete). */
  finish(downloadId: string): Promise<void>;
  /** Fail a held download now (DownloadError). */
  fail(downloadId: string, reason: string, reasonCode?: string): Promise<void>;
  /** The native ids of downloads that are still running. */
  running(): string[];
}

const ZIP_MAGIC = 'PK';

export function zipBody(entries: ZipEntries): string {
  return `${ZIP_MAGIC}${JSON.stringify(entries)}`;
}

const macrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export function installImageDownloadDevice(boundary: NativeBoundary): ImageDownloadDevice {
  const fs = boundary.fs!;
  const download = boundary.download!;
  const served = new Map<string, ServedDownload>();
  const started: string[] = [];
  const urlOf = new Map<string, string>();
  const sizeOf = new Map<string, number>();
  const finished = new Set<string>();

  const seedZip = (path: string, entries: ZipEntries) => fs.seedTextFile(path, zipBody(entries));

  const { unzip } = require('react-native-zip-archive') as { unzip: jest.Mock };
  unzip.mockImplementation(async (zipPath: string, destination: string) => {
    if (!(await fs.exists(zipPath))) throw new Error(`No such file: ${zipPath}`);
    const text = await fs.module.readFile(zipPath, 'utf8');
    if (!text.startsWith(ZIP_MAGIC)) throw new Error('corrupt zip');
    let entries: ZipEntries;
    try {
      entries = JSON.parse(text.slice(ZIP_MAGIC.length)) as ZipEntries;
    } catch {
      throw new Error('corrupt zip');
    }
    for (const [name, size] of Object.entries(entries)) fs.seedFile(`${destination}/${name}`, size);
    return destination;
  });

  const emitEnd = (downloadId: string) => {
    const row = download.active().find(r => r.downloadId === downloadId);
    // A cancelled download has left the native set: it never finishes.
    if (!row || finished.has(downloadId)) return;
    const answer = served.get(urlOf.get(downloadId) ?? '') ?? {};
    finished.add(downloadId);
    if (answer.failReason) {
      download.events.emit('DownloadError', {
        downloadId, fileName: row.fileName, modelId: row.modelId, status: 'failed', reason: answer.failReason,
      });
      return;
    }
    const total = sizeOf.get(downloadId) ?? 0;
    row.status = 'completed';
    download.events.emit('DownloadComplete', {
      downloadId, fileName: row.fileName, modelId: row.modelId,
      bytesDownloaded: total, totalBytes: total, status: 'completed', localUri: `/downloads/${row.fileName}`,
    });
  };

  const start = download.module.startDownload.getMockImplementation()!;
  download.module.startDownload.mockImplementation(async (params: { url: string; totalBytes?: number }) => {
    const row = await start(params);
    started.push(params.url);
    urlOf.set(row.downloadId, params.url);
    sizeOf.set(row.downloadId, Number(params.totalBytes) || 1024);
    if (!served.get(params.url)?.hold) {
      setTimeout(() => emitEnd(row.downloadId), 0);
    }
    return row;
  });

  download.module.moveCompletedDownload.mockImplementation(async (id: string, target: string) => {
    const answer = served.get(urlOf.get(id) ?? '');
    if (!finished.has(id) || answer?.failReason) throw new Error(`No completed download ${id}`);
    if (answer?.zip) seedZip(target, answer.zip);
    else if (answer?.text !== undefined) fs.seedTextFile(target, answer.text);
    else fs.seedFile(target, answer?.bytes ?? sizeOf.get(id) ?? 1024);
    return target;
  });

  return {
    serve: (url, answer) => {
      served.set(url, answer);
    },
    seedZip,
    startedUrls: () => [...started],
    finish: async downloadId => {
      served.set(urlOf.get(downloadId) ?? '', { ...served.get(urlOf.get(downloadId) ?? ''), failReason: undefined });
      emitEnd(downloadId);
      await macrotask();
    },
    fail: async (downloadId, reason, reasonCode) => {
      finished.add(downloadId);
      download.events.emit('DownloadError', { downloadId, status: 'failed', reason, reasonCode });
      await macrotask();
    },
    running: () => download.active().filter(r => r.status === 'running' && !finished.has(r.downloadId)).map(r => r.downloadId),
  };
}
