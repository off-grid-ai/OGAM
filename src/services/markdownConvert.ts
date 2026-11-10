/**
 * Documents as Markdown. Models read headings, lists and tables far better than flat text, and a heading gives a search chunk
 * its place in the document. These functions turn what Atlas already extracts (HTML, CSV, JSON, the XML inside Word, PowerPoint,
 * Excel and EPUB files, and PDF text) into Markdown. All are pure, so they are tested without a device. Nothing is invented: a
 * heading is only made where the file marks one (or, for a PDF, where a line clearly is one).
 */

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export const decodeEntities = (s: string): string => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

const squeeze = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

/** Rows of cells as a Markdown table (the first row is the header). Rows are padded to the widest. */
export function tableMarkdown(rows: string[][]): string {
  const data = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!data.length) return '';
  const width = Math.max(...data.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => cell(r[i] ?? ''));
  const [head, ...body] = data.map(pad);
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

// ------------------------------------------------------------------ HTML (web pages, EPUB chapters)
function htmlTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    const rows = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[hd]\b[\s\S]*?<\/t[hd]>/gi)].map((c) => decodeEntities(c[0].replace(/<[^>]+>/g, ' '))));
    return `\n\n${tableMarkdown(rows)}\n\n`;
  });
}

export function htmlToMarkdown(html: string): string {
  let s = html
    .replace(/<(script|style|head|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  s = htmlTables(s);
  // Code is set aside first: after decoding, "a < b" must not look like a tag to the tag-stripping below.
  const kept: string[] = [];
  const keep = (text: string) => { kept.push(text); return `@@KEEP${kept.length - 1}@@`; };
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => `\n\n${keep(`\`\`\`\n${decodeEntities(code.replace(/<[^>]+>/g, ''))}\n\`\`\``)}\n\n`);
  s = s
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Number(n))} ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => { const label = t.replace(/<[^>]+>/g, '').trim(); return /^https?:/i.test(href) && label ? `[${label}](${href})` : label; })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => (t.trim() ? `**${t.trim()}**` : t))
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => (t.trim() ? `*${t.trim()}*` : t))
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => keep(`\`${decodeEntities(t.replace(/<[^>]+>/g, ''))}\``))
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|ul|ol|blockquote|tr)>|<br\s*\/?>|<hr\s*\/?>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return squeeze(decodeEntities(s)).replace(/@@KEEP(\d+)@@/g, (_, i) => kept[Number(i)]).replace(/\n{3,}/g, '\n\n');
}

// ------------------------------------------------------------------ CSV / TSV / JSON
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
export const csvToMarkdown = (text: string, delimiter = ','): string => tableMarkdown(parseDelimited(text, delimiter));

export function jsonToMarkdown(text: string): string {
  try { return `\`\`\`json\n${JSON.stringify(JSON.parse(text), null, 2)}\n\`\`\``; } catch { return text; }
}

// ------------------------------------------------------------------ PDF text
/**
 * A PDF has no headings, only lines. A line is made a heading only when it clearly is one: a numbered section title ("2.1 Cash
 * flow"), "Chapter 3 ...", or a short ALL-CAPS line standing alone. Everything else is left as it is.
 */
export function pdfTextToMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const alone = (lines[i - 1] ?? '').trim() === '' && (lines[i + 1] ?? '').trim() === '';
    const next = (lines[i + 1] ?? '').trim();
    const numbered = /^(\d+(?:\.\d+){0,3})[.)]?\s+[A-Z][^.!?]{2,68}$/.exec(line);
    const chapter = /^(chapter|part|section|unit|appendix)\s+[\dIVXLC]+\b.{0,60}$/i.test(line);
    const caps = alone && /^[A-Z0-9][A-Z0-9 ,:&'’\-–—/()]{3,58}$/.test(line) && /[A-Z]{3}/.test(line);
    if (chapter) out.push('', `# ${line}`, '');
    else if (numbered && (alone || next === '')) out.push('', `${'#'.repeat(Math.min(4, numbered[1].split('.').length + 1))} ${line}`, '');
    else if (caps) out.push('', `## ${line}`, '');
    else out.push(raw);
  });
  return squeeze(out.join('\n'));
}

// ------------------------------------------------------------------ Word (.docx word/document.xml)
const unxml = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ''));

function docxRuns(paragraph: string): string {
  let out = '';
  for (const r of paragraph.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)) {
    const run = r[0];
    const text = [...run.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => unxml(m[1])).join('') + (/<w:tab\/>/.test(run) ? '\t' : '') + (/<w:br\b/.test(run) ? '\n' : '');
    if (!text) continue;
    const bold = /<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(run);
    const italic = /<w:i\/>|<w:i w:val="(?:1|true)"\/>/.test(run);
    out += text.trim() && (bold || italic) ? text.replace(/^(\s*)(.*?)(\s*)$/s, (_, a, b, c) => `${a}${bold && italic ? '***' : bold ? '**' : '*'}${b}${bold && italic ? '***' : bold ? '**' : '*'}${c}`) : text;
  }
  return out;
}

export function docxToMarkdown(xml: string): string {
  const body = xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const rows = [...tbl.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) => [...c[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => unxml(p[0].replace(/<\/w:t>/g, ' '))).join(' ')));
    return `<w:p><w:r><w:t>@@TABLE${JSON.stringify(rows)}@@</w:t></w:r></w:p>`;
  });
  const out: string[] = [];
  for (const m of body.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const p = m[0];
    const table = /@@TABLE(\[[\s\S]*\])@@/.exec(unxml(p.replace(/&quot;/g, '"')));
    if (table) { try { out.push(tableMarkdown(JSON.parse(table[1]))); } catch { /* skip a table that cannot be read */ } continue; }
    const text = docxRuns(p).replace(/\n+/g, ' ').trim();
    if (!text) continue;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
    const heading = /^(?:Heading|heading)\s?(\d)$/.exec(style) ?? (style === 'Title' ? ['', '1'] : null);
    if (heading) out.push(`${'#'.repeat(Math.min(6, Number(heading[1])))} ${text.replace(/\*+/g, '')}`);
    else if (/<w:numPr>/.test(p) || /ListParagraph|ListBullet|ListNumber/i.test(style)) {
      const level = Number(/<w:ilvl w:val="(\d)"/.exec(p)?.[1] ?? 0);
      out.push(`${'  '.repeat(level)}${/ListNumber/i.test(style) ? '1.' : '-'} ${text}`);
    } else out.push(text);
  }
  // Consecutive list items stay together; everything else is a paragraph of its own.
  return out.reduce((acc, line, i) => acc + (i === 0 ? '' : /^\s*(-|\d+\.) /.test(line) && /^\s*(-|\d+\.) /.test(out[i - 1]) ? '\n' : '\n\n') + line, '').trim();
}

// ------------------------------------------------------------------ PowerPoint / Excel
export const slideMarkdown = (n: number, title: string, paragraphs: string[], notes = ''): string =>
  [`## Slide ${n}${title ? `: ${title}` : ''}`, ...paragraphs.filter(Boolean).map((p) => `- ${p}`), ...(notes ? ['', `Notes: ${notes}`] : [])].join('\n');

export const sheetMarkdown = (name: string, rows: string[][]): string => `## Sheet: ${name}\n\n${tableMarkdown(rows)}`;

/** Converts text read from a file to Markdown by its extension. JSON, plain text and Markdown are already readable and are returned as they are. */
export function toMarkdown(text: string, ext: string): string {
  switch (ext.toLowerCase()) {
    case '.html': case '.htm': return htmlToMarkdown(text);
    case '.csv': return csvToMarkdown(text, ',');
    case '.tsv': return csvToMarkdown(text, '\t');
    case '.pdf': return pdfTextToMarkdown(text);
    default: return text;
  }
}
