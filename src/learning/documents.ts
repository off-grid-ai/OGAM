import RNFS from 'react-native-fs';
import { useProjectStore } from '../stores/projectStore';
import { documentService } from '../services/documentService';
import { ragService } from '../services/rag';
import { resolvePickedFileUri } from '../utils/resolvePickedFileUri';

/** Documents a learning cycle reads from: files picked on the phone, or everything in the Atlas folder, indexed into a project. */
export interface AddResult { added: string[]; skipped: string[]; failed: Array<{ name: string; reason: string }> }
type Index = (p: { projectId: string; filePath: string; fileName: string; fileSize: number }) => Promise<unknown>;

const FOLDER_SKIP = 'Converted';

/** The project that holds the documents of one subject ("Taxes documents"), made when there is none yet. */
export function projectForSubject(subject: string): string {
  const name = `${subject.trim() || 'Learning'} documents`;
  const store = useProjectStore.getState();
  const found = store.projects.find((p) => p.name === name);
  if (found) return found.id;
  return store.createProject({ name, description: `Documents the ${subject.trim() || 'AI'} expert learns from.`, systemPrompt: '', icon: '#1D4ED8' } as any).id;
}

/** Every file under `dir` that Atlas can read, one level of folders at a time (the Converted folder is skipped: it only holds copies). */
export async function listReadableFiles(dir: string): Promise<Array<{ path: string; name: string; size: number }>> {
  const out: Array<{ path: string; name: string; size: number }> = [];
  for (const e of await RNFS.readDir(dir)) {
    if (e.isDirectory()) { if (e.name !== FOLDER_SKIP) out.push(...(await listReadableFiles(e.path))); }
    else if (documentService.isSupported(e.name)) out.push({ path: e.path, name: e.name, size: Number(e.size) });
  }
  return out;
}

/** Indexes the files into the project. Files already in it (same name) are skipped, a file that cannot be read is reported and the rest carry on. */
export async function addFilesToProject(o: {
  projectId: string; files: Array<{ path: string; name: string; size: number }>; onProgress?: (m: string) => void; index?: Index;
}): Promise<AddResult> {
  const { projectId, files, onProgress, index = (p) => ragService.indexDocument(p) } = o;
  const have = new Set((await ragService.getDocumentsByProject(projectId)).map((d: { name: string }) => d.name));
  const result: AddResult = { added: [], skipped: [], failed: [] };
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (have.has(f.name)) { result.skipped.push(f.name); continue; }
    onProgress?.(`Adding ${i + 1} of ${files.length}: ${f.name}`);
    try {
      await index({ projectId, filePath: f.path, fileName: f.name, fileSize: f.size });
      result.added.push(f.name); have.add(f.name);
    } catch (e: any) { result.failed.push({ name: f.name, reason: String(e?.message || e) }); }
  }
  return result;
}

/** Lets the person pick files, and adds them to the project. Resolves null when the picker was closed. */
export async function pickAndAddFiles(projectId: string, onProgress?: (m: string) => void): Promise<AddResult | null> {
  const { pick, isErrorWithCode, errorCodes } = require('@react-native-documents/picker');
  const { Platform } = require('react-native');
  let picked: Array<{ uri: string; name?: string | null; size?: number | null }>;
  try {
    picked = Platform.OS === 'android' ? await pick({ mode: 'open', allowMultiSelection: true }) : await pick({ mode: 'import', allowMultiSelection: true });
  } catch (e: any) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return null;
    throw e;
  }
  if (!picked?.length) return null;
  const files = [];
  for (const f of picked) { const name = f.name || 'document'; files.push({ path: await resolvePickedFileUri(f.uri, name), name, size: f.size || 0 }); }
  return addFilesToProject({ projectId, files, onProgress });
}

/** Adds every readable file in the Atlas workspace folder. */
export async function addWorkspaceFolder(projectId: string, onProgress?: (m: string) => void): Promise<{ dir: string; result: AddResult }> {
  const { workspaceDir } = require('../atlasTools/deviceTools');
  const dir: string = await workspaceDir();
  return { dir, result: await addFilesToProject({ projectId, files: await listReadableFiles(dir), onProgress }) };
}

/** Converts a SAF tree URI (Android) or file:// URI (iOS) to a real filesystem path RNFS can use. */
function uriToPath(uri: string): string | null {
  try {
    const decoded = decodeURIComponent(uri);
    // Android SAF primary internal storage: .../tree/primary:Path/Subdir
    const treeMatch = decoded.match(/\/tree\/primary:(.+)$/);
    if (treeMatch) return '/storage/emulated/0/' + treeMatch[1];
    // iOS and some Android paths use file://
    if (uri.startsWith('file://')) return decodeURIComponent(uri.slice(7));
  } catch {}
  return null;
}

/** Lets the person pick any folder and adds all readable files in it to the project. Resolves null when the picker was closed. */
export async function pickAndAddFolder(projectId: string, onProgress?: (m: string) => void): Promise<{ dir: string; result: AddResult } | null> {
  const { pickDirectory, isErrorWithCode, errorCodes } = require('@react-native-documents/picker');
  let picked: { uri: string };
  try {
    picked = await pickDirectory();
  } catch (e: any) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return null;
    throw e;
  }
  if (!picked?.uri) return null;
  const dir = uriToPath(picked.uri);
  if (!dir) throw new Error('Cannot read this folder directly. Move the files into the Atlas folder instead, then use "Add the Atlas folder".');
  return { dir, result: await addFilesToProject({ projectId, files: await listReadableFiles(dir), onProgress }) };
}

export const summarize = (r: AddResult): string => [
  r.added.length ? `${r.added.length} added.` : 'Nothing new to add.',
  r.skipped.length ? `${r.skipped.length} already there.` : '',
  r.failed.length ? `${r.failed.length} could not be read: ${r.failed.map((f) => f.name).join(', ')}.` : '',
].filter(Boolean).join(' ');
