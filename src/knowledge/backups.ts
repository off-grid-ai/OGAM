/**
 * Keeping learning reports safe. Every cycle's report is already saved in the app's storage when it ends. This adds:
 *   - an automatic backup (at most one a day, the last seven kept) of everything learned, as the same interchange zip an export makes;
 *   - restoring from any backup, which is safe to repeat (import matches by id and content, so nothing doubles);
 *   - all cycle reports in one readable Markdown file.
 * The backups sit in the app's own storage, so they do not survive uninstalling the app: "Save to Files" copies one out.
 */
import RNFS from 'react-native-fs';
import { applyImport, createExport, type ImportReport } from './exchange';
import { cycleMarkdown, listCycles, readReport } from './cycles';
import { P, ensureDir, listDir, nowIso, removeTree } from './storage';

const KEEP = 7;
const DAY = 86400000;
export interface Backup { name: string; path: string; day: string; bytes: number }

const nameFor = (day: string) => `atlas-learning-backup-${day}.zip`;
const dayOf = (iso: string) => iso.slice(0, 10);

export async function listBackups(): Promise<Backup[]> {
  const names = (await listDir(P.backupsDir())).filter((n) => /^atlas-learning-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(n)).sort().reverse();
  const out: Backup[] = [];
  for (const name of names) { const path = `${P.backupsDir()}/${name}`; try { out.push({ name, path, day: name.slice(22, 32), bytes: Number((await RNFS.stat(path)).size) }); } catch { /* gone */ } }
  return out;
}

let inflight: Promise<Backup | null> | null = null;

/** Makes today's backup unless one was made in the last day (or `force`). Returns it, or null when nothing needed doing or there is nothing learned yet. */
export function autoBackup(opts: { force?: boolean; now?: string } = {}): Promise<Backup | null> {
  // Two study runs finishing close together must not both build a full export at once.
  if (!inflight) inflight = makeBackup(opts).finally(() => { inflight = null; });
  return inflight;
}

async function makeBackup(opts: { force?: boolean; now?: string }): Promise<Backup | null> {
  const now = opts.now ?? nowIso();
  const existing = await listBackups();
  if (!opts.force && existing[0] && Date.parse(now) - Date.parse(`${existing[0].day}T00:00:00Z`) < DAY) return null;
  if (!(await listCycles()).length) return null;
  await ensureDir(P.backupsDir());
  const { path } = await createExport({ scope: { kind: 'all' }, quiet: true });
  const target = `${P.backupsDir()}/${nameFor(dayOf(now))}`;
  if (await RNFS.exists(target)) await RNFS.unlink(target);
  await RNFS.moveFile(path, target);
  for (const old of (await listBackups()).slice(KEEP)) await removeTree(old.path);
  return (await listBackups()).find((b) => b.path === target) ?? null;
}

/** Puts a backup's knowledge back. Anything already here is left alone and nothing is duplicated. */
export async function restoreBackup(path: string): Promise<ImportReport> {
  return applyImport(path);
}

/** Every cycle's report, newest first, as one Markdown document. */
export async function allReportsMarkdown(limit = 500): Promise<{ text: string; cycles: number }> {
  const cycles = (await listCycles()).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, limit);
  const parts: string[] = [];
  for (const c of cycles) { const r = await readReport(c.dir); if (r) parts.push(cycleMarkdown(r)); }
  return { text: parts.length ? `# Atlas learning reports\n\nExported ${nowIso()}. ${parts.length} cycle${parts.length === 1 ? '' : 's'}, newest first.\n\n${parts.join('\n\n---\n\n')}\n` : '', cycles: parts.length };
}
