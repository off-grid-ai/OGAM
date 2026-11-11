/**
 * Saving study material outside the app: a study guide or formula sheet as a Markdown file, and
 * slides as a PowerPoint file. The phone's own "save to" picker chooses the folder (Downloads and
 * so on), so nothing is uploaded anywhere.
 */
import RNFS from 'react-native-fs';
import { isErrorWithCode, errorCodes, saveDocuments } from '@react-native-documents/picker';
import type { Source, StudyResult } from './engine';

export const MIME_MARKDOWN = 'text/markdown';
export const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** A file name that is safe on every file system and short enough to read. */
export function safeFileName(title: string, extension: string): string {
  const base = title.replace(/[^A-Za-z0-9 _-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Atlas study';
  return `${base}.${extension}`;
}

const sourceLine = (s: Source) => `[${s.n}] ${s.doc}, part ${s.part}${s.url ? ` (${s.url})` : ''}`;

/** The text of a study guide, formula sheet, answer or outline with the sources it used at the end. */
export function studyMarkdown(r: StudyResult, heading: string): string {
  const body = (r.text ?? '').trim();
  const used = new Set([...body.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
  const list = r.sources.filter((s) => used.has(s.n));
  const sources = list.length ? `\n\n## Sources\n\n${list.map((s) => `- ${sourceLine(s)}`).join('\n')}` : '';
  const topic = r.topic ? `\n\n_Topic: ${r.topic}_` : '';
  return `# ${heading}${topic}\n\n${body}${sources}\n`;
}

/** The spoken script of a podcast or briefing, line by line in the order it is played, under a dated heading. */
export function briefingTranscript(r: StudyResult, heading: string): string {
  const single = (r.hosts ?? 2) === 1;
  const lines = (r.podcast ?? []).map((l) => (single ? l.text : `**Host ${l.host}:** ${l.text}`));
  const mins = r.minutes ? ` (about ${r.minutes} min)` : '';
  return `# ${heading}${mins}\n\n${lines.join('\n\n')}\n`;
}

/** A short written summary of a briefing: the stories it covered, grouped by interest, with outlet, date and link. No model needed. */
export function briefingSummary(r: StudyResult, heading: string): string {
  const items = r.headlines ?? [];
  if (!items.length) return `# ${heading}\n\nThis briefing has no story list to summarise.\n`;
  const groups = new Map<string, typeof items>();
  for (const h of items) groups.set(h.interest || 'Other', [...(groups.get(h.interest || 'Other') ?? []), h]);
  const out = [`# ${heading} - summary`, ''];
  groups.forEach((list, topic) => {
    out.push(`## ${topic}`, '');
    for (const h of list) out.push(`- ${h.title}${h.source ? ` (${h.source}${h.date ? `, ${new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''})` : ''}${h.url ? ` ${h.url}` : ''}`);
    out.push('');
  });
  return out.join('\n');
}

/**
 * Writes a file into the app cache, lets the person pick where to save it, then removes the
 * cache copy. Resolves the saved name, or null if they closed the picker.
 */
export async function saveToPhone(fileName: string, mimeType: string, write: (path: string) => Promise<void>): Promise<string | null> {
  const path = `${RNFS.CachesDirectoryPath}/${Date.now()}-${fileName}`;
  try {
    await write(path);
    const [saved] = await saveDocuments({ sourceUris: [`file://${path}`], mimeType, fileName, copy: true });
    return saved?.name ?? fileName;
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return null;
    throw e;
  } finally {
    RNFS.unlink(path).catch(() => undefined);
  }
}

/** Lets the person save an existing file on the phone where they choose (Downloads and so on). */
export async function saveExistingFile(path: string, fileName: string, mimeType: string): Promise<string | null> {
  try {
    const [saved] = await saveDocuments({ sourceUris: [`file://${path.replace(/^file:\/\//, '')}`], mimeType, fileName, copy: true });
    return saved?.name ?? fileName;
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return null;
    throw e;
  }
}

export const saveText = (fileName: string, text: string): Promise<string | null> =>
  saveToPhone(fileName, 'text/plain', (path) => RNFS.writeFile(path, text, 'utf8'));
export const saveMarkdown = (fileName: string, text: string): Promise<string | null> =>
  saveToPhone(fileName, MIME_MARKDOWN, (path) => RNFS.writeFile(path, text, 'utf8'));
