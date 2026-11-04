/**
 * Moving knowledge between devices and into other tools: ONE zip per export, and an import that is safe to run twice.
 *
 * The package is the Atlas learning interchange format (docs/ATLAS_LEARNING_INTERCHANGE.md):
 *
 *   manifest.json   what is in it, counts, per-file size and SHA-256, compatibility notes
 *   checksums.json  path -> SHA-256 of every data file
 *   agents.jsonl    one expert-agent profile per line
 *   cycles/<cycleId>/report.json, findings.jsonl, reviews.jsonl
 *   documents/index.json, documents/chunks.jsonl (only the chunks the findings cite), documents/originals/<sha256>.pdf (optional)
 *   revisions.jsonl, tombstones.jsonl
 *
 * It is NOT a Street Advisory knowledge bundle (that format is schemaVersion 2 / "street-advisory-knowledge-bundle", with capsule
 * hashes and judge/manager approvals only Street can produce). The manifest says so ("adapter-required"); nothing here invents
 * Street's hashes or approvals.
 *
 * Import validates everything before it touches the store (safe paths, sizes, SHA-256 of every file, schema of every record),
 * stages the package, and merges: records are matched by stable ids and content hashes so importing the same package again adds
 * nothing; contradicting findings are kept as conflicts; deletions are carried by tombstones so removed material stays removed.
 * A finding's status is never taken on trust from the package: it is recomputed from the reviews, whose evidence hashes must match
 * the evidence as it arrives.
 */
import RNFS from 'react-native-fs';
import { unzip, zip } from 'react-native-zip-archive';
import {
  SCHEMA_VERSION, SOURCE_APP, isSafeArchivePath, validateAgentProfile, validateChunk, validateCycleReport, validateFinding,
  validateManifest, validateReview, validateRevision, validateSourceDocument, validateTombstone,
  type AgentProfile, type ChunkRecord, type CycleReport, type ExportManifest, type Finding, type ReviewRecord, type RevisionRecord,
  type SourceDocument, type Tombstone,
} from './schema';
import {
  P, appendJsonl, atomicWriteText, deviceId, ensureDir, hashIndex, knowledgeRoot, listDir, nowIso, readJson, readJsonl, removeTree,
  sha256Text, stateIndex, terms, uuid, withLock, writeJson, type RecordState,
} from './storage';
import { evidenceHash, effectiveReview, eraseFindings, getFinding, listCycles, markConflict, statusFromReviews } from './cycles';
import { listProfiles, refreshStats, saveProfile } from './agents';
import { listDocuments, saveDocument } from './documents';

export const INTERCHANGE = 'atlas-learning-interchange/1.0';
const MAX_TEXT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PACKAGE_FILES = 20_000;
const MAX_ORIGINAL_BYTES = 512 * 1024 * 1024;

const utf8Bytes = (text: string): number => unescape(encodeURIComponent(text)).length;
const jsonl = (rows: unknown[]) => (rows.length ? `${rows.map((r) => JSON.stringify(r)).join('\n')}\n` : '');

// ================================================================== export
export interface ExportScope { kind: 'all' | 'agents' | 'subjects' | 'since'; agentIds?: string[]; topicIds?: string[]; since?: string }
export interface ExportOptions { scope: ExportScope; includeOriginals?: boolean; appVersion?: string }
export interface ExportResult { path: string; manifest: ExportManifest }
export interface TransferEntry { kind: 'export' | 'import'; id: string; at: string; path?: string; counts: Record<string, number>; note?: string }

export const lastSuccessfulExport = async (): Promise<string | null> =>
  (await readJsonl<TransferEntry>(P.transfers())).filter((t) => t.kind === 'export').map((t) => t.at).sort().pop() ?? null;

export async function transferHistory(): Promise<TransferEntry[]> {
  return (await readJsonl<TransferEntry>(P.transfers())).sort((a, b) => (a.at < b.at ? 1 : -1));
}

async function readRevisions(): Promise<RevisionRecord[]> {
  const out: RevisionRecord[] = [];
  for (const f of await listDir(P.revisionsDir())) if (f.endsWith('.jsonl')) out.push(...await readJsonl<RevisionRecord>(`${P.revisionsDir()}/${f}`));
  return out;
}

export async function createExport(opts: ExportOptions): Promise<ExportResult> {
  const exportId = uuid();
  const staging = `${P.exportsDir()}/staging-${exportId}`;
  await removeTree(staging);
  await ensureDir(staging);
  const files: ExportManifest['files'] = [];
  const write = async (path: string, text: string) => {
    await ensureDir(`${staging}/${path.slice(0, path.lastIndexOf('/'))}`.replace(/\/$/, ''));
    await RNFS.writeFile(`${staging}/${path}`, text, 'utf8');
    files.push({ path, bytes: utf8Bytes(text), sha256: sha256Text(text) });
  };

  const scope = opts.scope;
  const since = scope.kind === 'since' ? (scope.since ?? (await lastSuccessfulExport()) ?? '') : '';
  const allProfiles = await listProfiles({ includeMerged: true });
  const wantAgent = (p: AgentProfile) => scope.kind === 'all' || scope.kind === 'since'
    || (scope.kind === 'agents' && !!scope.agentIds?.includes(p.agentId)) || (scope.kind === 'subjects' && !!scope.topicIds?.includes(p.topicId));
  const agents = allProfiles.filter(wantAgent);
  const agentIds = new Set(agents.map((a) => a.agentId));

  // Findings, cycle by cycle (a cycle's files are copied as they are; only the records in scope are kept).
  const includedIds = new Set<string>();
  const citedChunks = new Map<string, Set<string>>();
  const citedDocs = new Set<string>();
  let cycleCount = 0; let findingCount = 0; let reviewCount = 0;
  for (const c of await listCycles()) {
    const dir = `${P.cyclesDir()}/${c.dir}`;
    const findings = await readJsonl<Finding>(`${dir}/findings.jsonl`);
    const keep: Finding[] = [];
    for (const f of findings) {
      const state = await stateIndex.get(f.recordId);
      if (!state || !agentIds.has(state.agentId)) continue;
      if (since && state.updatedAt < since) continue;
      keep.push(f);
    }
    if (!keep.length) continue;
    const report = await readJson<CycleReport | null>(`${dir}/report.json`, null);
    if (!report) continue;
    const reviews = (await readJsonl<ReviewRecord>(`${dir}/reviews.jsonl`)).filter((r) => keep.some((f) => f.recordId === r.recordId));
    await write(`cycles/${c.cycleId}/report.json`, JSON.stringify(report));
    await write(`cycles/${c.cycleId}/findings.jsonl`, jsonl(keep));
    await write(`cycles/${c.cycleId}/reviews.jsonl`, jsonl(reviews));
    cycleCount++; findingCount += keep.length; reviewCount += reviews.length;
    for (const f of keep) {
      includedIds.add(f.recordId);
      const current = (await getFinding(f.recordId)) ?? f;
      for (const e of current.evidence) {
        citedDocs.add(e.sourceHash);
        (citedChunks.get(e.sourceHash) ?? citedChunks.set(e.sourceHash, new Set()).get(e.sourceHash)!).add(e.chunkId);
      }
    }
  }

  await write('agents.jsonl', jsonl(agents.map((a) => ({ ...a, atlasAgentId: undefined }))));
  const revisions = (await readRevisions()).filter((r) => includedIds.has(r.recordId) && (!since || r.createdAt >= since));
  await write('revisions.jsonl', jsonl(revisions));
  const tombstones = await readJsonl<Tombstone>(P.tombstones());
  await write('tombstones.jsonl', jsonl(tombstones));

  // Documents: the index, and only the chunks the findings cite (provenance, not whole books); the PDFs only if asked.
  const docs = (await listDocuments({ includeRemoved: false })).filter((d) => citedDocs.has(d.hash));
  await write('documents/index.json', JSON.stringify({ docs }));
  const chunkRows: ChunkRecord[] = [];
  for (const d of docs) {
    const wanted = citedChunks.get(d.hash) ?? new Set<string>();
    for (const f of await listDir(P.chunksDir(d.hash))) {
      if (!f.endsWith('.jsonl')) continue;
      for (const c of await readJsonl<ChunkRecord>(`${P.chunksDir(d.hash)}/${f}`)) if (wanted.has(c.chunkId)) chunkRows.push(c);
    }
  }
  await write('documents/chunks.jsonl', jsonl(chunkRows));
  if (opts.includeOriginals) {
    for (const d of docs) {
      if (!(await RNFS.exists(P.original(d.hash))) || Number((await RNFS.stat(P.original(d.hash))).size) > MAX_ORIGINAL_BYTES) continue;
      const rel = `documents/originals/${d.hash}.pdf`;
      await ensureDir(`${staging}/documents/originals`);
      await RNFS.copyFile(P.original(d.hash), `${staging}/${rel}`);
      files.push({ path: rel, bytes: Number((await RNFS.stat(`${staging}/${rel}`)).size), sha256: await RNFS.hash(`${staging}/${rel}`, 'sha256') });
    }
  }

  await write('checksums.json', JSON.stringify({ algorithm: 'sha256', files: Object.fromEntries(files.map((f) => [f.path, f.sha256])) }));
  const manifest: ExportManifest = {
    schemaVersion: SCHEMA_VERSION, bundleType: 'atlas-learning-export', exportId, sourceApp: SOURCE_APP, deviceId: await deviceId(),
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}), createdAt: nowIso(), scope: { ...scope, ...(since ? { since } : {}) },
    includesOriginals: !!opts.includeOriginals,
    counts: { agents: agents.length, cycles: cycleCount, findings: findingCount, reviews: reviewCount, documents: docs.length, chunks: chunkRows.length, revisions: revisions.length, tombstones: tombstones.length },
    files: [...files],
    compatibility: {
      interchange: INTERCHANGE, streetAdvisory: 'adapter-required',
      note: 'This is the Atlas learning interchange format, not a Street Advisory knowledge bundle (schemaVersion 2). Street needs an adapter that maps these records into its own validated capsules and sends them through its own judge and manager.',
    },
  };
  const problems = validateManifest(manifest);
  if (problems.length) throw new Error(`Export manifest is invalid: ${problems.join('; ')}`);
  await RNFS.writeFile(`${staging}/manifest.json`, JSON.stringify(manifest), 'utf8');

  await ensureDir(P.exportsDir());
  const out = `${P.exportsDir()}/atlas-learning-export-${manifest.createdAt.slice(0, 10)}-${exportId.slice(0, 8)}.zip`;
  await zip(staging, out);
  await removeTree(staging);
  await appendJsonl(P.transfers(), [{ kind: 'export', id: exportId, at: manifest.createdAt, path: out, counts: manifest.counts, note: scope.kind } satisfies TransferEntry]);
  return { path: out, manifest };
}

// ================================================================== import
export interface ImportIssue { where: string; problem: string }
export interface ImportReport {
  importId: string;
  exportId: string;
  valid: boolean;
  /** Reasons the whole package was refused (nothing was imported). */
  refused: string[];
  imported: { findings: number; cycles: number; agents: number; documents: number; reviews: number; revisions: number; deletionsApplied: number };
  duplicates: number;
  conflicts: Array<{ a: string; b: string; note: string }>;
  deferred: ImportIssue[];
  rejected: ImportIssue[];
  tombstoned: number;
  approved: number;
  provisional: number;
  /** Set when previewing: nothing was written. */
  preview: boolean;
}

const blankReport = (exportId: string, preview: boolean): ImportReport => ({
  importId: uuid(), exportId, valid: true, refused: [],
  imported: { findings: 0, cycles: 0, agents: 0, documents: 0, reviews: 0, revisions: 0, deletionsApplied: 0 },
  duplicates: 0, conflicts: [], deferred: [], rejected: [], tombstoned: 0, approved: 0, provisional: 0, preview,
});

interface Package { dir: string; manifest: ExportManifest }

/** Unpacks into a staging folder and checks the package as a whole. Returns the reasons it is unusable, or null. */
async function openPackage(zipPath: string): Promise<{ pkg?: Package; refused: string[]; exportId: string }> {
  const dir = `${P.importsDir()}/staging-${uuid().slice(0, 8)}`;
  await removeTree(dir); await ensureDir(dir);
  await unzip(zipPath, dir);
  const refuse = async (why: string[], exportId = 'unknown') => { await removeTree(dir); return { refused: why, exportId }; };
  if (!(await RNFS.exists(`${dir}/manifest.json`))) return refuse(['manifest.json is missing: this is not an Atlas learning export.']);
  let manifest: ExportManifest;
  try { manifest = JSON.parse(await RNFS.readFile(`${dir}/manifest.json`, 'utf8')); } catch { return refuse(['manifest.json is not valid JSON.']); }
  if (typeof manifest?.schemaVersion === 'string' && manifest.schemaVersion.split('.')[0] !== SCHEMA_VERSION.split('.')[0]) {
    return refuse([`This export uses schema ${manifest.schemaVersion}; this version of Atlas reads ${SCHEMA_VERSION.split('.')[0]}.x.`], manifest.exportId);
  }
  const problems = validateManifest(manifest);
  if (problems.length) return refuse(problems, manifest?.exportId);
  if (manifest.files.length > MAX_PACKAGE_FILES) return refuse([`The package lists ${manifest.files.length} files, more than the ${MAX_PACKAGE_FILES} allowed.`], manifest.exportId);
  const bad: string[] = [];
  for (const f of manifest.files) {
    if (!isSafeArchivePath(f.path)) { bad.push(`Unsafe path in the package: ${f.path}`); continue; }
    const full = `${dir}/${f.path}`;
    if (!(await RNFS.exists(full))) { bad.push(`Listed but missing: ${f.path}`); continue; }
    const size = Number((await RNFS.stat(full)).size);
    const isOriginal = f.path.startsWith('documents/originals/');
    if (size !== f.bytes) bad.push(`Wrong size: ${f.path} is ${size} bytes, the manifest says ${f.bytes}`);
    else if ((!isOriginal && size > MAX_TEXT_FILE_BYTES) || size > MAX_ORIGINAL_BYTES) bad.push(`Too large: ${f.path}`);
    else if ((await RNFS.hash(full, 'sha256')) !== f.sha256) bad.push(`Checksum does not match: ${f.path}`);
  }
  if (bad.length) return refuse(bad, manifest.exportId);
  const checks = await readJson<{ files?: Record<string, string> }>(`${dir}/checksums.json`, {});
  for (const f of manifest.files) if (f.path !== 'checksums.json' && checks.files && checks.files[f.path] !== f.sha256) bad.push(`checksums.json disagrees with the manifest for ${f.path}`);
  if (bad.length) return refuse(bad, manifest.exportId);
  return { pkg: { dir, manifest }, refused: [], exportId: manifest.exportId };
}

const pushIssue = (list: ImportIssue[], where: string, problem: string) => { if (list.length < 200) list.push({ where, problem }); };

/** Does the new finding contradict the existing one? Same subject matter, but different numbers. */
export function looksContradictory(a: Pick<Finding, 'question' | 'finding' | 'contentHash'>, b: Pick<Finding, 'question' | 'finding' | 'contentHash'>): boolean {
  if (a.contentHash === b.contentHash) return false;
  const ta = terms(`${a.question} ${a.finding}`, 30); const tb = terms(`${b.question} ${b.finding}`, 30);
  const shared = ta.filter((w) => tb.includes(w)).length;
  if (shared / Math.max(1, Math.min(ta.length, tb.length)) < 0.6) return false;
  const nums = (t: string) => new Set(t.match(/\d+(?:\.\d+)?/g) ?? []);
  const na = nums(a.finding); const nb = nums(b.finding);
  if (!na.size || !nb.size) return false;
  return ![...na].some((n) => nb.has(n));
}

/** Validates a package and reports what importing it would do, writing nothing to the knowledge store. */
export async function previewImport(zipPath: string): Promise<ImportReport> {
  return runImport(zipPath, true);
}
export async function applyImport(zipPath: string): Promise<ImportReport> {
  return withLock('knowledge-import', () => runImport(zipPath, false));
}

async function runImport(zipPath: string, preview: boolean): Promise<ImportReport> {
  const opened = await openPackage(zipPath);
  const report = blankReport(opened.exportId, preview);
  if (!opened.pkg) { report.valid = false; report.refused = opened.refused; return report; }
  const { dir, manifest } = opened.pkg;
  try {

    // --- tombstones first: what was deleted anywhere stays deleted
    const incomingTombs = (await readJsonl<Tombstone>(`${dir}/tombstones.jsonl`)).filter((t) => !validateTombstone(t).length);
    const knownTombs = await readJsonl<Tombstone>(P.tombstones());
    const knownIds = new Set(knownTombs.map((t) => t.tombstoneId));
    const deletedFindings = new Set([...knownTombs, ...incomingTombs].filter((t) => t.kind === 'finding').map((t) => t.targetId));
    const deletedHashes = new Set([...knownTombs, ...incomingTombs].filter((t) => t.kind === 'finding' && t.targetHash).map((t) => t.targetHash!));
    const deletedDocs = new Set([...knownTombs, ...incomingTombs].filter((t) => t.kind === 'document').flatMap((t) => [t.targetId, t.targetHash ?? '']));

    // --- agents: match by id, then by subject, else create
    const agentMap = new Map<string, string>();
    const localProfiles = await listProfiles();
    for (const raw of await readJsonl<AgentProfile>(`${dir}/agents.jsonl`)) {
      const problems = validateAgentProfile(raw);
      if (problems.length) { pushIssue(report.rejected, `agent ${raw?.agentId}`, problems.join('; ')); continue; }
      const same = localProfiles.find((p) => p.agentId === raw.agentId) ?? localProfiles.find((p) => p.topicId === raw.topicId);
      if (same) { agentMap.set(raw.agentId, same.agentId); continue; }
      agentMap.set(raw.agentId, raw.agentId);
      report.imported.agents++;
      if (!preview) await saveProfile({ ...raw, atlasAgentId: undefined, stage: raw.stage, mergedInto: undefined });
    }

    // --- documents and the chunks the findings cite
    const incomingDocs = (await readJson<{ docs: SourceDocument[] }>(`${dir}/documents/index.json`, { docs: [] })).docs;
    const haveDocs = await listDocuments({ includeRemoved: true });
    for (const d of incomingDocs) {
      if (validateSourceDocument(d).length) { pushIssue(report.rejected, `document ${d?.sourceId}`, 'invalid record'); continue; }
      if (deletedDocs.has(d.sourceId) || deletedDocs.has(d.hash)) { report.tombstoned++; continue; }
      if (haveDocs.some((h) => h.hash === d.hash)) continue;
      report.imported.documents++;
      if (!preview) await saveDocument({ ...d, status: 'done', agentId: d.agentId ? agentMap.get(d.agentId) ?? d.agentId : undefined });
    }
    if (!preview) {
      const byHash = new Map<string, ChunkRecord[]>();
      for (const c of await readJsonl<ChunkRecord>(`${dir}/documents/chunks.jsonl`)) if (!validateChunk(c).length && !deletedDocs.has(c.sourceHash)) (byHash.get(c.sourceHash) ?? byHash.set(c.sourceHash, []).get(c.sourceHash)!).push(c);
      for (const [hash, rows] of byHash) await atomicWriteText(`${P.chunksDir(hash)}/imported-${manifest.exportId.slice(0, 8)}.jsonl`, jsonl(rows));
      if (manifest.includesOriginals) {
        for (const d of incomingDocs) {
          const src = `${dir}/documents/originals/${d.hash}.pdf`;
          if (!deletedDocs.has(d.hash) && (await RNFS.exists(src)) && !(await RNFS.exists(P.original(d.hash)))) { await ensureDir(P.original(d.hash).slice(0, P.original(d.hash).lastIndexOf('/'))); await RNFS.copyFile(src, P.original(d.hash)); }
        }
      }
    }

    // --- cycles and findings
    const haveCycles = new Map((await listCycles()).map((c) => [c.cycleId, c]));
    const incomingRevisions = (await readJsonl<RevisionRecord>(`${dir}/revisions.jsonl`)).filter((r) => !validateRevision(r).length);
    const haveRevisionIds = new Set<string>();
    for (const f of await listDir(P.revisionsDir())) for (const r of await readJsonl<RevisionRecord>(`${P.revisionsDir()}/${f}`)) haveRevisionIds.add(r.revisionId);
    const newlyStored: string[] = [];

    for (const cycleName of await listDir(`${dir}/cycles`)) {
      const base = `${dir}/cycles/${cycleName}`;
      const cycleReport = await readJson<CycleReport | null>(`${base}/report.json`, null);
      if (!cycleReport || validateCycleReport(cycleReport).length) { pushIssue(report.rejected, `cycle ${cycleName}`, 'report is missing or invalid'); continue; }
      const findings = await readJsonl<Finding>(`${base}/findings.jsonl`);
      const reviews = (await readJsonl<ReviewRecord>(`${base}/reviews.jsonl`)).filter((r) => !validateReview(r).length);
      const toStore: Finding[] = [];
      for (const raw of findings) {
        const problems = validateFinding({ ...raw, status: raw.status === 'approved' ? 'provisional' : raw.status, review: { judge: 'pending', manager: 'pending' } });
        if (problems.length) { pushIssue(report.rejected, `finding ${raw?.recordId}`, problems.join('; ')); continue; }
        if (deletedFindings.has(raw.recordId) || deletedHashes.has(raw.contentHash)) { report.tombstoned++; continue; }
        const agentId = agentMap.get(raw.agentId) ?? raw.agentId;
        if (await stateIndex.get(raw.recordId)) { report.duplicates++; continue; }
        const sameContent = await hashIndex.get(agentId, raw.contentHash);
        if (sameContent) { report.duplicates++; continue; } // same claim already known: not stored twice
        toStore.push({ ...raw, agentId });
      }
      if (!toStore.length) continue;
      if (haveCycles.has(cycleReport.cycleId)) {
        for (const f of toStore) pushIssue(report.deferred, `finding ${f.recordId}`, 'its cycle already exists here and cycles never change; send it again in a new export');
        continue;
      }
      if (preview) { report.imported.cycles++; report.imported.findings += toStore.length; continue; }

      const localDir = await (async () => {
        const day = (cycleReport.startedAt || nowIso()).slice(0, 10);
        const n = (await listDir(`${P.cyclesDir()}/${day}`)).filter((x) => /^cycle-\d+$/.test(x)).length + 1;
        return `${day}/cycle-${String(n).padStart(3, '0')}`;
      })();
      const target = `${P.cyclesDir()}/${localDir}`;
      await ensureDir(target);
      await appendJsonl(`${target}/findings.jsonl`, toStore);
      const ids = new Set(toStore.map((f) => f.recordId));
      await appendJsonl(`${target}/reviews.jsonl`, reviews.filter((r) => ids.has(r.recordId)));
      await writeJson(`${target}/report.json`, { ...cycleReport, finalized: true });
      await atomicWriteText(`${target}/final.json`, JSON.stringify({ finalizedAt: nowIso(), imported: manifest.exportId }));
      await appendJsonl(P.cyclesIndex(), [{ cycleId: cycleReport.cycleId, dir: localDir, agentId: toStore[0].agentId, topicId: toStore[0].topicId, startedAt: cycleReport.startedAt }]);
      report.imported.cycles++;
      for (const f of toStore) {
        const state: RecordState = {
          recordId: f.recordId, agentId: f.agentId, topicId: f.topicId, cycleId: f.cycleId, cycleDir: localDir, status: 'provisional',
          confidence: f.confidence, contentHash: f.contentHash, revision: 1, basis: f.basis, sources: new Set(f.evidence.map((e) => e.sourceHash)).size, updatedAt: nowIso(),
        };
        await stateIndex.put(state);
        await hashIndex.put(f.agentId, f.contentHash, f.recordId);
        await appendJsonl(P.agentKeywords(f.agentId), [{ recordId: f.recordId, cycleDir: localDir, terms: terms(`${f.question} ${f.finding}`) }]);
        newlyStored.push(f.recordId);
        report.imported.findings++;
      }
      report.imported.reviews += reviews.filter((r) => ids.has(r.recordId)).length;
    }

    if (!preview) {
      // Revisions that are new, for findings we now hold; then the status is rebuilt from the reviews and revisions, not copied.
      const mine = incomingRevisions.filter((r) => !haveRevisionIds.has(r.revisionId) && newlyStored.includes(r.recordId));
      if (mine.length) { await appendJsonl(P.revisions(nowIso().slice(0, 7)), mine); report.imported.revisions += mine.length; }
      for (const id of newlyStored) {
        const st = (await stateIndex.get(id))!;
        const f = (await getFinding(id))!;
        const reviewsHere = await readJsonl<ReviewRecord>(`${P.cyclesDir()}/${st.cycleDir}/reviews.jsonl`);
        const sticky = [...mine.filter((r) => r.recordId === id && r.kind !== 'evidence-added')].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).pop()?.status;
        const judge = effectiveReview(f, reviewsHere, 'judge'); const manager = effectiveReview(f, reviewsHere, 'manager');
        const status = sticky === 'conflicted' || sticky === 'superseded' ? sticky : statusFromReviews(judge, manager, 'provisional');
        await stateIndex.put({ ...st, status, sources: new Set(f.evidence.map((e) => e.sourceHash)).size, updatedAt: nowIso() });
        if (status === 'approved') report.approved++; else report.provisional++;
        // Contradictions with what this phone already knows are kept, as a conflict, not merged away.
        for (const other of await findContradiction(f)) { await markConflict(f.recordId, other.recordId, 'imported finding disagrees with an existing one', 'import'); report.conflicts.push({ a: f.recordId, b: other.recordId, note: 'different figures for the same question' }); }
      }
      // Deletions made elsewhere are applied here (and remembered), so removed knowledge does not reappear.
      const toErase: string[] = [];
      for (const t of incomingTombs) if (t.kind === 'finding' && (await stateIndex.get(t.targetId))) toErase.push(t.targetId);
      if (toErase.length) report.imported.deletionsApplied = await eraseFindings(toErase, 'deleted on the device that sent this export');
      const fresh = incomingTombs.filter((t) => !knownIds.has(t.tombstoneId));
      await appendJsonl(P.tombstones(), fresh);
      for (const agentId of new Set([...agentMap.values()])) await refreshStats(agentId);
      await appendJsonl(P.transfers(), [{ kind: 'import', id: report.importId, at: nowIso(), counts: { findings: report.imported.findings, duplicates: report.duplicates, conflicts: report.conflicts.length, rejected: report.rejected.length }, note: `from export ${manifest.exportId}` } satisfies TransferEntry]);
    } else {
      report.provisional = report.imported.findings;
    }
    return report;
  } finally {
    await removeTree(dir);
  }
}

async function findContradiction(f: Finding): Promise<Finding[]> {
  const out: Finding[] = [];
  const { searchFindings } = require('./cycles') as typeof import('./cycles');
  for (const candidate of await searchFindings({ agentId: f.agentId, text: f.question, limit: 8 })) {
    if (candidate.recordId !== f.recordId && looksContradictory(f, candidate)) out.push(candidate);
  }
  return out;
}

export { evidenceHash, knowledgeRoot };
