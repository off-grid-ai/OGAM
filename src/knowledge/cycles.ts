/**
 * Learning cycles: one independent, immutable-once-finished record of one stretch of learning, plus the findings, reviews and
 * revisions that belong to it.
 *
 * A cycle is a folder. While it runs, findings are appended to findings.jsonl; finalizing writes report.json / report.md and a
 * final.json marker, after which the cycle's report and findings never change. What can still happen afterwards are SEPARATE
 * records: reviews (reviews.jsonl in the same folder), and revisions (knowledge/revisions): added evidence, status changes,
 * conflicts, supersession. The current state of a finding is the immutable finding plus those records, kept up to date in the
 * sharded state index so listing and searching never read cycle files wholesale.
 */
import {
  SCHEMA_VERSION, SOURCE_APP, validateFinding, validateReview,
  type Basis, type CycleReport, type CycleStatus, type EvidenceRef, type Finding, type FindingStatus,
  type ReviewDecision, type ReviewRecord, type ReviewerRole, type RevisionRecord, type ReviewState,
} from './schema';
import {
  P, appendJsonl, atomicWriteText, deviceId, hashIndex, listDir, nowIso, readJsonl, readText, sha256Text,
  stateIndex, terms, uuid, withLock, writeJson, type RecordState,
} from './storage';
import RNFS from 'react-native-fs';
import { readJson } from './storage';

// ------------------------------------------------------------------ identity of a finding
const normalise = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9% .,'-]/g, '').trim();
/** The stable identity of a finding: the same claim about the same topic hashes the same wherever it was written. */
export const findingContentHash = (topicId: string, finding: string): string => sha256Text(`${topicId}|${normalise(finding)}`);
/** Identity of the evidence set, so an approval can be tied to exactly the evidence it saw. */
export const evidenceHash = (evidence: EvidenceRef[]): string =>
  sha256Text(evidence.map((e) => `${e.sourceHash}:${e.chunkId}:${e.page ?? ''}:${normalise(e.quote ?? '')}`).sort().join('\n'));
const distinctSources = (evidence: EvidenceRef[]) => new Set(evidence.map((e) => e.sourceHash)).size;

// ------------------------------------------------------------------ cycle lifecycle
export interface CycleHandle {
  cycleId: string;
  dir: string;
  agentId: string;
  topicId: string;
  startedAtMs: number;
  report: CycleReport;
}

async function nextCycleDir(): Promise<string> {
  const day = nowIso().slice(0, 10);
  const existing = (await listDir(`${P.cyclesDir()}/${day}`)).filter((n) => /^cycle-\d+$/.test(n));
  const n = existing.length ? Math.max(...existing.map((x) => Number(x.slice(6)))) + 1 : 1;
  return `${day}/cycle-${String(n).padStart(3, '0')}`;
}

const cycleFile = (dir: string, name: string) => `${P.cyclesDir()}/${dir}/${name}`;

export async function startCycle(input: { agentId: string; topicId: string; topic: string; model: string }): Promise<CycleHandle> {
  return withLock('cycle-create', async () => {
    const dir = await nextCycleDir();
    const cycleId = uuid();
    const dev = await deviceId();
    const report: CycleReport = {
      schemaVersion: SCHEMA_VERSION, cycleId, sourceApp: SOURCE_APP, deviceId: dev, agentId: input.agentId, topicId: input.topicId,
      topic: input.topic, model: input.model, status: 'running', startedAt: nowIso(),
      attempted: { sourcesSearched: 0, documentsProcessed: 0, chunksExamined: 0, findingsGenerated: 0 },
      retained: { accepted: 0, provisional: 0, needsReview: 0, rejected: 0, deferred: 0, duplicatesSkipped: 0 },
      findingsFile: 'findings.jsonl', reviewsFile: 'reviews.jsonl', summary: '', followUps: [], knowledgeGaps: [], errors: [],
      stats: { retries: 0, checkpoints: 0 }, finalized: false,
    };
    await writeJson(cycleFile(dir, 'report.json'), report);
    await appendJsonl(P.cyclesIndex(), [{ cycleId, dir, agentId: input.agentId, topicId: input.topicId, startedAt: report.startedAt }]);
    await setOpen(dir, true);
    return { cycleId, dir, agentId: input.agentId, topicId: input.topicId, startedAtMs: Date.now(), report };
  });
}

/** Cycles that have started and not finished: all that startup has to look at, however long the history is. */
async function setOpen(dir: string, open: boolean): Promise<void> {
  await withLock('open-cycles', async () => {
    const list = await readJson<{ dirs: string[] }>(P.openCycles(), { dirs: [] });
    const next = open ? Array.from(new Set([...list.dirs, dir])) : list.dirs.filter((d) => d !== dir);
    await writeJson(P.openCycles(), { dirs: next });
  });
}

export const isFinalized = async (dir: string): Promise<boolean> => RNFS.exists(cycleFile(dir, 'final.json'));

/** Writes the running counters (not the findings) so an interrupted cycle shows what it had reached. */
export async function checkpointCycle(handle: CycleHandle, patch: Partial<Pick<CycleReport, 'attempted'>> = {}): Promise<void> {
  if (await isFinalized(handle.dir)) throw new Error('This cycle is finished and cannot change.');
  handle.report.attempted = { ...handle.report.attempted, ...(patch.attempted ?? {}) };
  handle.report.stats.checkpoints += 1;
  await writeJson(cycleFile(handle.dir, 'report.json'), handle.report);
}

export function noteError(handle: CycleHandle, message: string, retries = 0): void {
  handle.report.errors.push({ at: nowIso(), message: message.slice(0, 300), retries });
  handle.report.stats.retries += retries;
}

export interface FindingInput {
  question: string;
  finding: string;
  uncertainty?: string;
  confidence: number;
  confidenceExplanation?: string;
  basis?: Basis;
  evidence: EvidenceRef[];
  sourceUrl?: string; documentTitle?: string; publicationDate?: string; jurisdiction?: string; effectiveDate?: string;
}

export interface AddResult { recordId: string; duplicate: boolean; corroborated?: boolean }

/**
 * Adds a finding to an open cycle. A finding with no second source is KEPT as provisional (never discarded for lacking one).
 * The same claim already known to this agent is not stored twice: if the new one rests on a different source, that source is
 * added to the existing finding as a revision (that is how a finding earns a second source), otherwise it is just counted.
 */
export async function addFinding(handle: CycleHandle, input: FindingInput): Promise<AddResult> {
  if (await isFinalized(handle.dir)) throw new Error('This cycle is finished: findings cannot be added to it.');
  const contentHash = findingContentHash(handle.topicId, input.finding);
  return withLock(`finding:${handle.agentId}:${contentHash}`, async () => {
    const known = await hashIndex.get(handle.agentId, contentHash);
    if (known) {
      const state = await stateIndex.get(known);
      const current = await getFinding(known);
      const newSources = input.evidence.filter((e) => !current?.evidence.some((x) => x.sourceHash === e.sourceHash && x.chunkId === e.chunkId));
      handle.report.attempted.findingsGenerated += 1;
      handle.report.retained.duplicatesSkipped += 1;
      if (current && state && newSources.length) {
        await addEvidence(known, newSources, 'corroborating source found again while studying');
        return { recordId: known, duplicate: true, corroborated: true };
      }
      return { recordId: known, duplicate: true };
    }
    const now = nowIso();
    const record: Finding = {
      schemaVersion: SCHEMA_VERSION, recordId: uuid(), sourceApp: SOURCE_APP, deviceId: await deviceId(), cycleId: handle.cycleId,
      topicId: handle.topicId, agentId: handle.agentId, question: input.question.trim(), finding: input.finding.trim(),
      uncertainty: (input.uncertainty ?? '').trim(), confidence: Math.max(0, Math.min(1, input.confidence)),
      ...(input.confidenceExplanation ? { confidenceExplanation: input.confidenceExplanation } : {}),
      basis: input.basis ?? 'observed', status: 'provisional', evidence: input.evidence,
      review: { judge: 'pending', manager: 'pending' }, contentHash, revision: 1,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}), ...(input.documentTitle ? { documentTitle: input.documentTitle } : {}),
      ...(input.publicationDate ? { publicationDate: input.publicationDate } : {}), ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
      ...(input.effectiveDate ? { effectiveDate: input.effectiveDate } : {}), createdAt: now, updatedAt: now,
    };
    const problems = validateFinding(record);
    if (problems.length) throw new Error(`Invalid finding: ${problems.join('; ')}`);
    await appendJsonl(cycleFile(handle.dir, 'findings.jsonl'), [record]);
    const state: RecordState = {
      recordId: record.recordId, agentId: record.agentId, topicId: record.topicId, cycleId: record.cycleId, cycleDir: handle.dir,
      status: record.status, confidence: record.confidence, contentHash, revision: 1, basis: record.basis,
      sources: distinctSources(record.evidence), updatedAt: now,
    };
    await stateIndex.put(state);
    await hashIndex.put(record.agentId, contentHash, record.recordId);
    await appendJsonl(P.agentKeywords(record.agentId), [{ recordId: record.recordId, cycleDir: handle.dir, terms: terms(`${record.question} ${record.finding}`) }]);
    handle.report.attempted.findingsGenerated += 1;
    handle.report.retained.provisional += 1;
    return { recordId: record.recordId, duplicate: false };
  });
}

/** Marks a cycle finished: writes the report (JSON and Markdown) and the marker after which it never changes. */
export async function finalizeCycle(
  handle: CycleHandle,
  result: { status: CycleStatus; summary: string; followUps?: string[]; knowledgeGaps?: string[] },
): Promise<CycleReport> {
  if (await isFinalized(handle.dir)) return handle.report;
  const ended = nowIso();
  const r = handle.report;
  r.status = result.status;
  r.endedAt = ended;
  r.runtimeSeconds = Math.round((Date.parse(ended) - Date.parse(r.startedAt)) / 1000);
  r.summary = result.summary;
  r.followUps = result.followUps ?? [];
  r.knowledgeGaps = result.knowledgeGaps ?? [];
  // What the cycle kept, counted from where its findings stand now (reviews made during the cycle included).
  const findings = await readJsonl<Finding>(cycleFile(handle.dir, 'findings.jsonl'));
  const counts = { accepted: 0, provisional: 0, needsReview: 0, rejected: 0, deferred: 0 };
  for (const f of findings) {
    const s = (await stateIndex.get(f.recordId))?.status ?? f.status;
    if (s === 'approved') counts.accepted++;
    else if (s === 'rejected') counts.rejected++;
    else if (s === 'needs-review' || s === 'conflicted') counts.needsReview++;
    else counts.provisional++;
  }
  r.retained = { ...r.retained, ...counts };
  r.stats.findingsPerMinute = r.runtimeSeconds > 0 ? Number(((findings.length * 60) / r.runtimeSeconds).toFixed(2)) : findings.length;
  r.finalized = true;
  await writeJson(cycleFile(handle.dir, 'report.json'), r);
  await atomicWriteText(cycleFile(handle.dir, 'report.md'), cycleMarkdown(r));
  await atomicWriteText(cycleFile(handle.dir, 'final.json'), JSON.stringify({ finalizedAt: ended, findings: findings.length }));
  await setOpen(handle.dir, false);
  return r;
}

export function cycleMarkdown(r: CycleReport): string {
  const L = [`# Learning cycle ${r.cycleId}`, '', `- Topic: ${r.topic} (${r.topicId})`, `- Agent: ${r.agentId}`, `- Model: ${r.model}`,
    `- Status: ${r.status}`, `- Started: ${r.startedAt}`, ...(r.endedAt ? [`- Ended: ${r.endedAt} (${r.runtimeSeconds}s)`] : []), '',
    '## Attempted', `- Sources searched: ${r.attempted.sourcesSearched}`, `- Documents processed: ${r.attempted.documentsProcessed}`,
    `- Chunks examined: ${r.attempted.chunksExamined}`, `- Findings generated: ${r.attempted.findingsGenerated}`, '',
    '## Retained', `- Approved: ${r.retained.accepted}`, `- Provisional: ${r.retained.provisional}`, `- Needs review or conflicted: ${r.retained.needsReview}`,
    `- Rejected: ${r.retained.rejected}`, `- Deferred: ${r.retained.deferred}`, `- Already known (not stored twice): ${r.retained.duplicatesSkipped}`, '',
    '## What was learned', r.summary || '(no summary)', ''];
  if (r.followUps.length) L.push('## Follow-up questions', ...r.followUps.map((q) => `- ${q}`), '');
  if (r.knowledgeGaps.length) L.push('## Knowledge gaps', ...r.knowledgeGaps.map((q) => `- ${q}`), '');
  if (r.errors.length) L.push('## Errors', ...r.errors.map((e) => `- ${e.at}: ${e.message}${e.retries ? ` (${e.retries} retries)` : ''}`), '');
  return L.join('\n');
}

// ------------------------------------------------------------------ reading a finding
// Parsed revision files, reused while a file's size is unchanged (a month's file only grows by appending), so looking up
// many findings does not re-read and re-parse the same revisions each time. At most a dozen files are held.
const revisionCache = new Map<string, { size: number; rows: RevisionRecord[] }>();
async function revisionRows(path: string): Promise<RevisionRecord[]> {
  const size = Number((await RNFS.stat(path)).size);
  const hit = revisionCache.get(path);
  if (hit && hit.size === size) return hit.rows;
  const rows = await readJsonl<RevisionRecord>(path);
  revisionCache.set(path, { size, rows });
  if (revisionCache.size > 12) revisionCache.delete(revisionCache.keys().next().value as string);
  return rows;
}

async function revisionsFor(recordId: string): Promise<RevisionRecord[]> {
  const out: RevisionRecord[] = [];
  for (const file of await listDir(P.revisionsDir())) {
    if (!file.endsWith('.jsonl')) continue;
    for (const r of await revisionRows(`${P.revisionsDir()}/${file}`)) if (r.recordId === recordId) out.push(r);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** The finding as it stands now: the stored record, plus evidence added later, with its current status and review states. */
export async function getFinding(recordId: string): Promise<Finding | null> {
  const state = await stateIndex.get(recordId);
  if (!state) return null;
  const base = (await readJsonl<Finding>(cycleFile(state.cycleDir, 'findings.jsonl'))).find((f) => f.recordId === recordId);
  if (!base) return null;
  const revisions = await revisionsFor(recordId);
  const evidence = [...base.evidence];
  for (const r of revisions) for (const e of r.evidence ?? []) if (!evidence.some((x) => x.sourceHash === e.sourceHash && x.chunkId === e.chunkId)) evidence.push(e);
  const reviews = await readJsonl<ReviewRecord>(cycleFile(state.cycleDir, 'reviews.jsonl'));
  const current: Finding = { ...base, evidence, status: state.status as FindingStatus, revision: state.revision, updatedAt: state.updatedAt };
  current.review = { judge: effectiveReview(current, reviews, 'judge'), manager: effectiveReview(current, reviews, 'manager') };
  return current;
}

// ------------------------------------------------------------------ reviews
/** The decision a reviewer's latest review still stands for: pending if the finding or its evidence changed since. */
export function effectiveReview(finding: Pick<Finding, 'recordId' | 'revision' | 'evidence'>, reviews: ReviewRecord[], role: ReviewerRole): ReviewState {
  const hash = evidenceHash(finding.evidence);
  const mine = reviews.filter((r) => r.recordId === finding.recordId && r.role === role).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const last = mine[mine.length - 1];
  return last && last.findingRevision === finding.revision && last.evidenceHash === hash ? last.decision : 'pending';
}

/** A reviewer's most recent review of a finding, whatever version it was about (null if none). */
export async function latestReview(recordId: string, role: ReviewerRole): Promise<ReviewRecord | null> {
  const state = await stateIndex.get(recordId);
  if (!state) return null;
  const mine = (await readJsonl<ReviewRecord>(cycleFile(state.cycleDir, 'reviews.jsonl'))).filter((r) => r.recordId === recordId && r.role === role);
  return mine.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).pop() ?? null;
}

/** What status the two reviews add up to. Approval needs BOTH; either rejecting rejects; any doubt keeps it open. */
export function statusFromReviews(judge: ReviewState, manager: ReviewState, current: FindingStatus): FindingStatus {
  if (current === 'superseded' || current === 'conflicted') return current;
  if (judge === 'rejected' || manager === 'rejected') return 'rejected';
  if (judge === 'approved' && manager === 'approved') return 'approved';
  if (judge === 'needs-review' || manager === 'needs-review' || judge === 'deferred' || manager === 'deferred') return 'needs-review';
  return 'provisional';
}

const revisionFile = () => P.revisions(nowIso().slice(0, 7));
async function writeRevision(r: Omit<RevisionRecord, 'schemaVersion' | 'revisionId' | 'createdAt'>): Promise<void> {
  await appendJsonl(revisionFile(), [{ schemaVersion: SCHEMA_VERSION, revisionId: uuid(), createdAt: nowIso(), ...r }]);
}

export async function addReview(input: { recordId: string; role: ReviewerRole; decision: ReviewDecision; reason: string; by: string }): Promise<Finding> {
  return withLock(`review:${input.recordId}`, async () => {
    const finding = await getFinding(input.recordId);
    const state = await stateIndex.get(input.recordId);
    if (!finding || !state) throw new Error('No such finding.');
    const review: ReviewRecord = {
      schemaVersion: SCHEMA_VERSION, reviewId: uuid(), recordId: input.recordId, role: input.role, decision: input.decision,
      findingRevision: finding.revision, evidenceHash: evidenceHash(finding.evidence), reason: input.reason.slice(0, 500), by: input.by, createdAt: nowIso(),
    };
    const problems = validateReview(review);
    if (problems.length) throw new Error(`Invalid review: ${problems.join('; ')}`);
    await appendJsonl(cycleFile(state.cycleDir, 'reviews.jsonl'), [review]);
    return refreshStatus(input.recordId, `${input.role} ${input.decision}: ${input.reason}`.slice(0, 200), input.by);
  });
}

async function refreshStatus(recordId: string, note: string, by: string): Promise<Finding> {
  const state = (await stateIndex.get(recordId))!;
  const finding = (await getFinding(recordId))!;
  const next = statusFromReviews(finding.review.judge, finding.review.manager, state.status as FindingStatus);
  if (next !== state.status) {
    await writeRevision({ recordId, kind: 'status', status: next, note, by });
    await stateIndex.put({ ...state, status: next, sources: distinctSources(finding.evidence), updatedAt: nowIso() });
  } else {
    await stateIndex.put({ ...state, sources: distinctSources(finding.evidence), updatedAt: nowIso() });
  }
  return (await getFinding(recordId))!;
}

/**
 * Adds evidence to a finding already stored. That changes the evidence hash, so earlier approvals no longer apply and the finding
 * goes back to being reviewed: an approval is only ever about the evidence it was given.
 */
export async function addEvidence(recordId: string, evidence: EvidenceRef[], note: string): Promise<Finding> {
  const state = await stateIndex.get(recordId);
  if (!state) throw new Error('No such finding.');
  await writeRevision({ recordId, kind: 'evidence-added', evidence, note, by: 'atlas' });
  // The evidence changed, so any approval given for the old evidence is stale (effectiveReview ties approvals to the evidence hash):
  // an approved finding goes back to provisional, a rejected one is reopened for review, other statuses stay as they are.
  const reopened: Record<string, FindingStatus> = { approved: 'provisional', rejected: 'needs-review' };
  const status = (reopened[state.status] ?? state.status) as FindingStatus;
  const f0 = await getFinding(recordId);
  await stateIndex.put({ ...state, revision: state.revision + 1, status, sources: distinctSources(f0?.evidence ?? []), updatedAt: nowIso() });
  if (status !== state.status) await writeRevision({ recordId, kind: 'status', status, note: 'evidence changed, earlier decisions no longer apply', by: 'atlas' });
  return (await getFinding(recordId))!;
}

// ------------------------------------------------------------------ conflicts and supersession
/** Keeps two contradictory findings side by side, both flagged for review, neither overwriting the other. */
export async function markConflict(pair: readonly [string, string], note: string, by = 'atlas'): Promise<void> {
  const [a, b] = pair;
  for (const [id, other] of [[a, b], [b, a]] as const) {
    const state = await stateIndex.get(id);
    if (!state) throw new Error('No such finding.');
    await writeRevision({ recordId: id, kind: 'status', status: 'conflicted', note: `conflicts with ${other}: ${note}`.slice(0, 300), by });
    await stateIndex.put({ ...state, status: 'conflicted', updatedAt: nowIso() });
  }
}

export async function supersede(ids: { oldId: string; newId: string }, note: string, by = 'atlas'): Promise<void> {
  const { oldId, newId } = ids;
  const state = await stateIndex.get(oldId);
  if (!state) throw new Error('No such finding.');
  await writeRevision({ recordId: oldId, kind: 'supersession', status: 'superseded', supersededBy: newId, note, by });
  await stateIndex.put({ ...state, status: 'superseded', supersededBy: newId, updatedAt: nowIso() });
}

// ------------------------------------------------------------------ erasing
/**
 * Permanently removes findings (the person deleted the source they came from). This is the one thing allowed to change a finished
 * cycle's files, because deleting must really delete: the findings and their reviews are taken out of the cycle's files and the
 * index, and only an id-and-reason tombstone remains, so the same knowledge does not come back through a later import.
 */
export async function eraseFindings(recordIds: string[], reason: string): Promise<number> {
  const byDir = new Map<string, Set<string>>();
  for (const id of recordIds) {
    const state = await stateIndex.get(id);
    if (!state) continue;
    (byDir.get(state.cycleDir) ?? byDir.set(state.cycleDir, new Set()).get(state.cycleDir)!).add(id);
  }
  let erased = 0;
  const tombstones: unknown[] = [];
  for (const [dir, ids] of byDir) {
    await withLock(`erase:${dir}`, async () => {
      for (const [file, key] of [['findings.jsonl', 'recordId'], ['reviews.jsonl', 'recordId']] as const) {
        const rows = await readJsonl<Record<string, unknown>>(cycleFile(dir, file));
        const kept = rows.filter((r) => !ids.has(String(r[key])));
        if (kept.length !== rows.length) await atomicWriteText(cycleFile(dir, file), kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''));
      }
    });
    for (const id of ids) {
      const state = (await stateIndex.get(id))!;
      await hashIndex.remove(state.agentId, state.contentHash);
      await stateIndex.remove(id);
      tombstones.push({ schemaVersion: SCHEMA_VERSION, tombstoneId: uuid(), kind: 'finding', targetId: id, targetHash: state.contentHash, reason, createdAt: nowIso() });
      erased++;
    }
  }
  await appendJsonl(P.tombstones(), tombstones);
  return erased;
}

/** Every finding whose evidence cites the document with this hash (a scan of the cycles: for the rare delete, not for browsing). */
export async function findingsCiting(sourceHash: string): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const c of await listCycles()) {
    for (const f of await readJsonl<Finding>(cycleFile(c.dir, 'findings.jsonl'))) {
      if (!(await stateIndex.get(f.recordId))) continue;
      const current = (await getFinding(f.recordId)) ?? f;
      if (current.evidence.some((e) => e.sourceHash === sourceHash)) out.push(current);
    }
  }
  return out;
}

// ------------------------------------------------------------------ listing and search
export interface Query { agentId?: string; status?: FindingStatus | FindingStatus[]; text?: string; limit?: number }

/** Findings for an agent (or all), newest information first. Search uses the per-agent keyword index, then reads only what matched. */
export async function searchFindings(q: Query): Promise<Finding[]> {
  // With no agent given, every agent that has any indexed knowledge: found from the index files themselves, so a missing or
  // outdated agent list can never hide knowledge.
  const agentIds = q.agentId ? [q.agentId] : (await listDir(P.indexDir())).filter((n) => n.startsWith('agent-') && n.endsWith('.jsonl')).map((n) => n.slice(6, -6));
  const wanted = q.text ? terms(q.text, 8) : [];
  const statuses = q.status ? ([] as FindingStatus[]).concat(q.status) : null;
  const best = new Map<string, number>();
  for (const agentId of agentIds) {
    for (const entry of await readJsonl<{ recordId: string; terms: string[] }>(P.agentKeywords(agentId))) {
      const score = wanted.length ? wanted.filter((w) => entry.terms.some((t) => t === w || t.startsWith(w) || w.startsWith(t))).length : 1;
      // The same finding can be listed under two agents after a split or merge; it counts once.
      if (score > 0 && score > (best.get(entry.recordId) ?? 0)) best.set(entry.recordId, score);
    }
  }
  const scored = [...best.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
  const out: Finding[] = [];
  for (const { id } of scored) {
    const state = await stateIndex.get(id);
    // A finding belongs to the agent its state says it belongs to now (a split or merge moves it), not to every index that lists it.
    if (!state || (q.agentId && state.agentId !== q.agentId) || (statuses && !statuses.includes(state.status as FindingStatus))) continue;
    const f = await getFinding(id);
    if (f) out.push(f);
    if (out.length >= (q.limit ?? 20)) break;
  }
  return out;
}

export async function listCycles(): Promise<Array<{ cycleId: string; dir: string; agentId: string; topicId: string; startedAt: string }>> {
  return readJsonl(P.cyclesIndex());
}

export async function readReport(dir: string): Promise<CycleReport | null> {
  const text = await readText(cycleFile(dir, 'report.json'));
  return text ? (JSON.parse(text) as CycleReport) : null;
}

/** An unfinished cycle left by a killed app is closed as interrupted, so it shows what it reached rather than looking alive. */
export async function closeInterruptedCycles(): Promise<number> {
  let closed = 0;
  const open = (await readJson<{ dirs: string[] }>(P.openCycles(), { dirs: [] })).dirs;
  const index = open.length ? await listCycles() : [];
  for (const dir of open) {
    const c = index.find((x) => x.dir === dir);
    const report = await readReport(dir);
    if (!c || !report || (await isFinalized(dir)) || report.status !== 'running') { await setOpen(dir, false); continue; }
    const handle: CycleHandle = { cycleId: c.cycleId, dir, agentId: c.agentId, topicId: c.topicId, startedAtMs: Date.parse(c.startedAt), report };
    await finalizeCycle(handle, { status: 'interrupted', summary: 'This cycle was interrupted before it finished. Its findings so far were kept.' });
    closed++;
  }
  return closed;
}
