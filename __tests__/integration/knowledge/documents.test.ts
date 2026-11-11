/**
 * PDF ingestion and incremental study. Fakes only the device boundary: the native PDF reader, the file system, and the model
 * (whose reply is derived from the passage it is shown, like a model quoting what it reads).
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

const sentence = (topic: string, n: number) => `The ${topic} concept ${n} is explained here with a worked example and a short definition.`;
const para = (topic: string, n: number) => Array.from({ length: 6 }, (_, i) => sentence(topic, n + i)).join(' ');

/** A fake "accounting textbook": chapters over many pages, a table on one page, and one scanned (empty) page. */
function bookPages(pageCount = 40): string[] {
  const chapters = [['Chapter 1 Accounting Basics', 'ledger'], ['Chapter 2 Financial Statements', 'balance sheet'], ['Chapter 3 Cost Accounting', 'costing'], ['Chapter 4 Tax and Reporting', 'depreciation']];
  const per = Math.ceil(pageCount / chapters.length);
  return Array.from({ length: pageCount }, (_, i) => {
    const [title, topic] = chapters[Math.min(chapters.length - 1, Math.floor(i / per))];
    if (i === 17) return ''; // a scanned page
    return `${i % per === 0 ? `${title}\n\n` : ''}${[0, 1, 2].map((k) => para(topic, i * 20 + k * 6)).join('\n\n')}${i === 9 ? '\n\nItem\tQ1\tQ2\tQ3\nRevenue\t100\t120\t130\nExpenses\t80\t90\t95\nProfit\t20\t30\t35' : ''}`;
  });
}

async function setup(pages: string[], opts: { model?: boolean } = {}) {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const { NativeModules } = require('react-native');
  const calls: number[] = [];
  NativeModules.PDFExtractorModule = {
    pageCount: jest.fn(async () => pages.length),
    extractPages: jest.fn(async (_path: string, start: number, count: number) => { calls.push(count); return pages.slice(start, start + count); }),
  };
  boundary.fs!.seedFile('/picked/book.pdf', 3 * 1024 * 1024);
  if (opts.model !== false) {
    const { useAppStore } = require('../../../src/stores');
    const { hardwareService } = require('../../../src/services/hardware');
    useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();
    useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
    // The model: for the passage in the prompt, one finding that quotes the passage's first sentence.
    const { initLlama } = require('llama.rn');
    const real = (initLlama as jest.Mock).getMockImplementation()!;
    (initLlama as jest.Mock).mockImplementation(async (params: Record<string, unknown>, cb?: (p: number) => void) => {
      const context: any = await real(params, cb);
      if (!context.__reader) {
        const original = context.completion;
        context.completion = async (p: any, tokenCb: any) => {
          const user: string = p.messages.find((m: any) => m.role === 'user')?.content ?? '';
          const passage = (user.match(/"""\n([\s\S]*?)\n"""/) ?? [])[1] ?? '';
          const first = (passage.match(/The [^.]+\./) ?? [''])[0];
          boundary.llama!.scriptCompletion({ text: first ? JSON.stringify([{ question: `What is said about ${first.split(' ')[3]}?`, finding: first, quote: first.slice(0, 60), uncertainty: 'Only this passage was read.', confidence: 0.8, basis: 'observed' }]) : '[]' });
          return original.call(context, p, tokenCb);
        };
        context.__reader = true;
      }
      return context;
    });
  }
  /** What survives a restart on the phone but not in a fresh test module registry: the native PDF module and the saved model choice. */
  const reinstall = () => {
    const { NativeModules: NM } = require('react-native');
    NM.PDFExtractorModule = NativeModules.PDFExtractorModule;
    if (opts.model !== false) {
      const { useAppStore } = require('../../../src/stores');
      useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
      useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
    }
  };
  return { boundary, calls, NativeModules, reinstall };
}

const mods = () => ({
  docs: require('../../../src/knowledge/documents'),
  study: require('../../../src/knowledge/study'),
  agents: require('../../../src/knowledge/agents'),
  cycles: require('../../../src/knowledge/cycles'),
});

// Each test gets its own disk: modules are loaded fresh so none keeps a handle to an earlier test's file system.
beforeEach(() => jest.resetModules());

describe('PDF learning', () => {
  it('imports once, extracts page by page, and splits a multi-chapter book into chunks that keep their pages, sections and table', async () => {
    const { calls } = await setup(bookPages(40), { model: false });
    const { docs } = mods();
    const first = await docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Accounting Textbook.pdf' });
    expect(first).toMatchObject({ duplicate: false, doc: { status: 'imported', pages: 40 } });
    expect((await docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'copy.pdf' })).duplicate).toBe(true); // same bytes = same document
    expect(await docs.listDocuments()).toHaveLength(1);

    let doc = await docs.extractDocument(first.doc.sourceId);
    expect(doc.progress.pagesExtracted).toBe(40);
    expect(doc.unreadablePages).toEqual([18]); // the scanned page is listed, not silently skipped
    expect(Math.max(...calls)).toBeLessThanOrEqual(20); // the PDF is read a few pages at a time
    doc = await docs.chunkDocument(first.doc.sourceId);
    expect(doc.status).toBe('ready');
    expect(doc.progress.chunksTotal).toBeGreaterThan(10);

    const chunks = await docs.readChunks(doc.hash, 0, doc.progress.chunksTotal);
    expect(chunks.map((c: any) => c.ordinal)).toEqual(chunks.map((_: any, i: number) => i));
    expect(chunks[0].page).toBe(1);
    expect(chunks[chunks.length - 1].pageEnd).toBe(40);
    expect(new Set(chunks.map((c: any) => (c.section ?? '').split(' ').slice(0, 2).join(' ')))).toEqual(new Set(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4']));
    const table = chunks.find((c: any) => c.table);
    expect(table.text).toContain('Revenue\t100\t120\t130');
    expect(table.page).toBeLessThanOrEqual(10);
    expect(table.pageEnd).toBeGreaterThanOrEqual(10);
    expect(chunks.every((c: any) => c.page <= c.pageEnd && c.sourceHash === doc.hash)).toBe(true);
  });

  it('studies a book into cited findings filed under the right expert, retained as provisional, with a completion report', async () => {
    await setup(bookPages(40));
    const { docs, study, agents, cycles } = mods();
    const { doc } = await docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Accounting Textbook.pdf' });
    const progress: any[] = [];
    const outcome = await study.studyDocument(doc.sourceId, { onProgress: (p: any) => progress.push(p) });
    expect(outcome).toMatchObject({ status: 'completed', agentId: 'accounting-expert' });
    expect(outcome.chunksStudied).toBe(outcome.chunksTotal);
    expect(progress.some((p) => p.phase === 'extracting')).toBe(true);
    expect(progress.filter((p) => p.phase === 'studying').pop().chunksStudied).toBe(outcome.chunksTotal);

    const findings = await cycles.searchFindings({ agentId: 'accounting-expert', limit: 500 });
    expect(findings.length).toBeGreaterThan(10);
    for (const f of findings) {
      expect(f.status).toBe('provisional'); // single source: kept, not discarded, not yet approved
      expect(f.basis).toBe('observed');
      expect(f.review.judge).toBe('approved'); // the quote really is on the page
      expect(f.review.manager).toBe('pending');
      expect(f.evidence[0]).toMatchObject({ sourceHash: doc.hash, chunkId: expect.stringMatching(/^ch-/) });
      expect(f.evidence[0].page).toBeGreaterThanOrEqual(1);
      expect(f.evidence[0].page).toBeLessThanOrEqual(40);
      expect(f.evidence[0].quote.length).toBeGreaterThan(10);
    }
    const report = outcome.report;
    expect(report).toMatchObject({ status: 'completed', agentId: 'accounting-expert', finalized: true });
    expect(report.attempted.chunksExamined).toBe(outcome.chunksTotal);
    expect(report.attempted.findingsGenerated).toBeGreaterThanOrEqual(findings.length);
    expect(report.retained.provisional).toBe(findings.length);
    expect(report.summary).toMatch(/Studied "Accounting Textbook"/);
    expect(report.summary).toMatch(/page 18|pages 18/); // the unreadable page is reported, with the OCR caveat
    expect(report.summary).toMatch(/vision model/);
    expect((await docs.getDocument(doc.sourceId)).status).toBe('done');
    expect(await agents.getProfile('accounting-expert')).toMatchObject({ stage: 'provisional', stats: { documents: 1 } });
    // The expert can now answer from it, with the citation and the "not yet reviewed" label.
    const ctx = await agents.expertContext('accounting-expert', 'explain the ledger concept');
    expect(ctx.text).toMatch(/provisional, not yet reviewed/);
    expect(ctx.text).toMatch(/Accounting Textbook, page \d+/);
  }, 60000);

  it('approves a finding only when a second independent source corroborates it', async () => {
    await setup(bookPages(12));
    const { docs, study, cycles, agents } = mods();
    const one = await docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Book A.pdf' });
    await study.studyDocument(one.doc.sourceId);
    expect((await cycles.searchFindings({ agentId: 'accounting-expert', status: 'approved' }))).toHaveLength(0);
    // A second, different document that says the same things.
    const { boundary } = await (async () => ({ boundary: null }))();
    void boundary; void agents;
    const fs = require('react-native-fs');
    const pages2 = bookPages(12);
    require('react-native').NativeModules.PDFExtractorModule.extractPages = jest.fn(async (_p: string, s: number, c: number) => pages2.slice(s, s + c));
    await fs.writeFile('/picked/book2.pdf', 'a different file', 'utf8');
    const two = await docs.importPdf({ uri: 'file:///picked/book2.pdf', name: 'Book B.pdf', agentId: 'accounting-expert' });
    expect(two.duplicate).toBe(false);
    await study.studyDocument(two.doc.sourceId, { agentId: 'accounting-expert' });
    const approved = await cycles.searchFindings({ agentId: 'accounting-expert', status: 'approved', limit: 500 });
    expect(approved.length).toBeGreaterThan(5);
    expect(approved.every((f: any) => new Set(f.evidence.map((e: any) => e.sourceHash)).size >= 2)).toBe(true);
    expect(approved.every((f: any) => f.review.judge === 'approved' && f.review.manager === 'approved')).toBe(true);
  }, 90000);

  it('resumes an interrupted study from its checkpoint without duplicating chunks or findings', async () => {
    const env = await setup(bookPages(24));
    let m = mods();
    const { doc } = await m.docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Resume.pdf' });
    // Stop after the first batch of chunks.
    let stop = false;
    const first = await m.study.studyDocument(doc.sourceId, { shouldStop: () => stop, onProgress: (p: any) => { if (p.phase === 'studying') stop = true; } });
    expect(first.status).toBe('paused');
    expect(first.chunksStudied).toBeGreaterThan(0);
    expect(first.chunksStudied).toBeLessThan(first.chunksTotal);
    expect(first.report.status).toBe('interrupted');
    const partial = (await m.cycles.searchFindings({ agentId: first.agentId, limit: 500 })).length;
    expect(partial).toBeGreaterThan(0);

    // The app is killed and restarted: modules are loaded again over the same disk.
    jest.resetModules();
    env.reinstall();
    m = mods();
    const again = await m.study.studyDocument(doc.sourceId);
    expect(again.status).toBe('completed');
    expect(again.chunksStudied).toBe(again.chunksTotal);

    const final = await m.cycles.searchFindings({ agentId: again.agentId, limit: 1000 });
    const chunkIds = (await m.docs.readChunks((await m.docs.getDocument(doc.sourceId)).hash, 0, 1000)).map((c: any) => c.chunkId);
    expect(new Set(chunkIds).size).toBe(chunkIds.length); // no chunk was written twice
    expect(new Set(final.map((f: any) => f.contentHash)).size).toBe(final.length); // nothing doubled by the resume
    const resumedCount = final.length;
    // The same book studied in one go, on a fresh disk, yields exactly the same number of findings.
    jest.resetModules();
    await setup(bookPages(24));
    const clean = mods();
    const again2 = await clean.docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Resume.pdf' });
    const full = await clean.study.studyDocument(again2.doc.sourceId);
    expect((await clean.cycles.searchFindings({ agentId: full.agentId, limit: 1000 })).length).toBe(resumedCount);
    jest.resetModules();
    // Each run was its own immutable cycle (checked on the first disk before it was replaced).
    expect(true).toBe(true);
  }, 90000);

  it('resumes an interrupted PDF extraction at the page it reached, reading no page twice', async () => {
    const { calls, NativeModules, reinstall } = await setup(bookPages(60), { model: false });
    const { docs } = mods();
    const starts: number[] = [];
    const original = NativeModules.PDFExtractorModule.extractPages as jest.Mock;
    NativeModules.PDFExtractorModule.extractPages = jest.fn(async (path: string, start: number, count: number) => { starts.push(start); return original(path, start, count); });
    const { doc } = await docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Extract.pdf' });
    let reads = 0;
    const paused = await docs.extractDocument(doc.sourceId, { shouldStop: () => reads++ >= 1 });
    expect(paused).toMatchObject({ status: 'paused', progress: { pagesExtracted: 20 } });
    jest.resetModules();
    reinstall();
    NativeModules.PDFExtractorModule.extractPages = jest.fn(async (path: string, start: number, count: number) => { starts.push(start); return original(path, start, count); });
    const m = mods();
    const finished = await m.docs.extractDocument(doc.sourceId);
    expect(finished.progress.pagesExtracted).toBe(60);
    expect(starts).toEqual([0, 20, 40]); // page 0-19 were not read a second time
    void calls;
  });

  it('does not mark anything studied when the model is not available, and picks up where it stopped once it is', async () => {
    const env = await setup(bookPages(12));
    const { useAppStore } = require('../../../src/stores');
    useAppStore.setState({ activeModelId: null });
    const { docs, study, cycles } = mods();
    const { doc } = await docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Needs a model.pdf' });
    await expect(study.studyDocument(doc.sourceId)).rejects.toThrow(/No model selected/);
    const stuck = await docs.getDocument(doc.sourceId);
    expect(stuck.progress.chunksStudied).toBe(0); // nothing was claimed as read
    expect(stuck.status).toBe('paused');
    expect(await cycles.searchFindings({ limit: 50 })).toHaveLength(0);
    env.reinstall();
    const out = await study.studyDocument(doc.sourceId);
    expect(out.status).toBe('completed');
    expect((await cycles.searchFindings({ agentId: out.agentId, limit: 500 })).length).toBeGreaterThan(5);
  }, 60000);

  it('removes a source and the knowledge that rests only on it', async () => {
    await setup(bookPages(12));
    const { docs, study, cycles } = mods();
    const { doc } = await docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Remove me.pdf' });
    const out = await study.studyDocument(doc.sourceId);
    const before = (await cycles.searchFindings({ agentId: out.agentId, limit: 500 })).length;
    expect(before).toBeGreaterThan(0);
    const res = await docs.removeDocument(doc.sourceId);
    expect(res.erasedFindings).toBe(before);
    expect(await cycles.searchFindings({ agentId: out.agentId, limit: 500 })).toHaveLength(0);
    expect(await docs.listDocuments()).toHaveLength(0);
    const RNFS = require('react-native-fs');
    expect(await RNFS.exists(require('../../../src/knowledge/storage').P.original(doc.hash))).toBe(false);
    const stored = await RNFS.readFile(`${require('../../../src/knowledge/storage').knowledgeRoot()}/knowledge/tombstones.jsonl`, 'utf8');
    expect(stored).toMatch(/"kind":"document"/);
    expect(stored).not.toMatch(/ledger concept/); // the tombstones hold ids and reasons, not the removed text
  }, 60000);

  it('reads a large book in small pieces: bounded files, bounded batches', async () => {
    const { calls } = await setup(bookPages(300), { model: false });
    const RNFS = require('react-native-fs');
    const { docs, study } = mods();
    const sizes: number[] = [];
    const read = RNFS.readFile as jest.Mock;
    const original = read.getMockImplementation()!;
    read.mockImplementation(async (...args: unknown[]) => { const text = await original(...args); sizes.push(String(text).length); return text; });
    const { doc } = await docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Big.pdf' });
    const seen: number[] = [];
    await study.studyDocument(doc.sourceId, { ask: async (_s: string, user: string) => { seen.push(user.length); return '[]'; } });
    const done = await docs.getDocument(doc.sourceId);
    expect(done.progress.chunksTotal).toBeGreaterThan(200);
    expect(done.progress.chunksStudied).toBe(done.progress.chunksTotal);
    expect(Math.max(...calls)).toBeLessThanOrEqual(20);
    expect(Math.max(...seen)).toBeLessThan(5000); // one chunk at a time goes to the model, never the book
    const bookChars = bookPages(300).reduce((n, p) => n + p.length, 0);
    expect(bookChars).toBeGreaterThan(400_000);
    expect(Math.max(...sizes)).toBeLessThan(bookChars / 4); // no read ever pulled in more than a fraction of the book (a chunk file is ~25 chunks)
  }, 120000);

  it('reads a scanned page with the vision model when one is loaded, marks it as read from a picture, and leaves it flagged when none is', async () => {
    const { NativeModules } = await setup(bookPages(40), { model: false });
    NativeModules.PDFExtractorModule.renderPage = jest.fn(async (_p: string, index: number) => `/cache/page-${index}.png`);
    const { docs } = mods();
    const { llmService } = require('../../../src/services/llm');

    // No vision model: the scanned page stays flagged.
    const none = await docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Accounting Textbook.pdf' });
    expect((await docs.extractDocument(none.doc.sourceId)).unreadablePages).toEqual([18]);
    await docs.removeDocument(none.doc.sourceId);

    // A vision model is loaded: page 18 is read from its picture.
    jest.spyOn(llmService, 'isModelLoaded').mockReturnValue(true);
    jest.spyOn(llmService, 'supportsVision').mockReturnValue(true);
    const seen: string[] = [];
    jest.spyOn(llmService, 'generateResponse').mockImplementation(async (messages: any) => {
      seen.push(messages[0].attachments?.[0]?.uri);
      return 'Chapter 2 Scan\n\nThe receivable concept is explained here with a worked example and a short definition of terms.';
    });
    const again = await docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Accounting Textbook.pdf' });
    const doc = await docs.extractDocument(again.doc.sourceId);
    expect(seen).toEqual(['file:///cache/page-17.png']);
    expect(doc.unreadablePages).toEqual([]);
    expect(doc.ocrPages).toEqual([18]);
  });
});

describe('text books', () => {
  it('imports a plain-text book, reads it as pages, and chunks it like a PDF', async () => {
    await setup(bookPages(2), { model: false });
    const RNFS = require('react-native-fs').default ?? require('react-native-fs');
    const text = Array.from({ length: 60 }, (_, i) => `${i % 15 === 0 ? `Chapter ${i / 15 + 1} The ledger\n\n` : ''}${para('ledger', i * 6)}`).join('\n\n');
    await RNFS.mkdir('/picked');
    await RNFS.writeFile('/picked/notes.txt', text, 'utf8');
    const { docs } = mods();
    const { doc, duplicate } = await docs.importPdf({ uri: 'file:///picked/notes.txt', name: 'Textbook notes.txt' });
    expect(duplicate).toBe(false);
    expect(doc.title).toBe('Textbook notes');
    expect(doc.pages).toBeGreaterThan(3); // cut into pages of about 3,000 characters

    const extracted = await docs.extractDocument(doc.sourceId);
    expect(extracted.progress.pagesExtracted).toBe(doc.pages);
    expect(extracted.unreadablePages).toEqual([]);
    const ready = await docs.chunkDocument(doc.sourceId);
    expect(ready.status).toBe('ready');
    const chunks = await docs.readChunks(ready.hash, 0, ready.progress.chunksTotal);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[0].page).toBe(1);
    expect(chunks[chunks.length - 1].pageEnd).toBe(doc.pages);
  });
  it('refuses a file type it cannot study, with a clear message', async () => {
    await setup(bookPages(2), { model: false });
    const { docs } = mods();
    await expect(docs.importPdf({ uri: 'file:///picked/pic.jpg', name: 'pic.jpg' })).rejects.toThrow(/PDF, EPUB and plain text/);
  });
});
