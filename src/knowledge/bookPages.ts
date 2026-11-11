import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { pdfExtractPages, pdfPageCount } from '../services/pdfExtractor';
import { htmlToText, opfPath, paginateText, resolveHref, spineHrefs, type BookKind } from './textPages';

/** The pages of a text or EPUB book are worked out once and kept beside the stored original, so later batches just read them. */
const sidecar = (path: string) => `${path}.pages.json`;

async function epubText(path: string): Promise<string> {
  const tmp = `${RNFS.CachesDirectoryPath}/epub-${Date.now()}`;
  await RNFS.mkdir(tmp);
  try {
    await unzip(path, tmp);
    const container = await RNFS.readFile(`${tmp}/META-INF/container.xml`, 'utf8');
    const opf = opfPath(container);
    if (!opf) throw new Error('This EPUB has no package file.');
    const hrefs = spineHrefs(await RNFS.readFile(`${tmp}/${opf}`, 'utf8'));
    if (!hrefs.length) throw new Error('This EPUB has no chapters to read.');
    const chapters: string[] = [];
    for (const href of hrefs) {
      const file = `${tmp}/${resolveHref(opf, href)}`;
      if (await RNFS.exists(file)) chapters.push(htmlToText(await RNFS.readFile(file, 'utf8')));
    }
    return chapters.filter(Boolean).join('\n\n');
  } finally { RNFS.unlink(tmp).catch(() => undefined); }
}

async function textPages(path: string, kind: Exclude<BookKind, 'pdf'>): Promise<string[]> {
  if (await RNFS.exists(sidecar(path))) return JSON.parse(await RNFS.readFile(sidecar(path), 'utf8'));
  const text = kind === 'epub' ? await epubText(path) : await RNFS.readFile(path, 'utf8');
  const pages = paginateText(text);
  if (!pages.length) throw new Error('There is no readable text in that file.');
  await RNFS.writeFile(sidecar(path), JSON.stringify(pages), 'utf8');
  return pages;
}

export async function bookPageCount(path: string, kind: BookKind): Promise<number> {
  return kind === 'pdf' ? pdfPageCount(path) : (await textPages(path, kind)).length;
}

export async function bookExtractPages(path: string, kind: BookKind, range: { start: number; count: number }): Promise<string[]> {
  const { start, count } = range;
  return kind === 'pdf' ? pdfExtractPages(path, start, count) : (await textPages(path, kind)).slice(start, start + count);
}

export const removeBookSidecar = (path: string) => RNFS.unlink(sidecar(path)).catch(() => undefined);
