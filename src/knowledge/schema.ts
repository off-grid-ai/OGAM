/**
 * Atlas learning knowledge: record shapes and their validators (schema version 1.0).
 *
 * Every record that is stored or exchanged carries `schemaVersion`. Validators return a list of problems (empty = valid) so a
 * caller can report exactly what is wrong instead of failing on the first problem. They are written by hand, with no schema
 * library, so they run identically on the phone, in tests and in an importer on another platform.
 *
 * Three rules are enforced here, not just recommended:
 *  - a finding is never authoritative on a number alone: `approved` needs evidence AND an approval from both the judge and the
 *    manager;
 *  - observed source content, the model's inference and an independently verified conclusion are different things (`basis`);
 *  - an approval belongs to ONE version of a finding and its evidence (`findingRevision` + `evidenceHash`); a changed finding
 *    is back to pending (see effectiveReview in cycles.ts).
 */

export const SCHEMA_VERSION = '1.0';
export const SOURCE_APP = 'atlas';

export type FindingStatus = 'provisional' | 'needs-review' | 'approved' | 'rejected' | 'conflicted' | 'superseded';
export const FINDING_STATUSES: FindingStatus[] = ['provisional', 'needs-review', 'approved', 'rejected', 'conflicted', 'superseded'];

/** observed = said by the source; inferred = the model's own reasoning from it; verified = independently checked. */
export type Basis = 'observed' | 'inferred' | 'verified';
export const BASES: Basis[] = ['observed', 'inferred', 'verified'];

export type ReviewDecision = 'approved' | 'rejected' | 'needs-review' | 'deferred';
export type ReviewState = 'pending' | ReviewDecision;
export const REVIEW_DECISIONS: ReviewDecision[] = ['approved', 'rejected', 'needs-review', 'deferred'];
export type ReviewerRole = 'judge' | 'manager';

export interface EvidenceRef {
  sourceId: string;
  /** SHA-256 of the source document's bytes. */
  sourceHash: string;
  page?: number;
  chunkId: string;
  locator?: string;
  /** Verbatim text from the chunk that supports the finding (what the evidence judge checks). */
  quote?: string;
}

export interface Finding {
  schemaVersion: string;
  recordId: string;
  sourceApp: typeof SOURCE_APP;
  deviceId: string;
  cycleId: string;
  topicId: string;
  agentId: string;
  question: string;
  finding: string;
  uncertainty: string;
  confidence: number;
  confidenceExplanation?: string;
  basis: Basis;
  status: FindingStatus;
  evidence: EvidenceRef[];
  review: { judge: ReviewState; manager: ReviewState };
  /** SHA-256 of the normalised topic + finding text: the stable identity used to recognise the same finding again. */
  contentHash: string;
  /** 1 for the first version; a correction creates a revision record, never an edit of this one. */
  revision: number;
  sourceUrl?: string;
  documentTitle?: string;
  publicationDate?: string;
  jurisdiction?: string;
  effectiveDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRecord {
  schemaVersion: string;
  reviewId: string;
  recordId: string;
  role: ReviewerRole;
  decision: ReviewDecision;
  /** The version of the finding this decision is about. */
  findingRevision: number;
  /** Hash of the finding's evidence at that version: changed evidence makes the decision stale. */
  evidenceHash: string;
  reason: string;
  /** Model or "evidence-check" / "person" that made the decision. */
  by: string;
  createdAt: string;
}

export type CycleStatus = 'running' | 'completed' | 'interrupted' | 'failed';

export interface CycleReport {
  schemaVersion: string;
  cycleId: string;
  sourceApp: typeof SOURCE_APP;
  deviceId: string;
  agentId: string;
  topicId: string;
  topic: string;
  model: string;
  status: CycleStatus;
  startedAt: string;
  endedAt?: string;
  runtimeSeconds?: number;
  /** What was tried. */
  attempted: { sourcesSearched: number; documentsProcessed: number; chunksExamined: number; findingsGenerated: number };
  /** What was actually kept. */
  retained: { accepted: number; provisional: number; needsReview: number; rejected: number; deferred: number; duplicatesSkipped: number };
  findingsFile: string;
  reviewsFile: string;
  summary: string;
  followUps: string[];
  knowledgeGaps: string[];
  errors: Array<{ at: string; message: string; retries?: number }>;
  stats: { findingsPerMinute?: number; retries: number; checkpoints: number };
  finalized: boolean;
}

export interface AgentProfile {
  schemaVersion: string;
  agentId: string;
  /** The Atlas agent (persona) that answers as this expert, once promoted. */
  atlasAgentId?: string;
  topicId: string;
  name: string;
  specialization: string;
  scope: string;
  /** Words that route a question or document here. */
  keywords: string[];
  instructions: string;
  /** provisional = a workspace still gathering evidence; expert = promoted, persistent. */
  stage: 'provisional' | 'expert';
  mergedInto?: string;
  createdAt: string;
  updatedAt: string;
  promotedAt?: string;
  stats: { cycles: number; findings: number; approved: number; provisional: number; conflicted: number; documents: number };
  /** Measured, not asserted: what a quick self-test of the agent's own knowledge found. */
  evaluation?: { at: string; questions: number; answered: number; cited: number; score: number };
}

export interface SourceDocument {
  schemaVersion: string;
  sourceId: string;
  /** SHA-256 of the file's bytes. */
  hash: string;
  name: string;
  title?: string;
  bytes: number;
  pages?: number;
  importedAt: string;
  agentId?: string;
  topicId?: string;
  status: 'imported' | 'extracting' | 'chunking' | 'ready' | 'studying' | 'paused' | 'done' | 'failed';
  progress: { pagesExtracted: number; chunksTotal: number; chunksStudied: number };
  /** Pages with no extractable text and no OCR available: studied as nothing, and listed so that is visible. */
  unreadablePages: number[];
  /** Pages whose text was read from a picture by the vision model (may contain misreadings). */
  ocrPages?: number[];
  error?: string;
  /** Removed by the person: the original and its knowledge are deleted; a tombstone stops it coming back through sync. */
  removed?: boolean;
}

export interface ChunkRecord {
  schemaVersion: string;
  chunkId: string;
  sourceId: string;
  sourceHash: string;
  ordinal: number;
  page: number;
  pageEnd: number;
  section?: string;
  /** Approximate token count (characters / 4). */
  tokens: number;
  text: string;
  /** True when the chunk is a table kept whole. */
  table?: boolean;
}

export interface RevisionRecord {
  schemaVersion: string;
  revisionId: string;
  recordId: string;
  kind: 'status' | 'evidence-added' | 'correction' | 'supersession';
  /** Status after this revision (for kind status/supersession). */
  status?: FindingStatus;
  supersededBy?: string;
  evidence?: EvidenceRef[];
  note: string;
  by: string;
  createdAt: string;
}

export interface Tombstone {
  schemaVersion: string;
  tombstoneId: string;
  kind: 'finding' | 'document' | 'agent';
  /** recordId, sourceId or agentId. */
  targetId: string;
  /** For documents: the file hash, so re-importing the same bytes does not silently revive deleted knowledge. */
  targetHash?: string;
  reason: string;
  createdAt: string;
}

export interface ExportManifest {
  schemaVersion: string;
  bundleType: 'atlas-learning-export';
  exportId: string;
  sourceApp: typeof SOURCE_APP;
  deviceId: string;
  appVersion?: string;
  createdAt: string;
  scope: { kind: 'all' | 'agents' | 'subjects' | 'since'; agentIds?: string[]; topicIds?: string[]; since?: string };
  includesOriginals: boolean;
  counts: { agents: number; cycles: number; findings: number; reviews: number; documents: number; chunks: number; revisions: number; tombstones: number };
  files: Array<{ path: string; bytes: number; sha256: string }>;
  compatibility: { interchange: string; streetAdvisory: 'adapter-required'; note: string };
}

// ---------------------------------------------------------------- validators

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const isIso = (v: unknown): boolean => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));
const HEX64 = /^[0-9a-f]{64}$/;
/** Ids become file names and index keys, so they are kept to a safe alphabet. */
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function common(v: unknown, label: string): { o: Obj; problems: string[] } {
  if (!isObj(v)) return { o: {}, problems: [`${label}: not an object`] };
  const problems: string[] = [];
  if (v.schemaVersion !== SCHEMA_VERSION) problems.push(`${label}: schemaVersion must be "${SCHEMA_VERSION}" (got ${JSON.stringify(v.schemaVersion)})`);
  return { o: v, problems };
}

export function validateEvidence(e: unknown, label = 'evidence'): string[] {
  if (!isObj(e)) return [`${label}: not an object`];
  const p: string[] = [];
  if (!SAFE_ID.test(String(e.sourceId ?? ''))) p.push(`${label}.sourceId: missing or unsafe`);
  if (!HEX64.test(String(e.sourceHash ?? ''))) p.push(`${label}.sourceHash: must be a SHA-256 (64 hex characters)`);
  if (!SAFE_ID.test(String(e.chunkId ?? ''))) p.push(`${label}.chunkId: missing or unsafe`);
  if (e.page !== undefined && !(Number.isInteger(e.page) && (e.page as number) >= 1)) p.push(`${label}.page: must be a whole number from 1`);
  return p;
}

export function validateFinding(v: unknown): string[] {
  const { o, problems } = common(v, 'finding');
  if (!isObj(v)) return problems;
  if (o.sourceApp !== SOURCE_APP && !isStr(o.sourceApp)) problems.push('finding.sourceApp: missing');
  for (const key of ['recordId', 'deviceId', 'cycleId', 'topicId', 'agentId']) if (!SAFE_ID.test(String(o[key] ?? ''))) problems.push(`finding.${key}: missing or unsafe`);
  for (const key of ['question', 'finding']) if (!isStr(o[key])) problems.push(`finding.${key}: required text`);
  if (typeof o.uncertainty !== 'string') problems.push('finding.uncertainty: required (use "" for none)');
  if (typeof o.confidence !== 'number' || !(o.confidence >= 0 && o.confidence <= 1)) problems.push('finding.confidence: must be a number from 0 to 1');
  if (!FINDING_STATUSES.includes(o.status as FindingStatus)) problems.push(`finding.status: must be one of ${FINDING_STATUSES.join(', ')}`);
  if (!BASES.includes(o.basis as Basis)) problems.push(`finding.basis: must be one of ${BASES.join(', ')}`);
  if (!HEX64.test(String(o.contentHash ?? ''))) problems.push('finding.contentHash: must be a SHA-256');
  if (!(Number.isInteger(o.revision) && (o.revision as number) >= 1)) problems.push('finding.revision: must be a whole number from 1');
  if (!isIso(o.createdAt)) problems.push('finding.createdAt: must be an ISO 8601 UTC time');
  if (!isIso(o.updatedAt)) problems.push('finding.updatedAt: must be an ISO 8601 UTC time');
  const evidence = Array.isArray(o.evidence) ? o.evidence : null;
  if (!evidence) problems.push('finding.evidence: must be a list');
  else evidence.forEach((e, i) => problems.push(...validateEvidence(e, `finding.evidence[${i}]`)));
  const review = isObj(o.review) ? o.review : null;
  const states = ['pending', ...REVIEW_DECISIONS];
  if (!review || !states.includes(String(review.judge)) || !states.includes(String(review.manager))) problems.push('finding.review: judge and manager must each be pending, approved, rejected, needs-review or deferred');
  // Never authoritative on a number alone.
  if (o.status === 'approved') {
    if (!evidence || evidence.length === 0) problems.push('finding: an approved finding needs evidence');
    if (!review || review.judge !== 'approved' || review.manager !== 'approved') problems.push('finding: an approved finding needs approval from both the judge and the manager');
  }
  return problems;
}

export function validateReview(v: unknown): string[] {
  const { o, problems } = common(v, 'review');
  if (!isObj(v)) return problems;
  for (const key of ['reviewId', 'recordId']) if (!SAFE_ID.test(String(o[key] ?? ''))) problems.push(`review.${key}: missing or unsafe`);
  if (o.role !== 'judge' && o.role !== 'manager') problems.push('review.role: must be judge or manager');
  if (!REVIEW_DECISIONS.includes(o.decision as ReviewDecision)) problems.push('review.decision: invalid');
  if (!(Number.isInteger(o.findingRevision) && (o.findingRevision as number) >= 1)) problems.push('review.findingRevision: must be a whole number from 1');
  if (!HEX64.test(String(o.evidenceHash ?? ''))) problems.push('review.evidenceHash: must be a SHA-256');
  if (typeof o.reason !== 'string') problems.push('review.reason: required text');
  if (!isStr(o.by)) problems.push('review.by: required');
  if (!isIso(o.createdAt)) problems.push('review.createdAt: must be an ISO 8601 UTC time');
  return problems;
}

export function validateCycleReport(v: unknown): string[] {
  const { o, problems } = common(v, 'report');
  if (!isObj(v)) return problems;
  for (const key of ['cycleId', 'deviceId', 'agentId', 'topicId']) if (!SAFE_ID.test(String(o[key] ?? ''))) problems.push(`report.${key}: missing or unsafe`);
  if (!['running', 'completed', 'interrupted', 'failed'].includes(String(o.status))) problems.push('report.status: invalid');
  if (!isIso(o.startedAt)) problems.push('report.startedAt: must be an ISO 8601 UTC time');
  if (o.endedAt !== undefined && !isIso(o.endedAt)) problems.push('report.endedAt: must be an ISO 8601 UTC time');
  if (!isObj(o.attempted) || !isObj(o.retained)) problems.push('report: attempted and retained counts are both required');
  if (typeof o.summary !== 'string') problems.push('report.summary: required');
  return problems;
}

export function validateAgentProfile(v: unknown): string[] {
  const { o, problems } = common(v, 'agent');
  if (!isObj(v)) return problems;
  if (!SAFE_ID.test(String(o.agentId ?? ''))) problems.push('agent.agentId: missing or unsafe');
  if (!SAFE_ID.test(String(o.topicId ?? ''))) problems.push('agent.topicId: missing or unsafe');
  if (!isStr(o.name)) problems.push('agent.name: required');
  if (o.stage !== 'provisional' && o.stage !== 'expert') problems.push('agent.stage: must be provisional or expert');
  if (!Array.isArray(o.keywords)) problems.push('agent.keywords: must be a list');
  return problems;
}

export function validateSourceDocument(v: unknown): string[] {
  const { o, problems } = common(v, 'document');
  if (!isObj(v)) return problems;
  if (!SAFE_ID.test(String(o.sourceId ?? ''))) problems.push('document.sourceId: missing or unsafe');
  if (!HEX64.test(String(o.hash ?? ''))) problems.push('document.hash: must be a SHA-256');
  if (!isStr(o.name)) problems.push('document.name: required');
  return problems;
}

export function validateChunk(v: unknown): string[] {
  const { o, problems } = common(v, 'chunk');
  if (!isObj(v)) return problems;
  for (const key of ['chunkId', 'sourceId']) if (!SAFE_ID.test(String(o[key] ?? ''))) problems.push(`chunk.${key}: missing or unsafe`);
  if (!HEX64.test(String(o.sourceHash ?? ''))) problems.push('chunk.sourceHash: must be a SHA-256');
  if (!(Number.isInteger(o.page) && (o.page as number) >= 1)) problems.push('chunk.page: must be a whole number from 1');
  if (!isStr(o.text)) problems.push('chunk.text: required');
  return problems;
}

export function validateRevision(v: unknown): string[] {
  const { o, problems } = common(v, 'revision');
  if (!isObj(v)) return problems;
  for (const key of ['revisionId', 'recordId']) if (!SAFE_ID.test(String(o[key] ?? ''))) problems.push(`revision.${key}: missing or unsafe`);
  if (!['status', 'evidence-added', 'correction', 'supersession'].includes(String(o.kind))) problems.push('revision.kind: invalid');
  if (!isIso(o.createdAt)) problems.push('revision.createdAt: must be an ISO 8601 UTC time');
  return problems;
}

export function validateTombstone(v: unknown): string[] {
  const { o, problems } = common(v, 'tombstone');
  if (!isObj(v)) return problems;
  if (!SAFE_ID.test(String(o.tombstoneId ?? ''))) problems.push('tombstone.tombstoneId: missing or unsafe');
  if (!['finding', 'document', 'agent'].includes(String(o.kind))) problems.push('tombstone.kind: invalid');
  if (!isStr(o.targetId)) problems.push('tombstone.targetId: required');
  if (!isIso(o.createdAt)) problems.push('tombstone.createdAt: must be an ISO 8601 UTC time');
  return problems;
}

export function validateManifest(v: unknown): string[] {
  const { o, problems } = common(v, 'manifest');
  if (!isObj(v)) return problems;
  if (o.bundleType !== 'atlas-learning-export') problems.push('manifest.bundleType: must be "atlas-learning-export"');
  if (!SAFE_ID.test(String(o.exportId ?? ''))) problems.push('manifest.exportId: missing or unsafe');
  if (!isIso(o.createdAt)) problems.push('manifest.createdAt: must be an ISO 8601 UTC time');
  if (!isObj(o.counts)) problems.push('manifest.counts: required');
  if (!Array.isArray(o.files)) problems.push('manifest.files: must be a list');
  else (o.files as unknown[]).forEach((f, i) => {
    if (!isObj(f) || !isStr(f.path) || !HEX64.test(String(f.sha256 ?? '')) || !Number.isInteger(f.bytes)) problems.push(`manifest.files[${i}]: needs path, bytes and sha256`);
  });
  return problems;
}

/** A path inside an archive is safe if it is relative, has no "..", no drive letter and no backslashes. */
export function isSafeArchivePath(path: string): boolean {
  return !!path && !path.startsWith('/') && !path.includes('\\') && !/(^|\/)\.\.(\/|$)/.test(path) && !/^[A-Za-z]:/.test(path) && path.length < 260;
}
