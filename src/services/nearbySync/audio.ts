/**
 * Encrypted nearby-sync recording transfer. A full recording is verified before it
 * replaces a usable local copy; interrupted transfers only modify a .part file.
 */
import RNFS from 'react-native-fs';
import { sha256 } from 'js-sha256';

export const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = 4096;
const ID = /^[\w-]{1,80}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const dir = () => `${RNFS.DocumentDirectoryPath}/atlas-recordings`;
export const audioPathFor = (id: string) => `${dir()}/${id}.wav`;
const partFor = (id: string) => `${audioPathFor(id)}.part`;
const backupFor = (id: string) => `${audioPathFor(id)}.sync-backup`;

/** Checksums and byte lengths are optional only to allow older Atlas peers to finish syncing. */
export interface AudioChunk {
  kind: 'audio'; id: string; index: number; total: number; data: string;
  size?: number; checksum?: string;
}
type Transfer = { next: number; total: number; bytes: number; size?: number; digest: ReturnType<typeof sha256.create> };
const expected = new Map<string, Transfer>();

async function recoverPreviousAudio(id: string): Promise<void> {
  const backup = backupFor(id);
  if (!await RNFS.exists(backup)) return;
  if (await RNFS.exists(audioPathFor(id))) await RNFS.unlink(backup);
  else await RNFS.moveFile(backup, audioPathFor(id));
}

export async function audioOnPhone(ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    if (!ID.test(id)) continue;
    await recoverPreviousAudio(id);
    if (await RNFS.exists(audioPathFor(id))) out.push(id);
  }
  return out;
}

export async function sendMissingAudio(
  local: { id: string; audioPath: string }[], theirs: string[] | undefined,
  send: (chunk: AudioChunk) => Promise<void>,
): Promise<number> {
  if (!Array.isArray(theirs)) return 0;
  const have = new Set(theirs);
  let sent = 0;
  for (const rec of local) {
    if (!ID.test(rec.id) || have.has(rec.id) || !await RNFS.exists(rec.audioPath)) continue;
    const size = Number((await RNFS.stat(rec.audioPath)).size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > CHUNK_BYTES * MAX_CHUNKS)
      throw new Error('Invalid recording size for offline sync.');
    const total = Math.ceil(size / CHUNK_BYTES);
    const digest = sha256.create();
    for (let index = 0; index < total; index++) {
      const data = await RNFS.read(rec.audioPath, CHUNK_BYTES, index * CHUNK_BYTES, 'base64');
      digest.update(data);
      await send({ kind: 'audio', id: rec.id, index, total, data, size,
        ...(index + 1 === total ? { checksum: digest.hex() } : {}) });
    }
    sent++;
  }
  return sent;
}

function dataBytes(data: string): number {
  if (!data || data.length % 4 !== 0 || data.length > Math.ceil(CHUNK_BYTES / 3) * 4 + 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Invalid recording data.');
  return data.length * 3 / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}

/** Re-read the staged bytes so success means the file on disk matches what was sent. */
async function verifyFile(path: string, size: number, checksum: string): Promise<void> {
  const digest = sha256.create();
  for (let pos = 0; pos < size; pos += CHUNK_BYTES) {
    digest.update(await RNFS.read(path, Math.min(CHUNK_BYTES, size - pos), pos, 'base64'));
  }
  if (digest.hex() !== checksum) throw new Error('Recording checksum mismatch on disk.');
}

/** Replace an existing WAV without first deleting the last usable copy. */
async function installAudio(id: string): Promise<void> {
  const target = audioPathFor(id);
  const backup = backupFor(id);
  await recoverPreviousAudio(id);
  const hadOriginal = await RNFS.exists(target);
  if (hadOriginal) await RNFS.moveFile(target, backup);
  try {
    await RNFS.moveFile(partFor(id), target);
  } catch (error) {
    if (hadOriginal) {
      try { await RNFS.moveFile(backup, target); }
      catch { throw new Error('Recording transfer failed; original is safe in the sync-backup file.'); }
    }
    throw error;
  }
  if (hadOriginal) await RNFS.unlink(backup).catch(() => undefined);
}

export async function receiveAudio(chunk: AudioChunk): Promise<boolean> {
  const { id, index, total, data, size, checksum } = chunk;
  if (!ID.test(id) || !Number.isInteger(index) || !Number.isInteger(total) ||
      index < 0 || total < 1 || index >= total || total > MAX_CHUNKS ||
      typeof data !== 'string' ||
      (size !== undefined && (!Number.isSafeInteger(size) || size <= 0 || size > CHUNK_BYTES * MAX_CHUNKS)) ||
      (checksum !== undefined && (index !== total - 1 || !DIGEST.test(checksum))))
    throw new Error('Damaged recording piece');
  const bytes = dataBytes(data);
  if (bytes === 0 || bytes > CHUNK_BYTES || (index !== total - 1 && bytes !== CHUNK_BYTES))
    throw new Error('Invalid recording piece length.');
  const part = partFor(id);
  await RNFS.mkdir(dir());
  if (index === 0) {
    await recoverPreviousAudio(id);
    expected.set(id, { next: 1, total, bytes, size, digest: sha256.create().update(data) });
    try { await RNFS.writeFile(part, data, 'base64'); }
    catch (error) {
      expected.delete(id);
      await RNFS.unlink(part).catch(() => undefined);
      throw error;
    }
  } else {
    const active = expected.get(id);
    if (!active || active.next !== index || active.total !== total || active.size !== size) {
      expected.delete(id);
      await RNFS.unlink(part).catch(() => undefined);
      throw new Error('Recording pieces arrived out of order; retry the transfer.');
    }
    active.next++;
    active.bytes += bytes;
    active.digest.update(data);
    try { await RNFS.appendFile(part, data, 'base64'); }
    catch (error) {
      expected.delete(id);
      await RNFS.unlink(part).catch(() => undefined);
      throw error;
    }
  }
  if (index + 1 < total) return false;
  const active = expected.get(id)!;
  expected.delete(id);
  try {
    if (size !== undefined && active.bytes !== size) throw new Error('Recording size mismatch.');
    if (checksum && active.digest.hex() !== checksum) throw new Error('Recording checksum mismatch.');
    const actual = Number((await RNFS.stat(part)).size);
    if (actual !== active.bytes) throw new Error('Recording was not fully written.');
    if (checksum) await verifyFile(part, active.bytes, checksum);
    await installAudio(id);
    return true;
  } catch (error) {
    await RNFS.unlink(part).catch(() => undefined);
    throw error;
  }
}
