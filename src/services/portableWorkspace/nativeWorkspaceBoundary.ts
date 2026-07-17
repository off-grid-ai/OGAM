import { Share } from 'react-native';
import RNFS from 'react-native-fs';
import { pick, errorCodes, isErrorWithCode } from '@react-native-documents/picker';
import { inflateSync } from 'fflate';
import { unzip, zip } from 'react-native-zip-archive';
import type { ArchiveEntry, ArchivePort, BackupSink, InspectedFile } from '@offgrid/sync/portable';
import { resolvePickedFileUri } from '../../utils/resolvePickedFileUri';
import type { WorkspaceFilePort } from './types';

interface CentralEntry extends ArchiveEntry {
  compression: number;
  flags: number;
  localHeaderOffset: number;
}

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const decodeBase64 = (value: string): Uint8Array => {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

const readBytes = async (path: string, length: number, position: number): Promise<Uint8Array> =>
  decodeBase64(await RNFS.read(path, length, position, 'base64'));

const parentPath = (path: string): string => path.slice(0, Math.max(1, path.lastIndexOf('/')));
const workspaceImportRoot = `${RNFS.DocumentDirectoryPath}/workspace-imports`;
const isOwnedImportPath = (path: string): boolean => {
  const normalized = path.replaceAll(/\/{2,}/g, '/');
  return !normalized.split('/').includes('..') && normalized.startsWith(`${workspaceImportRoot}/`);
};
const assertImportOwned = (path: string): void => {
  if (!isOwnedImportPath(path)) throw new Error('Workspace file operation escaped its owned import root');
};

class RnWorkspaceArchive implements ArchivePort {
  private sequence = 0;
  private importId = 'pending';
  private readonly listings = new Map<string, CentralEntry[]>();

  private assertOwned(path: string, root: string): void {
    const normalized = path.replaceAll(/\/{2,}/g, '/');
    if (normalized.split('/').includes('..') || (normalized !== root && !normalized.startsWith(`${root}/`))) {
      throw new Error('Workspace archive attempted to access an unowned path');
    }
  }

  async stageDir(): Promise<string> {
    const path = `${RNFS.CachesDirectoryPath}/workspace-transfer-${Date.now()}-${this.sequence++}`;
    await RNFS.mkdir(path);
    return path;
  }

  async writeText(path: string, text: string): Promise<void> {
    this.assertOwned(path, RNFS.CachesDirectoryPath);
    await this.ensureParent(path);
    await RNFS.writeFile(path, text, 'utf8');
  }

  async copyInto(sourcePath: string, destinationPath: string): Promise<void> {
    this.assertOwned(destinationPath, RNFS.CachesDirectoryPath);
    await this.ensureParent(destinationPath);
    await RNFS.copyFile(sourcePath.replace(/^file:\/\//, ''), destinationPath);
  }

  async inspectFile(path: string): Promise<InspectedFile> {
    const [stat, sha256] = await Promise.all([RNFS.stat(path), RNFS.hash(path, 'sha256')]);
    return { size: Number(stat.size), sha256: sha256.toLowerCase() };
  }

  pack(stageDir: string, suggestedName: string): Promise<string> {
    this.assertOwned(stageDir, RNFS.CachesDirectoryPath);
    return zip(stageDir, `${RNFS.CachesDirectoryPath}/${suggestedName}`);
  }

  async listEntries(archivePath: string): Promise<ArchiveEntry[]> {
    const entries = await this.readCentralDirectory(archivePath);
    this.listings.set(archivePath, entries);
    this.importId = `${Date.now()}-${this.sequence++}`;
    return entries.map(({ key, type, size, compressedSize }) => ({ key, type, size, compressedSize }));
  }

  async readEntryText(archivePath: string, key: string, maxBytes: number): Promise<string> {
    const entries = this.listings.get(archivePath) ?? await this.readCentralDirectory(archivePath);
    const entry = entries.find(item => item.key === key);
    if (!entry || entry.type !== 'file' || entry.size > maxBytes) throw new Error(`Archive entry ${key} is unavailable`);
    const header = await readBytes(archivePath, 30, entry.localHeaderOffset);
    const headerView = view(header);
    if (headerView.getUint32(0, true) !== 0x04034b50) throw new Error('Invalid ZIP local header');
    const localFlags = headerView.getUint16(6, true);
    const localCompression = headerView.getUint16(8, true);
    const localNameLength = headerView.getUint16(26, true);
    const localExtraLength = headerView.getUint16(28, true);
    const localName = new TextDecoder().decode(await readBytes(archivePath, localNameLength, entry.localHeaderOffset + 30));
    if (localName !== entry.key || localFlags !== entry.flags || localCompression !== entry.compression) {
      throw new Error('ZIP local header does not match its central record');
    }
    const dataOffset = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
    const archiveSize = Number((await RNFS.stat(archivePath)).size);
    if (dataOffset > archiveSize || entry.compressedSize > archiveSize - dataOffset) throw new Error('ZIP entry exceeds archive bounds');
    const compressed = await readBytes(archivePath, entry.compressedSize, dataOffset);
    const expanded = entry.compression === 0 ? compressed : inflateSync(compressed);
    if (expanded.byteLength !== entry.size || expanded.byteLength > maxBytes) throw new Error(`Archive entry ${key} has an invalid size`);
    return new TextDecoder().decode(expanded);
  }

  async extractEntries(archivePath: string, destinationDir: string, keys: readonly string[]): Promise<void> {
    // listEntries has already rejected unsafe paths, links, encryption, and
    // unsupported compression. The native unzipper may materialize the verified
    // envelope as well; remove it before returning so callers observe only keys.
    this.assertOwned(destinationDir, RNFS.CachesDirectoryPath);
    const verified = this.listings.get(archivePath);
    if (!verified || verified.some(entry => entry.type === 'symlink' || entry.type === 'other')) {
      throw new Error('Archive must be listed and verified before extraction');
    }
    await this.verifyLocalHeaders(archivePath, verified);
    await unzip(archivePath.replace(/^file:\/\//, ''), destinationDir);
    const selected = new Set(keys);
    const entries = this.listings.get(archivePath) ?? [];
    await Promise.all(entries
      .filter(entry => entry.type === 'file' && !selected.has(entry.key))
      .map(entry => RNFS.unlink(this.join(destinationDir, entry.key)).catch(() => undefined)));
  }

  restorePathFor(key: string): string {
    return `${RNFS.DocumentDirectoryPath}/workspace-imports/${this.importId}/${key.replace(/^files\//, '')}`;
  }

  async removeDir(path: string): Promise<void> {
    this.assertOwned(path, RNFS.CachesDirectoryPath);
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  }

  async removeFile(path: string): Promise<void> {
    this.assertOwned(path, RNFS.CachesDirectoryPath);
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  }

  join(...parts: string[]): string {
    return parts.map((part, index) => index === 0 ? part.replace(/\/$/, '') : part.replace(/^\//, '').replace(/\/$/, '')).join('/');
  }

  private async ensureParent(path: string): Promise<void> {
    const parent = parentPath(path);
    if (!(await RNFS.exists(parent))) await RNFS.mkdir(parent);
  }

  private async readCentralDirectory(path: string): Promise<CentralEntry[]> {
    const fileSize = Number((await RNFS.stat(path)).size);
    const tailSize = Math.min(fileSize, 65_557);
    const tail = await readBytes(path, tailSize, fileSize - tailSize);
    const tailView = view(tail);
    let eocd = -1;
    for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
      if (tailView.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
    }
    if (eocd < 0) throw new Error('Invalid ZIP: missing end record');
    const disk = tailView.getUint16(eocd + 4, true);
    const centralDisk = tailView.getUint16(eocd + 6, true);
    const count = tailView.getUint16(eocd + 10, true);
    const centralSize = tailView.getUint32(eocd + 12, true);
    const centralOffset = tailView.getUint32(eocd + 16, true);
    if (disk !== 0 || centralDisk !== 0 || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error('Multipart and ZIP64 archives are not supported');
    }
    if (centralOffset > fileSize || centralSize > fileSize - centralOffset) throw new Error('ZIP central directory exceeds archive bounds');
    const central = await readBytes(path, centralSize, centralOffset);
    const centralView = view(central);
    const entries: CentralEntry[] = [];
    let offset = 0;
    for (let index = 0; index < count; index += 1) {
      if (offset + 46 > central.byteLength || centralView.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP central directory');
      const flags = centralView.getUint16(offset + 8, true);
      const compression = centralView.getUint16(offset + 10, true);
      const compressedSize = centralView.getUint32(offset + 20, true);
      const size = centralView.getUint32(offset + 24, true);
      const nameLength = centralView.getUint16(offset + 28, true);
      const extraLength = centralView.getUint16(offset + 30, true);
      const commentLength = centralView.getUint16(offset + 32, true);
      const externalAttributes = centralView.getUint32(offset + 38, true);
      const localHeaderOffset = centralView.getUint32(offset + 42, true);
      const key = new TextDecoder().decode(central.slice(offset + 46, offset + 46 + nameLength));
      // ZIP stores Unix file mode in the upper sixteen external-attribute bits.
      /* eslint-disable no-bitwise */
      const unixMode = externalAttributes >>> 16;
      const unixType = unixMode & 0xf000;
      const encrypted = (flags & 1) !== 0;
      /* eslint-enable no-bitwise */
      const type: ArchiveEntry['type'] = encrypted || ![0, 8].includes(compression)
        ? 'other'
        : unixType === 0xa000
          ? 'symlink'
          : key.endsWith('/') || unixType === 0x4000
            ? 'directory'
            : 'file';
      entries.push({ key, type, size, compressedSize, compression, flags, localHeaderOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (offset !== central.byteLength) throw new Error('Invalid ZIP central directory size');
    return entries;
  }

  private async verifyLocalHeaders(path: string, entries: CentralEntry[]): Promise<void> {
    const archiveSize = Number((await RNFS.stat(path)).size);
    for (const entry of entries) {
      if (entry.localHeaderOffset > archiveSize - 30) throw new Error('ZIP local header exceeds archive bounds');
      const header = await readBytes(path, 30, entry.localHeaderOffset);
      const headerView = view(header);
      if (headerView.getUint32(0, true) !== 0x04034b50) throw new Error('Invalid ZIP local header');
      const nameLength = headerView.getUint16(26, true);
      const extraLength = headerView.getUint16(28, true);
      const name = new TextDecoder().decode(await readBytes(path, nameLength, entry.localHeaderOffset + 30));
      const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
      if (
        name !== entry.key ||
        headerView.getUint16(6, true) !== entry.flags ||
        headerView.getUint16(8, true) !== entry.compression ||
        dataOffset > archiveSize ||
        entry.compressedSize > archiveSize - dataOffset
      ) {
        throw new Error('ZIP local header does not match its central record');
      }
    }
  }
}

class RnWorkspaceSink implements BackupSink<{ shared: boolean }> {
  async deliverFile(path: string, suggestedName: string): Promise<{ shared: boolean }> {
    const result = await Share.share({ title: suggestedName, url: `file://${path}` });
    return { shared: result.action === Share.sharedAction };
  }

  async pickFile(): Promise<string | null> {
    try {
      const results = await pick({ allowMultiSelection: false, mode: 'import' });
      const result = results[0];
      return result ? resolvePickedFileUri(result.uri, result.name ?? 'workspace.zip') : null;
    } catch (error) {
      if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) return null;
      throw error;
    }
  }
}

export const workspaceArchive = new RnWorkspaceArchive();
export const workspaceSink = new RnWorkspaceSink();

export const workspaceFiles: WorkspaceFilePort = {
  exists: path => RNFS.exists(path.replace(/^file:\/\//, '')),
  isOwnedImportPath,
  async copy(sourcePath, destinationPath) {
    assertImportOwned(destinationPath);
    const parent = parentPath(destinationPath);
    if (!(await RNFS.exists(parent))) await RNFS.mkdir(parent);
    await RNFS.copyFile(sourcePath.replace(/^file:\/\//, ''), destinationPath);
  },
  textDestination(id) {
    return `${RNFS.DocumentDirectoryPath}/workspace-imports/text/${encodeURIComponent(id)}.txt`;
  },
  async materializeText(path, text) {
    assertImportOwned(path);
    const parent = parentPath(path);
    if (!(await RNFS.exists(parent))) await RNFS.mkdir(parent);
    await RNFS.writeFile(path, text, 'utf8');
  },
  async remove(path) {
    assertImportOwned(path);
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  },
};
