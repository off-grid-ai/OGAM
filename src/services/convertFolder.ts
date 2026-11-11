import RNFS from 'react-native-fs';
import { documentService } from './documentService';
import { markdownFileName } from './markdownConvert';
import { OFFICE_EXTENSIONS } from './officeExtract';

/** The kinds of file worth converting: text and Markdown files already read well, so only these are turned into .md. */
const CONVERTIBLE = ['.pdf', '.html', '.htm', '.csv', ...OFFICE_EXTENSIONS];
const OUT_DIR = 'Converted';

export interface ConvertResult { converted: string[]; failed: Array<{ name: string; reason: string }> }

export const isConvertible = (name: string): boolean => CONVERTIBLE.includes(`.${name.split('.').pop()?.toLowerCase()}`);

/** A name for the .md that does not collide: the same name in two folders gets the folder's name in front. */
export function outputName(name: string, taken: Set<string>, folder: string): string {
  let out = markdownFileName(name);
  if (taken.has(out)) out = `${folder.replace(/[\\/:*?"<>|]/g, '_')}-${out}`;
  let n = 2;
  const base = out.replace(/\.md$/, '');
  while (taken.has(out)) out = `${base}-${n++}.md`;
  taken.add(out);
  return out;
}

async function listFiles(dir: string): Promise<Array<{ path: string; name: string; folder: string }>> {
  const out: Array<{ path: string; name: string; folder: string }> = [];
  for (const e of await RNFS.readDir(dir)) {
    if (e.isDirectory()) {
      if (e.name !== OUT_DIR) out.push(...(await listFiles(e.path)));
    } else if (isConvertible(e.name)) out.push({ path: e.path, name: e.name, folder: dir.split('/').pop() || 'folder' });
  }
  return out;
}

/** Converts every Word, PowerPoint, Excel, PDF, web page and CSV file under `dir` into a .md file in `dir/Converted`. */
export async function convertFolderToMarkdown(dir: string, onProgress?: (done: number, total: number) => void): Promise<ConvertResult> {
  const files = await listFiles(dir);
  const result: ConvertResult = { converted: [], failed: [] };
  if (!files.length) return result;
  const outDir = `${dir}/${OUT_DIR}`;
  await RNFS.mkdir(outDir);
  const taken = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress?.(i, files.length);
    try {
      const text = await documentService.markdownFromPath(f.path);
      const out = outputName(f.name, taken, f.folder);
      await RNFS.writeFile(`${outDir}/${out}`, text, 'utf8');
      result.converted.push(out);
    } catch (e: any) { result.failed.push({ name: f.name, reason: String(e?.message || e) }); }
  }
  onProgress?.(files.length, files.length);
  return result;
}
