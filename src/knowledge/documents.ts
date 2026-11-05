/**
 * Documents the person gives Atlas to study. A PDF goes through five steps, each of which can be interrupted and resumed:
 *
 *   import   copy into private storage, SHA-256, recognise a document already imported
 *   extract  page text, 20 pages at a time, page numbers kept; pages with no text are listed (read with the vision model when one is loaded)
 *   chunk    section-aware chunks of 500-1,000 tokens, 50 to a file
 *   study    the expert reads chunks in small batches and files cited findings (study.ts)
 *   remove   delete the original, its text and chunks, and the knowledge that rests only on it
 *
 * Progress is written after every batch (atomically), so a killed app resumes at the batch it was on. Nothing holds the whole
 * document: pages move through the chunker one at a time and files hold a few dozen records each.
 */
import RNFS from 'react-native-fs';
import { ocrAvailable, ocrPage } from './ocr';
import { SCHEMA_VERSION, type ChunkRecord, type SourceDocument } from './schema';
import {
  P, appendJsonl, atomicWriteText, ensureDir, nowIso, readJson, readJsonl, removeTree, sha256Text, uuid, withLock, writeJson,
} from './storage';
import { Chunker } from './chunker';
import { eraseFindings, findingsCiting } from './cycles';
import { pdfExtractPages, pdfPageCount } from '../services/pdfExtractor';
import { resolvePickedFileUri } from '../utils/resolvePickedFileUri';

export const PAGES_PER_FILE = 20;
export const CHUNKS_PER_FILE = 25;
/** A page with fewer readable characters than this is treated as a scan or an image, not text. */
const MIN_PAGE_CHARS = 20;

interface DocIndex { docs: SourceDocument[] }
export async function listDocuments(opts: { includeRemoved?: boolean } = {}): Promise<SourceDocument[]> {
  const docs = (await readJson<DocIndex>(P.docsIndex(), { docs: [] })).docs;
  return opts.includeRemoved ? docs : docs.filter((d) => !d.removed);
}
export async function getDocument(sourceId: string): Promise<SourceDocument | null> {
  return (await listDocuments({ includeRemoved: true })).find((d) => d.sourceId === sourceId) ?? null;
}
export async function saveDocument(doc: SourceDocument): Promise<void> {
  await withLock('docs-index', async () => {
    const all = (await readJson<DocIndex>(P.docsIndex(), { docs: [] })).docs;
    const i = all.findIndex((d) => d.sourceId === doc.sourceId);
    if (i >= 0) all[i] = doc; else all.push(doc);
    await writeJson(P.docsIndex(), { docs: all });
  });
}
async function patchDocument(sourceId: string, change: (d: SourceDocument) => void): Promise<SourceDocument> {
  const doc = await getDocument(sourceId);
  if (!doc) throw new Error('No such document.');
  change(doc);
  await saveDocument(doc);
  return doc;
}

// ------------------------------------------------------------------ import
export interface ImportResult { doc: SourceDocument; duplicate: boolean }

/** Brings a PDF into Atlas's private storage. The same bytes imported twice are one document. */
export async function importPdf(input: { uri: string; name: string; agentId?: string; topicId?: string }): Promise<ImportResult> {
  const local = (await resolvePickedFileUri(input.uri, input.name)).replace(/^file:\/\//, '');
  const bytes = Number((await RNFS.stat(local)).size);
  const hash = await RNFS.hash(local, 'sha256');
  const existing = (await listDocuments()).find((d) => d.hash === hash);
  if (existing) return { doc: existing, duplicate: true };
  await ensureDir(`${P.original(hash).slice(0, P.original(hash).lastIndexOf('/'))}`);
  if (!(await RNFS.exists(P.original(hash)))) await RNFS.copyFile(local, P.original(hash));
  let pages: number | undefined;
  try { pages = await pdfPageCount(P.original(hash)); } catch (e: any) {
    await removeTree(P.original(hash));
    throw new Error(`That file could not be read as a PDF (${String(e?.message || e)}).`);
  }
  const doc: SourceDocument = {
    schemaVersion: SCHEMA_VERSION, sourceId: uuid(), hash, name: input.name, title: input.name.replace(/\.pdf$/i, ''), bytes, pages,
    importedAt: nowIso(), ...(input.agentId ? { agentId: input.agentId } : {}), ...(input.topicId ? { topicId: input.topicId } : {}),
    status: 'imported', progress: { pagesExtracted: 0, chunksTotal: 0, chunksStudied: 0 }, unreadablePages: [],
  };
  await saveDocument(doc);
  return { doc, duplicate: false };
}

// ------------------------------------------------------------------ extract
interface PageRow { page: number; text: string }
const pagesFile = (hash: string, n: number) => `${P.extractedDir(hash)}/pages-${String(n).padStart(4, '0')}.jsonl`;

export interface RunOptions { shouldStop?: () => boolean; onProgress?: (doc: SourceDocument) => void }

/** Reads the PDF's text a few pages at a time and stores it page by page. Resumes where an earlier run stopped. */
/** Replaces the text of pages with no text by what the vision model reads from their picture (when one is loaded). Returns the pages it filled. */
async function readPagesByOcr(pdfPath: string, rows: PageRow[], shouldStop?: () => boolean): Promise<number[]> {
  if (!ocrAvailable()) return [];
  const done: number[] = [];
  for (const row of rows) {
    if (shouldStop?.()) break; // Pause stops between pages; pages not read yet stay flagged and are picked up on a later run
    if (row.text.replace(/\s/g, '').length >= MIN_PAGE_CHARS) continue;
    try { const text = (await ocrPage(pdfPath, row.page - 1)).trim(); if (text.replace(/\s/g, '').length >= MIN_PAGE_CHARS) { row.text = text; done.push(row.page); } } catch { /* the page stays flagged */ }
  }
  return done;
}

export async function extractDocument(sourceId: string, opts: RunOptions = {}): Promise<SourceDocument> {
  let doc = (await getDocument(sourceId))!;
  if (!doc) throw new Error('No such document.');
  if (doc.status === 'ready' || doc.status === 'studying' || doc.status === 'done') return doc;
  const total = doc.pages ?? (await pdfPageCount(P.original(doc.hash)));
  doc = await patchDocument(sourceId, (d) => { d.pages = total; d.status = 'extracting'; d.error = undefined; });
  while (doc.progress.pagesExtracted < total) {
    if (opts.shouldStop?.()) return patchDocument(sourceId, (d) => { d.status = 'paused'; });
    const start = doc.progress.pagesExtracted;
    const texts = await pdfExtractPages(P.original(doc.hash), start, PAGES_PER_FILE);
    if (!texts.length) throw new Error(`The PDF returned no pages at page ${start + 1}.`);
    const rows: PageRow[] = texts.map((text, i) => ({ page: start + i + 1, text }));
    await atomicWriteText(pagesFile(doc.hash, Math.floor(start / PAGES_PER_FILE) + 1), `${rows.map((r) => JSON.stringify(r)).join('\n')  }\n`);
    const ocrDone = await readPagesByOcr(P.original(doc.hash), rows, opts.shouldStop);
    const unreadable = rows.filter((r) => r.text.replace(/\s/g, '').length < MIN_PAGE_CHARS).map((r) => r.page);
    doc = await patchDocument(sourceId, (d) => {
      d.progress.pagesExtracted = start + texts.length;
      d.unreadablePages = Array.from(new Set([...d.unreadablePages.filter((p) => !ocrDone.includes(p)), ...unreadable])).sort((a, b) => a - b);
      if (ocrDone.length) d.ocrPages = Array.from(new Set([...(d.ocrPages ?? []), ...ocrDone])).sort((a, b) => a - b);
    });
    opts.onProgress?.(doc);
  }
  return patchDocument(sourceId, (d) => { d.status = 'chunking'; });
}

// ------------------------------------------------------------------ chunk
const chunkFile = (hash: string, n: number) => `${P.chunksDir(hash)}/part-${String(n).padStart(4, '0')}.jsonl`;

async function* pageStream(hash: string, totalPages: number): AsyncGenerator<PageRow> {
  for (let n = 1; n <= Math.ceil(totalPages / PAGES_PER_FILE); n++) for (const row of await readJsonl<PageRow>(pagesFile(hash, n))) yield row;
}

/** Splits the extracted pages into chunks. Re-running gives identical ids, and a part file already correct is not rewritten. */
export async function chunkDocument(sourceId: string): Promise<SourceDocument> {
  const doc = (await getDocument(sourceId))!;
  if (!doc) throw new Error('No such document.');
  if (doc.status === 'ready' || doc.status === 'studying' || doc.status === 'done') return doc;
  lastPart = null;
  const chunker = new Chunker({ sourceId: doc.sourceId, sourceHash: doc.hash });
  let buffer: ChunkRecord[] = []; let part = 1; let total = 0;
  const writePart = async () => {
    if (!buffer.length) return;
    const text = `${buffer.map((c) => JSON.stringify(c)).join('\n')  }\n`;
    const path = chunkFile(doc.hash, part);
    if (!(await RNFS.exists(path)) || (await RNFS.readFile(path, 'utf8')) !== text) await atomicWriteText(path, text);
    total += buffer.length; part++; buffer = [];
  };
  for await (const row of pageStream(doc.hash, doc.pages ?? doc.progress.pagesExtracted)) {
    for (const c of chunker.push(row.page, row.text)) { buffer.push(c); if (buffer.length === CHUNKS_PER_FILE) await writePart(); }
  }
  for (const c of chunker.flush()) { buffer.push(c); if (buffer.length === CHUNKS_PER_FILE) await writePart(); }
  await writePart();
  return patchDocument(sourceId, (d) => { d.progress.chunksTotal = total; d.status = total > 0 ? 'ready' : 'failed'; if (!total) d.error = 'No readable text was found in this PDF (it may be scanned images; load a vision model to read them).'; });
}

// The part being read stays in memory so consecutive small reads do not re-read the file; cleared whenever chunks are rewritten.
let lastPart: { path: string; rows: ChunkRecord[] } | null = null;
async function readPart(path: string): Promise<ChunkRecord[]> {
  if (lastPart?.path === path) return lastPart.rows;
  const rows = await readJsonl<ChunkRecord>(path);
  lastPart = { path, rows };
  return rows;
}

/** `count` chunks from position `from`, reading only the part files that hold them. */
export async function readChunks(hash: string, from: number, count: number): Promise<ChunkRecord[]> {
  const out: ChunkRecord[] = [];
  for (let n = Math.floor(from / CHUNKS_PER_FILE) + 1; n <= Math.floor((from + count - 1) / CHUNKS_PER_FILE) + 1; n++) {
    for (const c of await readPart(chunkFile(hash, n))) if (c.ordinal >= from && c.ordinal < from + count) out.push(c);
  }
  return out.sort((a, b) => a.ordinal - b.ordinal);
}

export async function markStudied(sourceId: string, chunksStudied: number, status?: SourceDocument['status']): Promise<SourceDocument> {
  return patchDocument(sourceId, (d) => { d.progress.chunksStudied = chunksStudied; if (status) d.status = status; });
}
export async function setDocumentStatus(sourceId: string, status: SourceDocument['status'], error?: string): Promise<SourceDocument> {
  return patchDocument(sourceId, (d) => { d.status = status; d.error = error; });
}
export async function assignDocument(sourceId: string, agentId: string, topicId: string): Promise<SourceDocument> {
  return patchDocument(sourceId, (d) => { d.agentId = agentId; d.topicId = topicId; });
}

// ------------------------------------------------------------------ remove
/**
 * Deletes a source and what rests on it: the PDF, its text and chunks, and every finding whose only evidence is this document.
 * A finding that also has another source keeps that source. A tombstone is left so a later import of an old export does not
 * bring the document's knowledge back.
 */
export async function removeDocument(sourceId: string): Promise<{ erasedFindings: number }> {
  const doc = await getDocument(sourceId);
  if (!doc) return { erasedFindings: 0 };
  const citing = await findingsCiting(doc.hash);
  const onlyThis = citing.filter((f) => f.evidence.every((e) => e.sourceHash === doc.hash)).map((f) => f.recordId);
  const erasedFindings = await eraseFindings(onlyThis, `source ${doc.name} was removed`);
  await removeTree(P.original(doc.hash)); await removeTree(P.extractedDir(doc.hash)); await removeTree(P.chunksDir(doc.hash));
  await appendJsonl(P.tombstones(), [{ schemaVersion: SCHEMA_VERSION, tombstoneId: uuid(), kind: 'document', targetId: doc.sourceId, targetHash: doc.hash, reason: 'removed by the person', createdAt: nowIso() }]);
  // Keep a minimal record (no name) so the removal is visible and the same bytes are not mistaken for something never seen.
  await saveDocument({ ...doc, name: '(removed)', title: undefined, removed: true, status: 'failed', progress: { pagesExtracted: 0, chunksTotal: 0, chunksStudied: 0 }, unreadablePages: [] });
  return { erasedFindings };
}

/** Storage used by documents (original + text + chunks), for the control that keeps temporary data bounded. */
export async function documentBytes(hash: string): Promise<number> {
  let total = 0;
  for (const dir of [P.extractedDir(hash), P.chunksDir(hash)]) {
    if (!(await RNFS.exists(dir))) continue;
    for (const f of await RNFS.readDir(dir)) total += Number(f.size);
  }
  if (await RNFS.exists(P.original(hash))) total += Number((await RNFS.stat(P.original(hash))).size);
  return total;
}

export const documentKey = (doc: SourceDocument) => sha256Text(`${doc.hash}:${doc.sourceId}`).slice(0, 12);
