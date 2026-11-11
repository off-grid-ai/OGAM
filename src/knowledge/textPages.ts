/**
 * Plain text, Markdown and EPUB books as the "pages" the study pipeline reads. A text file is cut into pages of about
 * 3,000 characters at paragraph breaks; an EPUB is unpacked and its chapters (in reading order) are turned into text first.
 * The page numbers are therefore positions in the text, not printed pages. Pure parts are tested without a device.
 */
export type BookKind = 'pdf' | 'epub' | 'text';

export const PAGE_CHARS = 3000;

export function bookKind(fileName: string): BookKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'epub') return 'epub';
  if (ext && ['txt', 'md', 'markdown', 'text'].includes(ext)) return 'text';
  return null;
}

/** Cuts text into pages of at most `max` characters, at paragraph, line or sentence breaks where it can. */
export function paginateText(text: string, max = PAGE_CHARS): string[] {
  const pages: string[] = [];
  let rest = text.replace(/\r\n?/g, '\n').trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. '));
    const at = cut > max * 0.5 ? cut + 1 : max;
    pages.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) pages.push(rest);
  return pages;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/** The readable text of an XHTML chapter: no tags, scripts or styles; paragraphs and headings kept as separate lines. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The path of the package (.opf) file named in META-INF/container.xml. */
export function opfPath(containerXml: string): string | null {
  return /full-path\s*=\s*["']([^"']+)["']/i.exec(containerXml)?.[1] ?? null;
}

/** The chapter files of an EPUB in reading order, relative to the .opf file. */
export function spineHrefs(opfXml: string): string[] {
  const manifest = new Map<string, string>();
  for (const m of opfXml.matchAll(/<item\b[^>]*>/gi)) {
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    if (id && href) manifest.set(id, decodeURIComponent(href));
  }
  const out: string[] = [];
  for (const m of opfXml.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = /\bidref\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    const href = idref ? manifest.get(idref) : undefined;
    if (href && /\.(x?html?)$/i.test(href)) out.push(href);
  }
  return out;
}

/** Joins a chapter's relative path onto the folder of the .opf file. */
export function resolveHref(opfFile: string, href: string): string {
  const base = opfFile.includes('/') ? opfFile.slice(0, opfFile.lastIndexOf('/') + 1) : '';
  const parts = `${base}${href}`.split('/');
  const out: string[] = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}
