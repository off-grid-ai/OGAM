import RNFS from 'react-native-fs';
import { sha256 } from 'js-sha256';
import { ragService } from '../services/rag';

/** Files and their searchable text, bound to stable project IDs (never absolute paths). */
export interface ProjectBackupFile {
  projectId: string;
  name: string;
  size: number;
  enabled: boolean;
  createdAt: string;
  base64: string;
  chunks: { content: string; position: number }[];
}
export type RestoredProjectFile = Omit<ProjectBackupFile, 'base64'> & { path: string };
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ROOT = () => `${RNFS.DocumentDirectoryPath}/atlas-project-files`;
const safeProjectId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);
const safeName = (name: string) => name.length > 0 && name.length <= 200 &&
  name !== '.' && name !== '..' && !/[\\/\x00-\x1f:]/.test(name);
const byteCount = (base64: string): number => {
  if (base64.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
    throw new Error('Invalid backed-up document contents.');
  return base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
};
const safeFile = (file: ProjectBackupFile, allowed: Set<string>): void => {
  if (!file || typeof file !== 'object' || !safeProjectId(file.projectId) || !allowed.has(file.projectId) ||
      typeof file.name !== 'string' || !safeName(file.name) ||
      !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES ||
      typeof file.base64 !== 'string' || byteCount(file.base64) !== file.size ||
      typeof file.enabled !== 'boolean' || typeof file.createdAt !== 'string' ||
      !Array.isArray(file.chunks) || !file.chunks.length || file.chunks.length > 4096 ||
      file.chunks.some(c => !c || !Number.isSafeInteger(c.position) || c.position < 0 ||
        typeof c.content !== 'string' || !c.content.length || c.content.length > 500_000)) {
    throw new Error('Invalid project document in backup. No files were restored.');
  }
};
async function readablePath(path: string, name: string): Promise<string> {
  if (await RNFS.exists(path)) return path;
  // Older project imports kept a picker-cache path in the index even though the
  // document service also saved a permanent attachments copy.
  const dir = `${RNFS.DocumentDirectoryPath}/attachments`;
  if (await RNFS.exists(dir)) {
    const entries = await RNFS.readDir(dir);
    const matches = entries.filter(e => e.isFile() && e.name.endsWith(`_${name}`));
    if (matches.length === 1) return matches[0].path;
  }
  throw new Error(`Project document "${name}" is missing; reattach it before backing up.`);
}
export async function collectProjectFiles(projectIds: string[]): Promise<ProjectBackupFile[]> {
  const result: ProjectBackupFile[] = [];
  let totalBytes = 0;
  for (const projectId of projectIds) {
    if (!safeProjectId(projectId)) throw new Error('Project has an invalid ID for portable backup.');
    const documents = await ragService.getDocumentsByProject(projectId);
    for (const doc of documents) {
      if (!safeName(doc.name)) throw new Error(`Project document has an invalid name: ${doc.name}`);
      const path = await readablePath(doc.path, doc.name);
      const stat = await RNFS.stat(path);
      const size = Number(stat.size);
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES)
        throw new Error(`Document "${doc.name}" is too large for this backup (25 MB per file maximum).`);
      totalBytes += size;
      if (totalBytes > MAX_FILE_BYTES)
        throw new Error('Project files exceed the 25 MB encrypted backup and sync limit.');
      const base64 = await RNFS.readFile(path, 'base64');
      if (byteCount(base64) !== size) throw new Error(`Document "${doc.name}" changed during backup. Retry.`);
      const chunks = (await ragService.getDocumentChunks(doc.id))
        .map(({ content, position }) => ({ content, position }));
      if (!chunks.length) throw new Error(`Document "${doc.name}" has no searchable text to preserve.`);
      const entry = { projectId, name: doc.name, size, enabled: doc.enabled !== 0,
        createdAt: doc.created_at, base64, chunks };
      safeFile(entry, new Set([projectId]));
      result.push(entry);
    }
  }
  return result;
}

/** Stage every file before changing the knowledge-base index. Bad archives do not mutate it. */
async function selectIncomingFiles(files: ProjectBackupFile[], merge: boolean): Promise<ProjectBackupFile[]> {
  // Sync is append-only. Existing documents must never be replaced by an incoming
  // peer; files with divergent contents are preserved under deterministic names.
  const incoming: ProjectBackupFile[] = [];
  for (const file of files) {
    if (!merge) { incoming.push(file); continue; }
    const current = await ragService.getDocumentsByProject(file.projectId);
    const sameName = current.filter(doc => doc.name === file.name);
    let identical = false;
    for (const doc of sameName) {
      if (doc.size !== file.size) continue;
      try { identical = await RNFS.readFile(doc.path, 'base64') === file.base64; }
      catch { /* Unreadable local copy must not delete an incoming file. */ }
      if (identical) break;
    }
    if (identical) continue;
    let name = file.name;
    if (sameName.length) name = `${file.name.slice(0, 160)  }-sync-${  sha256(file.base64).slice(0, 10)}`;
    if (current.some(doc => doc.name === name)) continue;
    incoming.push({ ...file, name });
  }
  return incoming;
}

/** Preflight project-file manifests before any app stores or SQLite indexes change. */
export function validateProjectFiles(files: ProjectBackupFile[], projectIds: string[]): void {
  if (!Array.isArray(files) || !Array.isArray(projectIds) || projectIds.some(id => !safeProjectId(id)))
    throw new Error('Invalid project file backup manifest.');
  const allowed = new Set(projectIds);
  if (allowed.size !== projectIds.length) throw new Error('Duplicate project ID in backup.');
  const names = new Set<string>();
  let total = 0;
  for (const file of files) {
    safeFile(file, allowed);
    const key = `${file.projectId}:\u0000:${file.name}`;
    if (names.has(key)) throw new Error('Duplicate project document in backup.');
    names.add(key);
    total += file.size;
    if (total > MAX_FILE_BYTES) throw new Error('Project files exceed 25 MB in one portable backup.');
  }
}

export async function restoreProjectFiles(files: ProjectBackupFile[], projectIds: string[], merge = false): Promise<number> {
  validateProjectFiles(files, projectIds);
  const incoming = await selectIncomingFiles(files, merge);
  const written: string[] = [];
  const restored: RestoredProjectFile[] = [];
  try {
    for (const [i, file] of incoming.entries()) {
      const directory = `${ROOT()}/${file.projectId}`;
      await RNFS.mkdir(directory);
      const path = `${directory}/${Date.now().toString(36)}_${i}_${file.name}`;
      if (await RNFS.exists(path)) throw new Error('Conflicting document restore path.');
      written.push(path);
      await RNFS.writeFile(path, file.base64, 'base64');
      const stat = await RNFS.stat(path);
      if (Number(stat.size) !== file.size) throw new Error(`Could not verify restored file "${file.name}".`);
      const { base64: _data, ...metadata } = file;
      restored.push({ ...metadata, path });
    }
    if (merge) await ragService.appendProjectDocuments(restored);
    else await ragService.restoreProjectDocuments(projectIds, restored);
    return written.length;
  } catch (error) {
    await Promise.all(written.map(path => RNFS.unlink(path).catch(() => undefined)));
    throw error;
  }
}
