/**
 * Atlas: read Word, PowerPoint, Excel, OpenDocument, EPUB and RTF files as plain text, offline.
 * The Office/OpenDocument/EPUB formats are zip files full of XML, so we unzip and pull out the text.
 */
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { docxToMarkdown, htmlToMarkdown, sheetMarkdown, slideMarkdown } from './markdownConvert';

export const OFFICE_EXTENSIONS = ['.docx', '.pptx', '.xlsx', '.odt', '.ods', '.odp', '.epub', '.rtf'];

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const tidy = (s: string) => decode(s.replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const read = async (p: string) => ((await RNFS.exists(p)) ? RNFS.readFile(p, 'utf8') : '');
const num = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

async function docx(dir: string): Promise<string> {
  const x = await read(`${dir}/word/document.xml`);
  return tidy(x.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:tc>/g, ' | ').replace(/<\/w:tr>/g, '\n').replace(/<\/w:p>/g, '\n'));
}

async function pptx(dir: string): Promise<string> {
  const sd = `${dir}/ppt/slides`;
  if (!(await RNFS.exists(sd))) return '';
  const slides = (await RNFS.readDir(sd)).filter((f) => /^slide\d+\.xml$/.test(f.name)).sort((a, b) => num(a.name) - num(b.name));
  const out: string[] = [];
  for (const f of slides) {
    const t = tidy((await RNFS.readFile(f.path, 'utf8')).replace(/<\/a:p>/g, '\n'));
    const notesPath = `${dir}/ppt/notesSlides/notesSlide${num(f.name)}.xml`;
    const notes = tidy((await read(notesPath)).replace(/<\/a:p>/g, '\n')).replace(/^\d+\s*$/m, '').trim();
    out.push(`--- Slide ${num(f.name)} ---\n${t}${notes ? `\n(Notes: ${notes})` : ''}`);
  }
  return out.join('\n\n');
}

async function pptxMarkdown(dir: string): Promise<string> {
  const sd = `${dir}/ppt/slides`;
  if (!(await RNFS.exists(sd))) return '';
  const slides = (await RNFS.readDir(sd)).filter((f) => /^slide\d+\.xml$/.test(f.name)).sort((a, b) => num(a.name) - num(b.name));
  const out: string[] = [];
  for (const f of slides) {
    const paragraphs = (await RNFS.readFile(f.path, 'utf8')).split('</a:p>').map((p) => tidy(p)).filter(Boolean);
    const notes = tidy((await read(`${dir}/ppt/notesSlides/notesSlide${num(f.name)}.xml`)).replace(/<\/a:p>/g, '\n')).replace(/^\d+\s*$/m, '').trim();
    out.push(slideMarkdown(num(f.name), { title: paragraphs[0] ?? '', paragraphs: paragraphs.slice(1), notes }));
  }
  return out.join('\n\n');
}

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The sheets of a workbook as rows of cell values. */
async function xlsxSheets(dir: string): Promise<Array<{ name: string; rows: string[][] }>> {
  const shared: string[] = [];
  const ss = await read(`${dir}/xl/sharedStrings.xml`);
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(tidy(m[1]));
  const wb = await read(`${dir}/xl/workbook.xml`);
  const names = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decode(m[1]));
  const wsDir = `${dir}/xl/worksheets`;
  if (!(await RNFS.exists(wsDir))) return [];
  const sheets = (await RNFS.readDir(wsDir)).filter((f) => /^sheet\d+\.xml$/.test(f.name)).sort((a, b) => num(a.name) - num(b.name));
  const out: Array<{ name: string; rows: string[][] }> = [];
  for (const f of sheets) {
    const x = await RNFS.readFile(f.path, 'utf8');
    const rows: string[][] = [];
    for (const r of x.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells: string[] = [];
      for (const c of (r[1] || '').matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]; const body = c[2] || '';
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const type = attrs.match(/t="(\w+)"/)?.[1];
        let v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
        if (type === 's') v = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') v = tidy(body);
        else v = decode(v);
        const i = ref ? colIndex(ref) : cells.length;
        while (cells.length < i) cells.push('');
        cells[i] = v;
      }
      if (cells.some((c) => c !== '')) rows.push(cells);
    }
    out.push({ name: names[num(f.name) - 1] || f.name, rows });
  }
  return out;
}

const csvCell = (v: string) => (v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);

async function xlsx(dir: string): Promise<string> {
  return (await xlsxSheets(dir)).map((s) => `--- Sheet: ${s.name} ---\n${s.rows.map((r) => r.map(csvCell).join(',')).join('\n')}`).join('\n\n');
}

async function xlsxMarkdown(dir: string): Promise<string> {
  return (await xlsxSheets(dir)).map((s) => sheetMarkdown(s.name, s.rows)).join('\n\n');
}

async function odf(dir: string): Promise<string> {
  const x = await read(`${dir}/content.xml`);
  return tidy(x.replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n').replace(/<\/table:table-cell>/g, ' | ').replace(/<\/table:table-row>/g, '\n').replace(/<\/text:(p|h)>/g, '\n').replace(/<draw:page [^>]*draw:name="([^"]*)"/g, '\n--- $1 ---\n<x'));
}

async function epub(dir: string): Promise<string> {
  const container = await read(`${dir}/META-INF/container.xml`);
  const opfRel = container.match(/full-path="([^"]+)"/)?.[1];
  if (!opfRel) return '';
  const opf = await read(`${dir}/${opfRel}`);
  const base = opfRel.includes('/') ? opfRel.slice(0, opfRel.lastIndexOf('/') + 1) : '';
  const items: Record<string, string> = {};
  for (const m of opf.matchAll(/<item [^>]*>/g)) {
    const id = m[0].match(/id="([^"]+)"/)?.[1]; const href = m[0].match(/href="([^"]+)"/)?.[1];
    if (id && href && !decodeURIComponent(href).includes('..')) items[id] = decodeURIComponent(href);
  }
  const order = [...opf.matchAll(/<itemref [^>]*idref="([^"]+)"/g)].map((m) => items[m[1]]).filter(Boolean);
  const out: string[] = [];
  for (const href of order) {
    const h = await read(`${dir}/${base}${href}`);
    const body = h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
    const t = tidy(body);
    if (t) out.push(t);
  }
  return out.join('\n\n');
}

async function epubMarkdown(dir: string): Promise<string> {
  const container = await read(`${dir}/META-INF/container.xml`);
  const opfRel = container.match(/full-path="([^"]+)"/)?.[1];
  if (!opfRel) return '';
  const opf = await read(`${dir}/${opfRel}`);
  const base = opfRel.includes('/') ? opfRel.slice(0, opfRel.lastIndexOf('/') + 1) : '';
  const items: Record<string, string> = {};
  for (const m of opf.matchAll(/<item [^>]*>/g)) {
    const id = m[0].match(/id="([^"]+)"/)?.[1]; const href = m[0].match(/href="([^"]+)"/)?.[1];
    if (id && href && !decodeURIComponent(href).includes('..')) items[id] = decodeURIComponent(href);
  }
  const order = [...opf.matchAll(/<itemref [^>]*idref="([^"]+)"/g)].map((m) => items[m[1]]).filter(Boolean);
  const out: string[] = [];
  for (const href of order) {
    const md = htmlToMarkdown(await read(`${dir}/${base}${href}`));
    if (md) out.push(md);
  }
  return out.join('\n\n');
}

function rtf(text: string): string {
  // Drop header groups (fonts, colours, styles, info) with a brace-depth scan.
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' && /^\{\\(\*|fonttbl|colortbl|stylesheet|info|expandedcolortbl|listtable|listoverridetable|pict)/.test(text.slice(i, i + 24))) {
      let depth = 0;
      for (; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) break;
      }
      continue;
    }
    out += text[i];
  }
  return out
    .replace(/\\u(-?\d+) ?(\\'[0-9a-f]{2}|\?)?/gi, (_, d) => String.fromCharCode((Number(d) + 65536) % 65536))
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\pard?(?![a-z])/g, '\n').replace(/\\line(?![a-z])/g, '\n').replace(/\\tab(?![a-z])/g, '\t')
    .replace(/\\\n/g, '\n')
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** Extract readable text from an office/ebook file at a local path. */
export async function extractOffice(path: string, ext: string, maxChars: number): Promise<string> {
  if (ext === '.rtf') return rtf(await RNFS.readFile(path, 'utf8')).slice(0, maxChars);
  const dir = `${RNFS.CachesDirectoryPath}/office_${Date.now()}`;
  try {
    await unzip(path, dir);
    let text = '';
    if (ext === '.docx') text = await docx(dir);
    else if (ext === '.pptx') text = await pptx(dir);
    else if (ext === '.xlsx') text = await xlsx(dir);
    else if (ext === '.epub') text = await epub(dir);
    else text = await odf(dir);
    if (!text.trim()) throw new Error('No text found in this file (it may contain only pictures).');
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n... [Content truncated due to length]` : text;
  } finally {
    RNFS.unlink(dir).catch(() => undefined);
  }
}

/** The same files as Markdown: Word headings, lists and tables, slides as sections, sheets as tables, EPUB chapters with their headings. */
export async function extractOfficeMarkdown(path: string, ext: string, maxChars: number): Promise<string> {
  if (ext === '.rtf' || ext === '.odt' || ext === '.ods' || ext === '.odp') return extractOffice(path, ext, maxChars);
  const dir = `${RNFS.CachesDirectoryPath}/office_${Date.now()}`;
  try {
    await unzip(path, dir);
    let text = '';
    if (ext === '.docx') text = docxToMarkdown(await read(`${dir}/word/document.xml`));
    else if (ext === '.pptx') text = await pptxMarkdown(dir);
    else if (ext === '.xlsx') text = await xlsxMarkdown(dir);
    else if (ext === '.epub') text = await epubMarkdown(dir);
    if (!text.trim()) throw new Error('No text found in this file (it may contain only pictures).');
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n... [Content truncated due to length]` : text;
  } finally {
    RNFS.unlink(dir).catch(() => undefined);
  }
}
