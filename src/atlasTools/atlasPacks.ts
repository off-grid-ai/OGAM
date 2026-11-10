import RNFS from 'react-native-fs';
import { useProjectStore } from '../stores/projectStore';
import { zip } from 'react-native-zip-archive';
import { importZipFromPath, PackResult } from './packImport';
import { packsForTier, type TierId } from './emergencyTiers';

/** Atlas library packs, built automatically on GitHub (release "atlas-library") and downloaded on demand. */
export const ATLAS_REPO = 'coolchan03/Atlas';
export const ATLAS_LIBRARY_PROJECT = 'Atlas - Library';

export interface AtlasPack { name: string; label: string; size: number; url: string; updated: string }

const LABELS: Record<string, string> = {
  '01_Medical': 'Medicine: doctor guides, surgery, drugs, mental health',
  '02_Water_Sanitation': 'Water and sanitation',
  '03_Food_Agriculture': 'Food, farming, foraging, hunting, preserving',
  '04_Engineering_Repair': 'Power, electricity, engineering, repair',
  '05_Science_Measurement': 'Science, math, measurement',
  '06_Survival_Navigation': 'Survival, navigation, weather',
  '07_Civilization_Crafts': 'Rebuilding: metals, chemistry, tools, textiles',
  '08_General_Reference': 'Languages and general reference',
  '09_Visual_Atlases': 'Plants, medical signs, anatomy guides',
  '90_Human_Read_Only': 'Historical craft and trade manuals',
};

export async function listAtlasPacks(): Promise<AtlasPack[]> {
  const r = await fetch(`https://api.github.com/repos/${ATLAS_REPO}/releases/tags/atlas-library`, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GitHub: HTTP ${r.status}`);
  const j: any = await r.json();
  return (j.assets || [])
    .filter((a: any) => /\.zip$/i.test(a.name))
    .map((a: any) => {
      const key = a.name.replace(/\.zip$/i, '');
      return { name: a.name, label: LABELS[key] || key.replace(/_/g, ' '), size: a.size, url: a.browser_download_url, updated: a.updated_at };
    })
    .sort((a: AtlasPack, b: AtlasPack) => a.name.localeCompare(b.name));
}

export function atlasLibraryProjectId(): string {
  const ps = useProjectStore.getState();
  let p = ps.projects.find((x) => x.name === ATLAS_LIBRARY_PROJECT);
  if (!p) {
    p = ps.createProject({ name: ATLAS_LIBRARY_PROJECT, description: 'Atlas books, converted to text. Add packs from Settings > Offline Library.', systemPrompt: '', icon: '#3F6212' } as any);
  }
  return p.id;
}

async function downloadPack(pack: AtlasPack, toFile: string, onProgress: (msg: string, frac?: number) => void): Promise<void> {
  const { promise } = RNFS.downloadFile({
    fromUrl: pack.url,
    toFile,
    progressInterval: 1000,
    progress: (p: any) => onProgress(`Downloading ${Math.round((p.bytesWritten / Math.max(1, p.contentLength)) * 100)}%`, p.bytesWritten / Math.max(1, p.contentLength)),
  } as any);
  const res = await promise;
  if (res.statusCode && res.statusCode >= 400) throw new Error(`Download failed (HTTP ${res.statusCode})`);
}

/** Download a pack and add every book part to the "Atlas - Library" project. */
export async function installAtlasPack(pack: AtlasPack, onProgress: (msg: string, frac?: number) => void): Promise<PackResult> {
  const tmp = `${RNFS.CachesDirectoryPath}/${pack.name}`;
  await downloadPack(pack, tmp, onProgress);
  try {
    return await importZipFromPath(atlasLibraryProjectId(), tmp, pack.name, (m) => onProgress(m));
  } finally {
    RNFS.unlink(tmp).catch(() => undefined);
  }
}

/**
 * Download every pack of a package size into one zip, and let the person save it where they choose (an SD card or a flash
 * drive). Android saves one file per save, so the packs are bundled into a single file. Resolves the saved file's name, or null
 * if the person closed the save dialog.
 */
export async function saveTierToDrive(tier: TierId, packs: AtlasPack[], onProgress: (msg: string, frac?: number) => void): Promise<string | null> {
  const chosen = packsForTier(tier, packs);
  if (!chosen.length) throw new Error('No packs of that size are published yet.');
  const stage = `${RNFS.CachesDirectoryPath}/atlas-bundle-${tier}`;
  const out = `${RNFS.CachesDirectoryPath}/Atlas-Emergency-${tier}.zip`;
  await RNFS.unlink(stage).catch(() => undefined);
  await RNFS.mkdir(stage);
  try {
    for (let i = 0; i < chosen.length; i++) {
      const p = chosen[i];
      await downloadPack(p, `${stage}/${p.name}`, (m, f) => onProgress(`Pack ${i + 1} of ${chosen.length}: ${m}`, f === undefined ? undefined : (i + f) / chosen.length));
    }
    onProgress('Putting the packs into one file...');
    await RNFS.unlink(out).catch(() => undefined);
    await zip(stage, out);
    const { saveDocuments } = require('@react-native-documents/picker');
    const [saved] = await saveDocuments({ sourceUris: [`file://${out}`], mimeType: 'application/zip', fileName: `Atlas-Emergency-${tier}.zip`, copy: true });
    return saved?.name ?? `Atlas-Emergency-${tier}.zip`;
  } catch (e: any) {
    if (e?.code === 'OPERATION_CANCELED') return null;
    throw e;
  } finally {
    RNFS.unlink(stage).catch(() => undefined);
    RNFS.unlink(out).catch(() => undefined);
  }
}
