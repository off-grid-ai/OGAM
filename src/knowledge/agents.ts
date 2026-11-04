/**
 * Specialised expert agents.
 *
 * Learning produces a persistent expert per SUBJECT, not one generic learner. A subject gets a stable topic id; when learning on a
 * subject starts it is routed to the existing agent that covers it, or else a provisional workspace is opened for it. A workspace
 * is promoted to a persistent expert once it has enough findings of enough quality (configurable). An expert is an ordinary Atlas
 * agent (a persona on whatever model is loaded) plus a knowledge profile: no extra model, no background process, and nothing about
 * model weights changes. What makes it expert is the retrievable, cited knowledge filed under it.
 *
 * Overlapping specialisations are merged, over-broad ones split; neither deletes a finding.
 */
import { SCHEMA_VERSION, validateAgentProfile, type AgentProfile, type Finding } from './schema';
import {
  P, appendJsonl, hashIndex, nowIso, readJson, readJsonl, stateIndex, terms, withLock, writeJson, type RecordState,
} from './storage';
import { searchFindings } from './cycles';

export interface PromotionCriteria { minFindings: number; minDocuments: number; minAverageConfidence: number; minReviewed: number }
export const DEFAULT_PROMOTION: PromotionCriteria = { minFindings: 5, minDocuments: 1, minAverageConfidence: 0.5, minReviewed: 1 };

/** Well-known subjects: stable ids and the words that identify them. Anything else gets an id made from its own words. */
const KNOWN_SUBJECTS: Array<{ topicId: string; name: string; words: string[] }> = [
  { topicId: 'law-firm-pricing', name: 'Law Firm Pricing Expert', words: ['law', 'legal', 'firm', 'pricing', 'billable', 'realization', 'utilization', 'profitability', 'attorney', 'fees'] },
  { topicId: 'accounting', name: 'Accounting Expert', words: ['accounting', 'bookkeeping', 'ledger', 'balance', 'sheet', 'statements', 'depreciation', 'accrual', 'journal', 'audit', 'costing'] },
  { topicId: 'tax', name: 'Tax Expert', words: ['tax', 'taxes', 'deduction', 'irs', 'jurisdiction', 'withholding', 'filing', 'taxable'] },
  { topicId: 'programming', name: 'Programming Expert', words: ['programming', 'software', 'code', 'debugging', 'algorithm', 'compiler', 'function', 'architecture', 'refactoring'] },
  { topicId: 'research', name: 'Research Expert', words: ['research', 'methodology', 'citation', 'evidence', 'literature', 'hypothesis', 'sampling', 'peer'] },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'general';

/** A stable id for a subject: the same words always give the same id. */
export function topicIdFor(text: string): { topicId: string; name: string; score: number } {
  const t = terms(text, 40);
  let best = { topicId: '', name: '', score: 0 };
  for (const k of KNOWN_SUBJECTS) {
    const score = k.words.filter((w) => t.some((x) => x === w || x.startsWith(w) || w.startsWith(x))).length;
    if (score > best.score) best = { topicId: k.topicId, name: k.name, score };
  }
  if (best.score >= 1) return best;
  const own = t.slice(0, 3);
  const id = slug(own.length ? own.sort().join('-') : text);
  return { topicId: id, name: `${own.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'General'} Expert`, score: 0 };
}

// ------------------------------------------------------------------ registry
const listIds = async (): Promise<string[]> => (await readJson<{ ids: string[] }>(P.agentsList(), { ids: [] })).ids;

export async function getProfile(agentId: string): Promise<AgentProfile | null> {
  const p = await readJson<AgentProfile | null>(P.agentProfile(agentId), null);
  return p && !validateAgentProfile(p).length ? p : null;
}
export async function saveProfile(profile: AgentProfile): Promise<void> {
  const problems = validateAgentProfile(profile);
  if (problems.length) throw new Error(`Invalid agent: ${problems.join('; ')}`);
  await withLock('agents-registry', async () => {
    await writeJson(P.agentProfile(profile.agentId), { ...profile, updatedAt: nowIso() });
    const ids = await listIds();
    if (!ids.includes(profile.agentId)) await writeJson(P.agentsList(), { ids: [...ids, profile.agentId] });
  });
}

export async function listProfiles(opts: { includeMerged?: boolean } = {}): Promise<AgentProfile[]> {
  const out: AgentProfile[] = [];
  for (const id of await listIds()) {
    const p = await getProfile(id);
    if (p && (opts.includeMerged || !p.mergedInto)) out.push(p);
  }
  return out;
}

/** Follows merges to the agent that now owns the knowledge. */
export async function resolveAgent(agentId: string): Promise<string> {
  let id = agentId;
  for (let i = 0; i < 8; i++) { const p = await getProfile(id); if (!p?.mergedInto) return id; id = p.mergedInto; }
  return id;
}

function newProfile(topicId: string, name: string, keywords: string[], scope: string): AgentProfile {
  const now = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION, agentId: `${topicId}-expert`, topicId, name, specialization: name.replace(/ Expert$/, ''), scope,
    keywords: keywords.slice(0, 40), stage: 'provisional', createdAt: now, updatedAt: now,
    instructions: `You are ${name}. Answer from the knowledge filed under you and cite it (document and page). Say what is only provisional. If your knowledge does not cover a question, say so instead of guessing.`,
    stats: { cycles: 0, findings: 0, approved: 0, provisional: 0, conflicted: 0, documents: 0 },
  };
}

// ------------------------------------------------------------------ routing
export interface Route { agentId: string; topicId: string; created: boolean; score: number }

function overlap(a: string[], b: string[]): number {
  return a.filter((w) => b.some((x) => x === w || (w.length > 4 && x.startsWith(w)) || (x.length > 4 && w.startsWith(x)))).length;
}

/**
 * Finds the agent that should own learning on this subject: an existing one that covers it (never a new agent for a minor variation),
 * else the provisional workspace for the subject's stable topic id, opening one if it does not exist.
 */
export async function routeSubject(text: string, opts: { createIfMissing?: boolean } = {}): Promise<Route | null> {
  const subject = topicIdFor(text);
  const wanted = terms(text, 24);
  let best: { p: AgentProfile; score: number } | null = null;
  for (const p of await listProfiles()) {
    const sameTopic = p.topicId === subject.topicId;
    const score = (sameTopic ? 100 : 0) + overlap(wanted, p.keywords);
    if (score > (best?.score ?? 0)) best = { p, score };
  }
  // A real overlap (several shared words, or the same subject) routes to the existing agent; one stray shared word does not.
  if (best && best.score >= 3) return { agentId: best.p.agentId, topicId: best.p.topicId, created: false, score: best.score };
  if (opts.createIfMissing === false) return null;
  const profile = newProfile(subject.topicId, subject.name, wanted, text.slice(0, 200));
  await saveProfile(profile);
  return { agentId: profile.agentId, topicId: profile.topicId, created: true, score: 0 };
}

/** Teaches an agent the words of new material so later questions about it route correctly. */
export async function widenKeywords(agentId: string, text: string): Promise<void> {
  const p = await getProfile(agentId);
  if (!p) return;
  const merged = Array.from(new Set([...p.keywords, ...terms(text, 12)])).slice(0, 60);
  if (merged.length !== p.keywords.length) await saveProfile({ ...p, keywords: merged });
}

// ------------------------------------------------------------------ stats, promotion, evaluation
async function statesOf(agentId: string): Promise<RecordState[]> {
  const out: RecordState[] = [];
  for (const e of await readJsonl<{ recordId: string }>(P.agentKeywords(agentId))) {
    const s = await stateIndex.get(e.recordId);
    if (s && s.agentId === agentId) out.push(s);
  }
  return out;
}

export async function refreshStats(agentId: string): Promise<AgentProfile | null> {
  const p = await getProfile(agentId);
  if (!p) return null;
  const states = await statesOf(agentId);
  const cycles = new Set(states.map((s) => s.cycleId));
  const stats = {
    cycles: cycles.size, findings: states.length, approved: states.filter((s) => s.status === 'approved').length,
    provisional: states.filter((s) => s.status === 'provisional' || s.status === 'needs-review').length,
    conflicted: states.filter((s) => s.status === 'conflicted').length, documents: p.stats.documents,
  };
  const next = { ...p, stats };
  await saveProfile(next);
  return next;
}

export async function setDocumentCount(agentId: string, documents: number): Promise<void> {
  const p = await getProfile(agentId);
  if (p) await saveProfile({ ...p, stats: { ...p.stats, documents } });
}

/** Promotes a workspace to a persistent expert once it has the evidence and quality asked for. Returns true if it became one. */
export async function promoteIfReady(agentId: string, criteria: PromotionCriteria = DEFAULT_PROMOTION): Promise<boolean> {
  const p = await refreshStats(agentId);
  if (!p || p.stage === 'expert') return false;
  const states = (await statesOf(agentId)).filter((s) => s.status !== 'rejected' && s.status !== 'superseded');
  const avg = states.length ? states.reduce((n, s) => n + s.confidence, 0) / states.length : 0;
  const reviewed = states.filter((s) => s.status === 'approved' || s.status === 'needs-review' || s.status === 'conflicted').length;
  const ready = states.length >= criteria.minFindings && p.stats.documents >= criteria.minDocuments && avg >= criteria.minAverageConfidence && reviewed >= criteria.minReviewed;
  if (!ready) return false;
  await saveProfile({ ...p, stage: 'expert', promotedAt: nowIso() });
  await ensureAtlasAgent(agentId);
  return true;
}

/** The ordinary Atlas agent (persona) that speaks as this expert. Created once, reused after. */
export async function ensureAtlasAgent(agentId: string): Promise<string | null> {
  const p = await getProfile(agentId);
  if (!p || p.stage !== 'expert') return null;
  const { useAgentStore } = require('../stores/agentStore');
  const store = useAgentStore.getState();
  if (p.atlasAgentId && store.getAgent(p.atlasAgentId)) return p.atlasAgentId;
  const created = store.createAgent({ name: p.name, description: `Expert in ${p.specialization}. Answers from cited knowledge it has studied.`, systemPrompt: p.instructions });
  await saveProfile({ ...p, atlasAgentId: created.id });
  return created.id;
}

export interface Evaluation { questions: number; answered: number; cited: number; score: number }
/**
 * A measured check of the agent's own knowledge, with no model involved: for a sample of its findings, ask each one's own question
 * and see whether retrieval brings that finding back with a citation. It measures whether the knowledge can be FOUND and CITED,
 * which is what the agent depends on; it does not claim the agent is "smart".
 */
export async function evaluateAgent(agentId: string, sample = 10): Promise<Evaluation | null> {
  const p = await getProfile(agentId);
  if (!p) return null;
  const known = await searchFindings({ agentId, limit: sample });
  let answered = 0; let cited = 0;
  for (const f of known) {
    const hits = await searchFindings({ agentId, text: f.question, limit: 3 });
    if (hits.some((h) => h.recordId === f.recordId)) answered++;
    if (hits.some((h) => h.recordId === f.recordId && h.evidence.length > 0 && h.evidence.every((e) => e.page != null || e.locator))) cited++;
  }
  const ev = { questions: known.length, answered, cited, score: known.length ? Number((answered / known.length).toFixed(2)) : 0 };
  await saveProfile({ ...p, evaluation: { at: nowIso(), ...ev } });
  return ev;
}

// ------------------------------------------------------------------ merge and split
async function moveFinding(recordId: string, from: string, to: string): Promise<void> {
  const s = await stateIndex.get(recordId);
  if (!s || s.agentId !== from) return;
  await stateIndex.put({ ...s, agentId: to, updatedAt: nowIso() });
  await hashIndex.remove(from, s.contentHash);
  await hashIndex.put(to, s.contentHash, recordId);
}

/** Folds one specialisation into another. Every finding keeps its identity; the old agent points at the new one. */
export async function mergeAgents(fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return;
  const from = await getProfile(fromId); const into = await getProfile(intoId);
  if (!from || !into) throw new Error('No such agent.');
  const entries = await readJsonl<{ recordId: string; cycleDir: string; terms: string[] }>(P.agentKeywords(fromId));
  for (const e of entries) await moveFinding(e.recordId, fromId, intoId);
  await appendJsonl(P.agentKeywords(intoId), entries);
  await saveProfile({ ...into, keywords: Array.from(new Set([...into.keywords, ...from.keywords])).slice(0, 60) });
  await saveProfile({ ...from, mergedInto: intoId });
  await refreshStats(intoId);
}

/** Splits a too-broad agent: findings that mention any of `keywords` move to a new workspace. */
export async function splitAgent(agentId: string, name: string, keywords: string[]): Promise<AgentProfile> {
  const parent = await getProfile(agentId);
  if (!parent) throw new Error('No such agent.');
  const subject = topicIdFor(`${name} ${keywords.join(' ')}`);
  const child = newProfile(subject.topicId === parent.topicId ? slug(name) : subject.topicId, name.endsWith('Expert') ? name : `${name} Expert`, keywords, `Part of ${parent.name}`);
  await saveProfile(child);
  const entries = await readJsonl<{ recordId: string; cycleDir: string; terms: string[] }>(P.agentKeywords(agentId));
  const moving = entries.filter((e) => overlap(keywords.map((k) => k.toLowerCase()), e.terms) > 0);
  for (const e of moving) await moveFinding(e.recordId, agentId, child.agentId);
  await appendJsonl(P.agentKeywords(child.agentId), moving);
  await refreshStats(agentId); await refreshStats(child.agentId);
  return (await getProfile(child.agentId))!;
}

// ------------------------------------------------------------------ answering
/** Findings an expert would use to answer, expert's own first, each labelled with how far to trust it and where it came from. */
export async function expertContext(agentId: string, question: string, limit = 5): Promise<{ text: string; findings: Finding[] }> {
  const findings = await searchFindings({ agentId, text: question, limit: limit * 2, status: ['approved', 'provisional', 'needs-review', 'conflicted'] });
  const order: Record<string, number> = { approved: 0, provisional: 1, 'needs-review': 2, conflicted: 3 };
  const top = findings.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)).slice(0, limit);
  const lines = top.map((f, i) => {
    const cite = f.evidence.map((e) => `${f.documentTitle ?? e.sourceId}${e.page ? `, page ${e.page}` : ''}`).join('; ') || 'no citation';
    const label = f.status === 'approved' ? 'reviewed' : f.status === 'conflicted' ? 'CONFLICTS with other findings' : 'provisional, not yet reviewed';
    return `[${i + 1}] (${label}) ${f.finding} (source: ${cite})`;
  });
  return { text: lines.join('\n'), findings: top };
}
