/**
 * The expert studies a document: progressive, cited, resumable.
 *
 * For each small batch of chunks the model is asked for findings that the PASSAGE itself supports, each with a verbatim quote.
 * The quote is then checked against the chunk text in code (not by asking a model): a finding whose quote is really on the page is
 * "observed" and passes the evidence check; one whose quote is not there is kept but marked "inferred" and sent to review. Nothing
 * is thrown away for lacking a second source: a single-source finding is stored as provisional, and the manager step approves it
 * only once a second independent source has corroborated it. After each batch a checkpoint is written; a paused or killed run
 * resumes at the next chunk, and findings are recognised by content so a repeated batch adds nothing twice.
 *
 * This is retrieval-based knowledge. The model's weights are never trained or changed.
 */
import {
  addFinding, addReview, checkpointCycle, finalizeCycle, getFinding, latestReview, noteError, searchFindings, startCycle,
  type CycleHandle, type FindingInput,
} from './cycles';
import { getProfile, promoteIfReady, refreshStats, routeSubject, setDocumentCount, widenKeywords } from './agents';
import { assignDocument, chunkDocument, extractDocument, getDocument, listDocuments, markStudied, readChunks, setDocumentStatus } from './documents';
import { withJobLock } from './jobs';
import { currentModelName, modelAsker, type Ask } from './model';
import { P, readJson, readJsonl, stateIndex, terms, writeJson } from './storage';
import type { Basis, ChunkRecord, CycleReport } from './schema';

export const BATCH_CHUNKS = 3;
const MAX_FINDINGS_PER_CHUNK = 3;

export interface StudyProgress { sourceId: string; agentId: string; phase: 'extracting' | 'chunking' | 'studying' | 'finishing'; chunksStudied: number; chunksTotal: number; findings: number; pages?: number }
export interface StudyOptions {
  agentId?: string;
  batchChunks?: number;
  shouldStop?: () => boolean;
  onProgress?: (p: StudyProgress) => void;
  ask?: Ask;
}
export interface StudyOutcome { status: 'completed' | 'paused'; agentId: string; report: CycleReport | null; chunksStudied: number; chunksTotal: number; findings: number }

const SYSTEM = (agentName: string) => [
  `You are studying a document to become the ${agentName}.`,
  'Read ONLY the passage you are given. Use nothing from outside it.',
  `Reply with a JSON array and nothing else: up to ${MAX_FINDINGS_PER_CHUNK} findings. Each finding is an object with these keys:`,
  '"question": the question this finding answers;',
  '"finding": one or two sentences stating what the passage says, complete enough to stand alone;',
  '"quote": an exact phrase copied word for word from the passage (10 to 200 characters) that supports the finding;',
  '"uncertainty": what is unclear, missing or limited (an empty string if nothing);',
  '"confidence": a number from 0 to 1;',
  '"basis": "observed" if the passage says it outright, "inferred" if you are reasoning from it.',
  'Facts, definitions, formulas, methods and relationships are worth keeping. If the passage has nothing worth keeping, reply [].',
].join('\n');

const MODEL_UNAVAILABLE = /no model selected|could not be loaded|failed to load|no model loaded/i;

interface RawFinding { question?: unknown; finding?: unknown; quote?: unknown; uncertainty?: unknown; confidence?: unknown; basis?: unknown }

/** Pulls the JSON array out of a reply, tolerating text around it. */
export function parseFindings(reply: string): RawFinding[] | null {
  const start = reply.indexOf('['); const end = reply.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x === 'object') : null;
  } catch { return null; }
}

const flat = (t: string) => t.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[^a-z0-9% .,'$-]/g, '').trim();
/** True when the quote really is in the chunk (case, spacing and punctuation aside). */
export const quoteIsOnThePage = (quote: string, chunkText: string): boolean => { const q = flat(quote); return q.length >= 10 && flat(chunkText).includes(q); };

interface Checkpoint { sourceId: string; next: number; findings: number; updatedAt: string }

async function findingsForChunk(chunk: ChunkRecord, agentName: string, ask: Ask, handle: CycleHandle): Promise<RawFinding[]> {
  const where = `page ${chunk.page}${chunk.pageEnd > chunk.page ? `-${chunk.pageEnd}` : ''}${chunk.section ? `, ${chunk.section}` : ''}`;
  const user = `Passage (${where}):\n"""\n${chunk.text}\n"""`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = parseFindings(await ask(SYSTEM(agentName), attempt ? `${user}\n\nReply with ONLY the JSON array.` : user));
      if (parsed) return parsed.slice(0, MAX_FINDINGS_PER_CHUNK);
      noteError(handle, `Reply for chunk ${chunk.ordinal} was not a JSON list`, attempt);
    } catch (e: any) {
      const message = String(e?.message || e);
      // A model that is missing or cannot load is not a problem with this chunk: stop here, so the run is resumable and nothing
      // is marked studied that was never read.
      if (message === 'stopped' || MODEL_UNAVAILABLE.test(message)) throw e;
      noteError(handle, `Chunk ${chunk.ordinal}: ${message}`, attempt);
    }
  }
  return [];
}

/** Files one raw finding with its evidence, runs the evidence check, and returns the status it ended with. */
async function fileFinding(handle: CycleHandle, chunk: ChunkRecord, raw: RawFinding, title: string): Promise<boolean> {
  const finding = typeof raw.finding === 'string' ? raw.finding.trim() : '';
  const question = typeof raw.question === 'string' ? raw.question.trim() : '';
  if (finding.length < 15 || !question) return false;
  const quote = typeof raw.quote === 'string' ? raw.quote.trim() : '';
  const found = quoteIsOnThePage(quote, chunk.text);
  const basis: Basis = found && raw.basis !== 'inferred' ? 'observed' : 'inferred';
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0.5));
  const input: FindingInput = {
    question, finding, uncertainty: typeof raw.uncertainty === 'string' ? raw.uncertainty : '', basis,
    confidence: found ? confidence : Math.min(confidence, 0.4),
    confidenceExplanation: found ? 'The supporting quote was found on the cited page.' : 'The supporting quote was not found on the cited page, so confidence is capped.',
    documentTitle: title,
    evidence: [{
      sourceId: chunk.sourceId, sourceHash: chunk.sourceHash, page: chunk.page, chunkId: chunk.chunkId,
      locator: `page ${chunk.page}${chunk.section ? `, ${chunk.section}` : ''}`, ...(found ? { quote } : {}),
    }],
  };
  const { recordId, duplicate, corroborated } = await addFinding(handle, input);
  if (duplicate && corroborated) {
    // The same finding turned up in another source. New evidence voids the old decisions, so the judge looks again: this source's
    // quote must really be on its page, and the earlier source must have passed the same check.
    const earlier = await latestReview(recordId, 'judge');
    await addReview({
      recordId, role: 'judge', by: 'evidence-check',
      decision: found && earlier?.decision === 'approved' ? 'approved' : 'needs-review',
      reason: found && earlier?.decision === 'approved' ? 'The quote appears on both cited pages.' : 'One of the cited quotes could not be confirmed on its page.',
    });
  }
  if (!duplicate) {
    await addReview({
      recordId, role: 'judge', by: 'evidence-check',
      decision: found ? 'approved' : 'needs-review',
      reason: found ? 'The quote appears on the cited page.' : 'The quote could not be found on the cited page; review before relying on it.',
    });
  }
  return !duplicate;
}

/**
 * The manager step. A finding becomes approved only when the judge approved it AND at least two independent sources support it
 * (or a person approves it). Everything else stays provisional: kept, findable, labelled, and waiting for corroboration.
 */
export async function managerPass(agentId: string): Promise<number> {
  let approved = 0;
  for (const entry of await readJsonl<{ recordId: string }>(P.agentKeywords(agentId))) {
    const state = await stateIndex.get(entry.recordId);
    if (!state || state.agentId !== agentId || state.status === 'approved' || state.status === 'rejected' || state.status === 'conflicted' || state.status === 'superseded') continue;
    const f = await getFinding(entry.recordId);
    if (!f || f.review.judge !== 'approved' || f.review.manager === 'approved') continue;
    const sources = new Set(f.evidence.map((e) => e.sourceHash)).size;
    if (sources >= 2) { await addReview({ recordId: f.recordId, role: 'manager', by: 'atlas', decision: 'approved', reason: `Supported by ${sources} independent sources.` }); approved++; }
  }
  return approved;
}

export async function studyDocument(sourceId: string, opts: StudyOptions = {}): Promise<StudyOutcome> {
  const ask = opts.ask ?? modelAsker(opts.shouldStop);
  return withJobLock(`study ${sourceId}`, async (heartbeat) => {
    let doc = await getDocument(sourceId);
    if (!doc || doc.removed) throw new Error('No such document.');
    const progress = (phase: StudyProgress['phase'], agentId: string, findings: number, d = doc!, studied?: number) => opts.onProgress?.({ sourceId, agentId, phase, chunksStudied: studied ?? d.progress.chunksStudied, chunksTotal: d.progress.chunksTotal, findings, pages: d.pages });

    if (doc.status !== 'ready' && doc.status !== 'studying' && doc.status !== 'done') {
      progress('extracting', doc.agentId ?? '', 0);
      doc = await extractDocument(sourceId, { shouldStop: opts.shouldStop, onProgress: (d) => progress('extracting', d.agentId ?? '', 0, d) });
      if (doc.status === 'paused') return { status: 'paused', agentId: doc.agentId ?? '', report: null, chunksStudied: doc.progress.chunksStudied, chunksTotal: doc.progress.chunksTotal, findings: 0 };
      progress('chunking', doc.agentId ?? '', 0);
      doc = await chunkDocument(sourceId);
    }
    if (doc.status === 'failed') throw new Error(doc.error ?? 'This document could not be prepared.');

    // Which expert owns it: the one asked for, the one already assigned, or the one its own opening text routes to.
    if (opts.agentId) await assignDocument(sourceId, opts.agentId, (await getProfile(opts.agentId))?.topicId ?? opts.agentId);
    else if (!doc.agentId) {
      const sample = (await readChunks(doc.hash, 0, 3)).map((c) => c.text).join(' ').slice(0, 3000);
      const route = (await routeSubject(`${doc.title ?? ''} ${sample}`))!;
      await assignDocument(sourceId, route.agentId, route.topicId);
    }
    doc = (await getDocument(sourceId))!;
    const agentId = doc.agentId!; const topicId = doc.topicId ?? agentId;
    const profile = await getProfile(agentId);
    const agentName = profile?.name ?? 'expert';

    const cp = await readJson<Checkpoint>(P.checkpoint(`study-${doc.hash}`), { sourceId, next: 0, findings: 0, updatedAt: '' });
    let next = Math.min(cp.next, doc.progress.chunksTotal);
    let filed = cp.findings;
    await setDocumentStatus(sourceId, 'studying');
    const handle = await startCycle({ agentId, topicId, topic: doc.title ?? doc.name, model: currentModelName() });
    const batch = opts.batchChunks ?? BATCH_CHUNKS;
    const startedAt = next;
    let stopped = false;
    try {
      while (next < doc.progress.chunksTotal) {
        if (opts.shouldStop?.()) { stopped = true; break; }
        const chunks = await readChunks(doc.hash, next, batch);
        if (!chunks.length) break;
        for (const chunk of chunks) {
          const raws = await findingsForChunk(chunk, agentName, ask, handle);
          for (const raw of raws) if (await fileFinding(handle, chunk, raw, doc.title ?? doc.name)) filed++;
          handle.report.attempted.chunksExamined += 1;
        }
        next += chunks.length;
        handle.report.attempted.documentsProcessed = 1;
        await checkpointCycle(handle);
        await writeJson(P.checkpoint(`study-${doc.hash}`), { sourceId, next, findings: filed, updatedAt: new Date().toISOString() } satisfies Checkpoint);
        await markStudied(sourceId, next);
        await heartbeat();
        progress('studying', agentId, filed, doc, next);
      }
    } catch (e: any) {
      if (String(e?.message) !== 'stopped') { noteError(handle, String(e?.message || e)); await finalizeCycle(handle, { status: 'failed', summary: `Stopped by an error: ${String(e?.message || e)}` }); await setDocumentStatus(sourceId, 'paused', String(e?.message || e)); throw e; }
      stopped = true;
    }

    progress('finishing', agentId, filed, doc, next);
    const done = !stopped && next >= doc.progress.chunksTotal;
    if (done) await managerPass(agentId);
    const mine = (await searchFindings({ agentId, limit: 200 })).filter((f) => f.cycleId === handle.cycleId);
    const report = await finalizeCycle(handle, {
      status: done ? 'completed' : 'interrupted',
      summary: summarise(doc.title ?? doc.name, mine.map((f) => f.finding), next - startedAt, doc.progress.chunksTotal, doc.pages, doc.unreadablePages, done),
      followUps: mine.filter((f) => f.confidence < 0.6).slice(0, 5).map((f) => f.question),
      knowledgeGaps: Array.from(new Set(mine.map((f) => f.uncertainty).filter(Boolean))).slice(0, 8),
    });
    await widenKeywords(agentId, `${doc.title ?? ''} ${mine.map((f) => f.finding).join(' ')}`);
    await setDocumentCount(agentId, (await listDocuments()).filter((d) => d.agentId === agentId && (d.status === 'done' || d.status === 'studying' || d.sourceId === sourceId)).length);
    await refreshStats(agentId);
    if (done) { await promoteIfReady(agentId); await markStudied(sourceId, next, 'done'); } else await setDocumentStatus(sourceId, 'paused');
    return { status: done ? 'completed' : 'paused', agentId, report, chunksStudied: next, chunksTotal: doc.progress.chunksTotal, findings: filed };
  });
}

/** What was learned, in plain words and from the findings themselves (no model call, so it cannot embellish them). */
export function summarise(title: string, findings: string[], chunksThisRun: number, chunksTotal: number, pages: number | undefined, unreadable: number[], done: boolean): string {
  const parts = [`${done ? 'Studied' : 'Studied part of'} "${title}": ${chunksThisRun} section${chunksThisRun === 1 ? '' : 's'} this run${pages ? ` of a ${pages}-page document (${chunksTotal} sections in all)` : ''}.`];
  parts.push(findings.length ? `Filed ${findings.length} new finding${findings.length === 1 ? '' : 's'}, for example: ${findings.slice(0, 3).map((f) => `"${f}"`).join(' ')}` : 'No new findings were filed.');
  if (unreadable.length) parts.push(`${unreadable.length} page${unreadable.length === 1 ? ' has' : 's have'} no readable text (scans?) and were not studied: pages ${unreadable.slice(0, 12).join(', ')}${unreadable.length > 12 ? ', ...' : ''}. No OCR is available on this device.`);
  return parts.join(' ');
}

export { terms };
