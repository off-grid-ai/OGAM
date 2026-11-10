import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { pick, types } from '@react-native-documents/picker';
import { resolvePickedFileUri } from '../utils/resolvePickedFileUri';
import { ragService } from '../services/rag';
import logger from '../utils/logger';

const TEXT = /\.(md|txt|markdown|csv|json|html?)$/i;
const MAX_BYTES = 5 * 1024 * 1024;

export interface PackResult { added: number; skipped: number; failed: { name: string; error: string }[]; total: number }

/** Text files to add, and any zips inside the unpacked folder (a package bundle holds one zip per subject pack). */
async function walk(dir: string, out: any[] = [], zips: any[] = []): Promise<{ items: any[]; zips: any[] }> {
  for (const it of await RNFS.readDir(dir)) {
    if (it.isDirectory()) await walk(it.path, out, zips);
    else if (TEXT.test(it.name)) out.push(it);
    else if (/\.zip$/i.test(it.name)) zips.push(it);
  }
  return { items: out, zips };
}

/**
 * Pick a .zip of Atlas text files (for example the PC script's OffGrid_Parts packs),
 * unpack it inside the app and add every .md/.txt file to the project's knowledge base.
 * Files already in the knowledge base are skipped, so it is safe to import again.
 */
export async function importZipPack(projectId: string, onProgress: (msg: string) => void, shouldStop: () => boolean = () => false): Promise<PackResult | null> {
  const files = await pick({ mode: 'open', type: [types.zip, 'application/zip', 'application/x-zip-compressed'], allowMultiSelection: false });
  if (!files?.length) return null;
  const f = files[0];
  onProgress('Copying the pack...');
  const local = await resolvePickedFileUri(f.uri, f.name || 'atlas-pack.zip');
  const res = await importZipFromPath(projectId, local, f.name || 'pack.zip', onProgress, shouldStop);
  try { await RNFS.unlink(local.replace(/^file:\/\//, '')); } catch { /* copy may be the original */ }
  return res;
}

/** Unpack a .zip that is already on the phone and add its text files to the project's knowledge base. */
export async function importZipFromPath(projectId: string, local: string, name: string, onProgress: (msg: string) => void, shouldStop: () => boolean = () => false): Promise<PackResult> {
  const target = `${RNFS.DocumentDirectoryPath}/atlas_packs/${name.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9._-]/g, '_')}`;
  await RNFS.mkdir(target);
  onProgress('Unpacking...');
  await unzip(local.replace(/^file:\/\//, ''), target);
  const { items, zips } = await walk(target);
  const res: PackResult = { added: 0, skipped: 0, failed: [], total: items.length };
  // An Atlas package saved to a drive is one zip of subject packs: add each pack in turn.
  for (const z of zips) {
    if (shouldStop()) break;
    const inner = await importZipFromPath(projectId, z.path, z.name, onProgress, shouldStop);
    res.added += inner.added; res.skipped += inner.skipped; res.total += inner.total; res.failed.push(...inner.failed);
  }
  for (let i = 0; i < items.length; i++) {
    if (shouldStop()) break;
    const it = items[i];
    onProgress(`Adding ${i + 1} of ${items.length}: ${it.name}`);
    if (Number(it.size) > MAX_BYTES) { res.failed.push({ name: it.name, error: 'larger than 5 MB' }); continue; }
    try {
      await ragService.indexDocument({ projectId, filePath: it.path, fileName: it.name, fileSize: Number(it.size) || 0 });
      res.added++;
    } catch (e: any) {
      const m = String(e?.message || e);
      if (/already in the knowledge base/.test(m)) res.skipped++;
      else { res.failed.push({ name: it.name, error: m.slice(0, 120) }); logger.warn(`[AtlasPack] ${it.name}: ${m}`); }
    }
  }
  return res;
}
