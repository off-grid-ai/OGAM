import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { pick, types } from '@react-native-documents/picker';
import { resolvePickedFileUri } from '../utils/resolvePickedFileUri';
import { parseSkill, SkillFormatError, type ParsedSkill } from './parseSkill';

/** A skill is instructions: anything bigger than this is not one. */
const MAX_BYTES = 200 * 1024;

/** The shallowest SKILL.md in an unzipped folder. */
async function findSkillFile(dir: string, depth = 0): Promise<string | null> {
  const entries = await RNFS.readDir(dir);
  const here = entries.find((e) => e.isFile() && e.name.toLowerCase() === 'skill.md');
  if (here) return here.path;
  if (depth >= 3) return null;
  for (const e of entries.filter((x) => x.isDirectory() && !x.name.startsWith('.') && x.name !== '__MACOSX')) {
    const found = await findSkillFile(e.path, depth + 1);
    if (found) return found;
  }
  return null;
}

async function readText(path: string): Promise<string> {
  const stat = await RNFS.stat(path);
  if (Number(stat.size) > MAX_BYTES) throw new SkillFormatError('That file is too big to be a skill (over 200 KB). A skill is a short set of instructions.');
  return RNFS.readFile(path, 'utf8');
}

/** The skill in a picked SKILL.md (or any .md / .txt) file, or in a zipped skill folder. Files next to SKILL.md are ignored. */
export async function readSkillFile(uri: string, name: string): Promise<ParsedSkill> {
  const local = (await resolvePickedFileUri(uri, name || 'skill.md')).replace(/^file:\/\//, '');
  if (!/\.zip$/i.test(name)) return parseSkill(await readText(local));
  const dir = `${RNFS.CachesDirectoryPath}/skill-import-${Date.now()}`;
  try {
    await unzip(local, dir);
    const found = await findSkillFile(dir);
    if (!found) throw new SkillFormatError('There is no SKILL.md in that zip.');
    return parseSkill(await readText(found));
  } finally {
    RNFS.unlink(dir).catch(() => undefined);
  }
}

/** Opens the file picker and reads the chosen skill; null when the person closes the picker. */
export async function pickSkill(): Promise<ParsedSkill | null> {
  let files;
  try { files = await pick({ mode: 'open', type: [types.allFiles], allowMultiSelection: false }); } catch { return null; }
  const file = files?.[0];
  return file ? readSkillFile(file.uri, file.name || 'skill.md') : null;
}
