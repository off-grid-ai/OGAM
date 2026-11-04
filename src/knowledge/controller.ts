/**
 * What the screens call. It owns the one running study job, its stop flag and its progress, so the View holds no job state of its
 * own: it shows `useKnowledgeStatus` and dispatches intents here. Everything real is in the services (documents, study, cycles,
 * exchange); this only coordinates them.
 */
import { create } from 'zustand';
import { closeInterruptedCycles, addReview, getFinding, searchFindings, type Query } from './cycles';
import { importPdf, listDocuments, removeDocument, extractDocument, chunkDocument } from './documents';
import { studyDocument, type StudyProgress } from './study';
import { createExport, applyImport, previewImport, transferHistory, type ExportOptions, type ImportReport } from './exchange';
import { evaluateAgent, getProfile, listProfiles } from './agents';
import type { CycleReport } from './schema';

export interface KnowledgeStatus {
  running: string | null;
  progress: StudyProgress | null;
  lastReport: CycleReport | null;
  lastError: string | null;
  /** Bumped whenever stored knowledge changes, so open screens reload. */
  version: number;
}
export const useKnowledgeStatus = create<KnowledgeStatus>(() => ({ running: null, progress: null, lastReport: null, lastError: null, version: 0 }));
const patch = (p: Partial<KnowledgeStatus>) => useKnowledgeStatus.setState(p);
const bump = () => useKnowledgeStatus.setState((s) => ({ version: s.version + 1 }));

let stopRequested = false;

/** Call once at app start: closes any cycle a killed app left open. */
export async function recoverKnowledge(): Promise<number> {
  const closed = await closeInterruptedCycles();
  if (closed) bump();
  return closed;
}

export async function addPdfs(files: Array<{ uri: string; name: string }>, agentId?: string): Promise<{ added: number; duplicates: number; failed: string[] }> {
  const out = { added: 0, duplicates: 0, failed: [] as string[] };
  for (const f of files) {
    try {
      const r = await importPdf({ uri: f.uri, name: f.name, agentId });
      if (r.duplicate) out.duplicates++; else out.added++;
    } catch (e: any) { out.failed.push(`${f.name}: ${String(e?.message || e)}`); }
  }
  bump();
  return out;
}

/** Starts (or resumes) studying a document. One job at a time; a second request is refused with a clear message. */
export async function startStudy(sourceId: string, agentId?: string): Promise<void> {
  if (useKnowledgeStatus.getState().running) throw new Error('Another document is being studied. Pause it first.');
  stopRequested = false;
  patch({ running: sourceId, lastError: null, progress: null });
  try {
    const out = await studyDocument(sourceId, { agentId, shouldStop: () => stopRequested, onProgress: (p) => { patch({ progress: p }); } });
    patch({ lastReport: out.report });
  } catch (e: any) {
    patch({ lastError: String(e?.message || e) });
  } finally {
    patch({ running: null });
    bump();
  }
}

export const pauseStudy = (): void => { stopRequested = true; };

export async function deleteDocument(sourceId: string): Promise<number> {
  const { erasedFindings } = await removeDocument(sourceId);
  bump();
  return erasedFindings;
}

/** A person's own decision on a finding: it counts as both reviews, recorded as theirs. */
export async function decide(recordId: string, decision: 'approved' | 'rejected', reason = 'Decided by you.'): Promise<void> {
  await addReview({ recordId, role: 'judge', decision, reason, by: 'person' });
  await addReview({ recordId, role: 'manager', decision, reason, by: 'person' });
  bump();
}

export async function exportKnowledge(opts: ExportOptions) { const r = await createExport(opts); bump(); return r; }
export async function previewPackage(path: string): Promise<ImportReport> { return previewImport(path); }
export async function importPackage(path: string): Promise<ImportReport> { const r = await applyImport(path); bump(); return r; }

export async function snapshotFor(query: Query) { return searchFindings(query); }
export { listProfiles, listDocuments, transferHistory, evaluateAgent, getProfile, getFinding, extractDocument, chunkDocument };
