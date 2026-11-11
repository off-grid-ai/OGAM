/**
 * Export / import between two devices: each "device" is its own disk. Only the device boundary is faked
 * (file system, zip, the native PDF reader).
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

const HASH_A = '1'.repeat(64);
const HASH_B = '2'.repeat(64);
const ev = (hash: string, chunk: string, page: number) => ({ sourceId: `src-${hash.slice(0, 4)}`, sourceHash: hash, chunkId: chunk, page, quote: 'a verbatim quote from the page' });

beforeEach(() => jest.resetModules());

function device(pdf?: { pages: number }) {
  const boundary = installNativeBoundary({ fs: true });
  if (pdf) require('react-native').NativeModules.PDFExtractorModule = { pageCount: async () => pdf.pages, extractPages: async () => [] };
  return {
    boundary, RNFS: require('react-native-fs'),
    cycles: require('../../../src/knowledge/cycles'), agents: require('../../../src/knowledge/agents'),
    ex: require('../../../src/knowledge/exchange'), docs: require('../../../src/knowledge/documents'),
    schema: require('../../../src/knowledge/schema'), storage: require('../../../src/knowledge/storage'),
  };
}
type Dev = ReturnType<typeof device>;

/** Two experts with a few findings each, one of them reviewed twice (so it is approved). */
async function teach(d: Dev) {
  const law = await d.agents.routeSubject('law firm pricing and billable hours');
  const acct = await d.agents.routeSubject('accounting: balance sheet and depreciation');
  const h1 = await d.cycles.startCycle({ agentId: law.agentId, topicId: law.topicId, topic: 'Law firm pricing', model: 'm' });
  const a = await d.cycles.addFinding(h1, { question: 'What is realization?', finding: 'Realization is the share of billed time actually collected.', confidence: 0.8, evidence: [ev(HASH_A, 'ch-a1', 3)] });
  await d.cycles.addFinding(h1, { question: 'What is utilization?', finding: 'Utilization is billable hours over available hours.', confidence: 0.7, evidence: [ev(HASH_A, 'ch-a2', 4)] });
  await d.cycles.addReview({ recordId: a.recordId, role: 'judge', decision: 'approved', reason: 'ok', by: 'test' });
  await d.cycles.addReview({ recordId: a.recordId, role: 'manager', decision: 'approved', reason: 'ok', by: 'test' });
  await d.cycles.finalizeCycle(h1, { status: 'completed', summary: 'law' });
  const h2 = await d.cycles.startCycle({ agentId: acct.agentId, topicId: acct.topicId, topic: 'Accounting', model: 'm' });
  await d.cycles.addFinding(h2, { question: 'What is depreciation?', finding: 'Depreciation spreads an asset cost over its useful life.', confidence: 0.8, evidence: [ev(HASH_B, 'ch-b1', 9)] });
  await d.cycles.finalizeCycle(h2, { status: 'completed', summary: 'acct' });
  return { law, acct, approvedId: a.recordId };
}

type Files = Record<string, string>;
/** The zip as a person would carry it: base64 bytes of the file. */
const snapshot = (d: Dev, path: string): Promise<string> => d.RNFS.readFile(path, 'base64');

/** A new device (empty disk) that has been handed the package. */
async function receive(b64: string): Promise<{ to: Dev; zipPath: string }> {
  jest.resetModules();
  const to = device();
  await to.RNFS.writeFile('/received/package.zip', b64, 'base64');
  return { to, zipPath: '/received/package.zip' };
}

/** Rewrites a package: decode, let the test change files, optionally keep the manifest/checksums honest, encode again. */
function rebuild(b64: string, mutate: (files: Files) => void, opts: { fixManifest?: boolean } = { fixManifest: true }): string {
  const archive = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { zip: true; files: Record<string, string> };
  const files: Files = Object.fromEntries(Object.entries(archive.files).map(([k, v]) => [k, Buffer.from(v, 'base64').toString('utf8')]));
  mutate(files);
  if (opts.fixManifest !== false) {
    const manifest = JSON.parse(files['manifest.json']);
    const { sha256 } = require('js-sha256');
    const listed = new Map<string, { path: string; bytes: number; sha256: string }>(manifest.files.map((f: any) => [f.path, f]));
    for (const [path, text] of Object.entries(files)) {
      if (path === 'manifest.json' || path === 'checksums.json') continue;
      listed.set(path, { path, bytes: Buffer.byteLength(text), sha256: sha256(text) });
    }
    files['checksums.json'] = JSON.stringify({ algorithm: 'sha256', files: Object.fromEntries([...listed.entries()].map(([k, v]) => [k, v.sha256])) });
    listed.set('checksums.json', { path: 'checksums.json', bytes: Buffer.byteLength(files['checksums.json']), sha256: sha256(files['checksums.json']) });
    manifest.files = [...listed.values()];
    files['manifest.json'] = JSON.stringify(manifest);
  }
  return Buffer.from(JSON.stringify({ zip: true, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v, 'utf8').toString('base64')])) })).toString('base64');
}

const unpack = async (d: Dev, zipPath: string) => {
  const dest = '/inspect';
  await require('react-native-zip-archive').unzip(zipPath, dest);
  return { dest, read: (p: string) => d.RNFS.readFile(`${dest}/${p}`, 'utf8') as Promise<string>, exists: (p: string) => d.RNFS.exists(`${dest}/${p}`) as Promise<boolean> };
};
const lines = (t: string) => t.split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('export', () => {
  it('writes one zip with valid JSON/JSONL, the expected files, and checksums that are correct', async () => {
    const d = device(); await teach(d);
    const { path, manifest } = await d.ex.createExport({ scope: { kind: 'all' }, appVersion: '0.0.test' });
    expect(path).toMatch(/atlas-learning-export-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.zip$/);
    const u = await unpack(d, path);
    expect(d.schema.validateManifest(JSON.parse(await u.read('manifest.json')))).toEqual([]);
    for (const f of ['manifest.json', 'checksums.json', 'agents.jsonl', 'revisions.jsonl', 'tombstones.jsonl', 'documents/index.json', 'documents/chunks.jsonl']) expect(await u.exists(f)).toBe(true);
    expect(manifest.counts).toMatchObject({ agents: 2, cycles: 2, findings: 3, reviews: 2 });
    expect(manifest.compatibility).toMatchObject({ interchange: 'atlas-learning-interchange/1.0', streetAdvisory: 'adapter-required' });
    expect(manifest.includesOriginals).toBe(false);
    const sums = JSON.parse(await u.read('checksums.json')).files;
    for (const f of manifest.files) {
      const text = await u.read(f.path);
      expect(d.storage.sha256Text(text)).toBe(f.sha256);
      if (f.path !== 'checksums.json') expect(sums[f.path]).toBe(f.sha256);
      if (f.path.endsWith('.jsonl')) lines(text); // every line parses
    }
    const findingFiles = manifest.files.filter((f: any) => /^cycles\/[^/]+\/findings\.jsonl$/.test(f.path));
    expect(findingFiles).toHaveLength(2);
    for (const f of findingFiles) for (const rec of lines(await u.read(f.path))) expect(d.schema.validateFinding(rec)).toEqual([]);
    for (const rec of lines(await u.read('agents.jsonl'))) expect(d.schema.validateAgentProfile(rec)).toEqual([]);
    expect((await d.ex.transferHistory())[0]).toMatchObject({ kind: 'export', id: manifest.exportId });
  });

  it('exports only the selected expert, and only what changed since the last export', async () => {
    const d = device(); const { law } = await teach(d);
    const one = await d.ex.createExport({ scope: { kind: 'agents', agentIds: [law.agentId] } });
    expect(one.manifest.counts).toMatchObject({ agents: 1, findings: 2 });
    const subject = await d.ex.createExport({ scope: { kind: 'subjects', topicIds: ['accounting'] } });
    expect(subject.manifest.counts).toMatchObject({ agents: 1, findings: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const h = await d.cycles.startCycle({ agentId: law.agentId, topicId: law.topicId, topic: 'More', model: 'm' });
    await d.cycles.addFinding(h, { question: 'What drives profit?', finding: 'Rates and realization drive profit together.', confidence: 0.6, evidence: [ev(HASH_A, 'ch-a9', 12)] });
    await d.cycles.finalizeCycle(h, { status: 'completed', summary: 'more' });
    const delta = await d.ex.createExport({ scope: { kind: 'since' } });
    expect(delta.manifest.counts.findings).toBe(1);
    expect(delta.manifest.scope.since).toBeTruthy();
  });

  it('includes original PDFs only when asked, under their hashed file names', async () => {
    const d = device({ pages: 3 });
    d.boundary.fs!.seedFile('/picked/book.pdf', 4096);
    const { doc } = await d.docs.importPdf({ uri: 'file:///picked/book.pdf', name: 'Book.pdf' });
    const a = await d.agents.routeSubject('accounting basics');
    const h = await d.cycles.startCycle({ agentId: a.agentId, topicId: a.topicId, topic: 'Accounting', model: 'm' });
    await d.cycles.addFinding(h, { question: 'q?', finding: 'A ledger records every transaction in order.', confidence: 0.7, evidence: [{ sourceId: doc.sourceId, sourceHash: doc.hash, chunkId: 'ch-x1', page: 2, quote: 'a ledger records' }] });
    await d.cycles.finalizeCycle(h, { status: 'completed', summary: 's' });
    const without = await d.ex.createExport({ scope: { kind: 'all' } });
    expect(without.manifest.files.some((f: any) => f.path.startsWith('documents/originals/'))).toBe(false);
    const withPdf = await d.ex.createExport({ scope: { kind: 'all' }, includeOriginals: true });
    expect(withPdf.manifest.includesOriginals).toBe(true);
    expect(withPdf.manifest.files.map((f: any) => f.path)).toContain(`documents/originals/${doc.hash}.pdf`);
  });
});

describe('import', () => {
  it('brings an export to another device, and importing it again adds nothing', async () => {
    const a = device(); const { law } = await teach(a);
    const { path } = await a.ex.createExport({ scope: { kind: 'all' } });
    const { to: b, zipPath } = await receive(await snapshot(a, path));

    const preview = await b.ex.previewImport(zipPath);
    expect(preview).toMatchObject({ valid: true, preview: true, imported: { findings: 3, cycles: 2, agents: 2 } });
    expect(await b.cycles.searchFindings({ limit: 50 })).toHaveLength(0); // a preview writes nothing

    const first = await b.ex.applyImport(zipPath);
    expect(first).toMatchObject({ valid: true, imported: { findings: 3, cycles: 2, agents: 2 }, duplicates: 0 });
    expect(await b.cycles.searchFindings({ limit: 50 })).toHaveLength(3);
    expect((await b.agents.listProfiles()).map((p: any) => p.agentId).sort()).toEqual([law.agentId, 'accounting-expert'].sort());

    const second = await b.ex.applyImport(zipPath);
    expect(second.imported).toMatchObject({ findings: 0, cycles: 0, agents: 0 });
    expect(second.duplicates).toBe(3);
    expect(await b.cycles.searchFindings({ limit: 50 })).toHaveLength(3);
    expect((await b.cycles.listCycles()).length).toBe(2);
    expect((await b.ex.transferHistory()).filter((t: any) => t.kind === 'import')).toHaveLength(2);
  });

  it('rebuilds each finding\'s status from its reviews: an approved one stays approved, a bare claim of approval is not believed', async () => {
    const a = device(); const { approvedId } = await teach(a);
    const { path } = await a.ex.createExport({ scope: { kind: 'all' } });
    const b64 = await snapshot(a, path);
    const { to: b, zipPath } = await receive(b64);
    expect(await b.ex.applyImport(zipPath)).toMatchObject({ approved: 1, provisional: 2 });
    expect((await b.cycles.getFinding(approvedId)).status).toBe('approved');

    // The same package with the reviews stripped and every finding edited to claim "approved".
    const forged = rebuild(b64, (files) => {
      for (const path of Object.keys(files)) {
        if (/^cycles\/[^/]+\/findings\.jsonl$/.test(path)) files[path] = files[path].split('\n').filter(Boolean).map((l) => JSON.stringify({ ...JSON.parse(l), status: 'approved', review: { judge: 'approved', manager: 'approved' } })).join('\n') + '\n';
        if (/^cycles\/[^/]+\/reviews\.jsonl$/.test(path)) files[path] = '';
      }
    });
    const { to: c, zipPath: forgedPath } = await receive(forged);
    expect(await c.ex.applyImport(forgedPath)).toMatchObject({ approved: 0, provisional: 3 });
    expect(await c.cycles.searchFindings({ status: 'approved' })).toHaveLength(0);
  });

  it('keeps contradictory findings as a conflict for review instead of merging them', async () => {
    const a = device();
    const ra = await a.agents.routeSubject('law firm pricing');
    const ha = await a.cycles.startCycle({ agentId: ra.agentId, topicId: ra.topicId, topic: 'Law', model: 'm' });
    await a.cycles.addFinding(ha, { question: 'What is the standard realization rate?', finding: 'The standard realization rate for law firms is 75 percent.', confidence: 0.7, evidence: [ev(HASH_A, 'ch-1', 5)] });
    await a.cycles.finalizeCycle(ha, { status: 'completed', summary: 's' });
    const b64 = await snapshot(a, (await a.ex.createExport({ scope: { kind: 'all' } })).path);

    jest.resetModules();
    const b = device();
    const rb = await b.agents.routeSubject('law firm pricing');
    const hb = await b.cycles.startCycle({ agentId: rb.agentId, topicId: rb.topicId, topic: 'Law', model: 'm' });
    await b.cycles.addFinding(hb, { question: 'What is the standard realization rate?', finding: 'The standard realization rate for law firms is 90 percent.', confidence: 0.7, evidence: [ev(HASH_B, 'ch-2', 8)] });
    await b.cycles.finalizeCycle(hb, { status: 'completed', summary: 's' });
    await b.RNFS.writeFile('/received/package.zip', b64, 'base64');
    const report = await b.ex.applyImport('/received/package.zip');
    expect(report.conflicts).toHaveLength(1);
    const conflicted = await b.cycles.searchFindings({ status: 'conflicted' });
    expect(conflicted.map((f: any) => f.finding).sort()).toEqual([
      'The standard realization rate for law firms is 75 percent.', 'The standard realization rate for law firms is 90 percent.',
    ]); // neither overwrote the other
  });

  it('refuses a package whose files were changed, whose paths escape, or whose version it does not read, and touches nothing', async () => {
    const a = device(); await teach(a);
    const b64 = await snapshot(a, (await a.ex.createExport({ scope: { kind: 'all' } })).path);
    const tamper = rebuild(b64, (files) => { const k = Object.keys(files).find((p) => p.endsWith('findings.jsonl') && files[p].includes('Realization'))!; files[k] = files[k].replace('Realization', 'Realizatiox'); }, { fixManifest: false }); // same length, different bytes
    const resized = rebuild(b64, (files) => { const k = Object.keys(files).find((p) => p.endsWith('findings.jsonl') && files[p].includes('Realization'))!; files[k] = files[k].replace('Realization', 'Fabricated'); }, { fixManifest: false });
    const escape = rebuild(b64, (files) => { files['../evil.txt'] = 'x'; const m = JSON.parse(files['manifest.json']); const { sha256 } = require('js-sha256'); m.files.push({ path: '../evil.txt', bytes: 1, sha256: sha256('x') }); files['manifest.json'] = JSON.stringify(m); }, { fixManifest: false });
    const future = rebuild(b64, (files) => { const m = JSON.parse(files['manifest.json']); m.schemaVersion = '2.0'; files['manifest.json'] = JSON.stringify(m); }, { fixManifest: false });
    const notAnExport = rebuild(b64, (files) => { delete files['manifest.json']; }, { fixManifest: false });
    for (const [bad, why] of [[tamper, /Checksum does not match/], [resized, /Wrong size/], [escape, /Unsafe path/], [future, /schema 2\.0/], [notAnExport, /manifest\.json is missing/]] as const) {
      const { to, zipPath } = await receive(bad);
      const report = await to.ex.applyImport(zipPath);
      expect(report.valid).toBe(false);
      expect(report.refused.join(' ')).toMatch(why);
      expect(await to.cycles.searchFindings({ limit: 10 })).toHaveLength(0);
      expect(await to.cycles.listCycles()).toHaveLength(0);
    }
  });

  it('carries deletions in tombstones: removed knowledge stays removed, here and when an older export is imported later', async () => {
    const a = device(); await teach(a);
    const before = await snapshot(a, (await a.ex.createExport({ scope: { kind: 'all' } })).path);
    const doomed = (await a.cycles.searchFindings({ text: 'depreciation asset', limit: 1 }))[0];
    await a.cycles.eraseFindings([doomed.recordId], 'the person deleted it');
    const after = await snapshot(a, (await a.ex.createExport({ scope: { kind: 'all' } })).path);
    expect(JSON.stringify(after)).not.toContain(Buffer.from('Depreciation spreads').toString('base64'));

    const { to: b, zipPath } = await receive(before);
    await b.ex.applyImport(zipPath);
    expect(await b.cycles.getFinding(doomed.recordId)).not.toBeNull();
    await b.RNFS.writeFile('/received/after.zip', after, 'base64');
    expect((await b.ex.applyImport('/received/after.zip')).imported.deletionsApplied).toBe(1);
    expect(await b.cycles.getFinding(doomed.recordId)).toBeNull();
    // The old export, imported again, does not bring it back.
    const again = await b.ex.applyImport(zipPath);
    expect(again.tombstoned).toBeGreaterThanOrEqual(1);
    expect(await b.cycles.getFinding(doomed.recordId)).toBeNull();
    expect(await b.cycles.searchFindings({ limit: 50 })).toHaveLength(2);
  });
});
