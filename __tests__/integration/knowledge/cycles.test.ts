/**
 * The knowledge store: cycles, findings, reviews, conflicts. Fakes only the device boundary (the file system).
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const ev = (hash: string, chunk: string, page = 1) => ({ sourceId: `src-${hash.slice(0, 4)}`, sourceHash: hash, chunkId: chunk, page, quote: 'q' });

function load() {
  installNativeBoundary({ fs: true });
  return {
    cycles: require('../../../src/knowledge/cycles'),
    schema: require('../../../src/knowledge/schema'),
  };
}

const base = { question: 'What drives profit?', finding: 'Realization rate drives law firm profit.', confidence: 0.7, basis: 'observed' as const };

// Each test gets its own disk: modules are loaded fresh so none keeps a handle to an earlier test's file system.
beforeEach(() => jest.resetModules());

describe('knowledge cycles', () => {
  it('keeps a single-source finding as provisional instead of discarding it, and reports attempted apart from retained', async () => {
    const { cycles } = load();
    const h = await cycles.startCycle({ agentId: 'law-pricing', topicId: 'law-pricing', topic: 'Law firm pricing', model: 'test' });
    const r = await cycles.addFinding(h, { ...base, evidence: [ev(HASH_A, 'c1')] });
    expect(r.duplicate).toBe(false);
    const f = await cycles.getFinding(r.recordId);
    expect(f.status).toBe('provisional');
    expect(f.review).toEqual({ judge: 'pending', manager: 'pending' });
    const report = await cycles.finalizeCycle(h, { status: 'completed', summary: 'Learned one thing.' });
    expect(report.attempted.findingsGenerated).toBe(1);
    expect(report.retained).toMatchObject({ provisional: 1, accepted: 0, rejected: 0 });
    expect(report.finalized).toBe(true);
    expect(await cycles.readReport(h.dir)).toMatchObject({ status: 'completed', summary: 'Learned one thing.' });
  });

  it('makes a finished cycle immutable: no new findings, no second finalize', async () => {
    const { cycles } = load();
    const h = await cycles.startCycle({ agentId: 'a', topicId: 't', topic: 'T', model: 'm' });
    await cycles.finalizeCycle(h, { status: 'completed', summary: 's' });
    await expect(cycles.addFinding(h, { ...base, evidence: [ev(HASH_A, 'c1')] })).rejects.toThrow(/finished/);
    await expect(cycles.checkpointCycle(h)).rejects.toThrow(/finished/);
  });

  it('does not store the same finding twice, and lets a second source corroborate it', async () => {
    const { cycles } = load();
    const first = await cycles.startCycle({ agentId: 'a', topicId: 't', topic: 'T', model: 'm' });
    const one = await cycles.addFinding(first, { ...base, evidence: [ev(HASH_A, 'c1')] });
    await cycles.finalizeCycle(first, { status: 'completed', summary: 's' });
    const second = await cycles.startCycle({ agentId: 'a', topicId: 't', topic: 'T', model: 'm' });
    const same = await cycles.addFinding(second, { ...base, finding: '  Realization rate drives LAW firm profit. ', evidence: [ev(HASH_A, 'c1')] });
    expect(same).toMatchObject({ recordId: one.recordId, duplicate: true });
    const corroborated = await cycles.addFinding(second, { ...base, evidence: [ev(HASH_B, 'c9')] });
    expect(corroborated).toMatchObject({ recordId: one.recordId, duplicate: true, corroborated: true });
    expect((await cycles.getFinding(one.recordId)).evidence).toHaveLength(2);
    expect(await cycles.searchFindings({ agentId: 'a' })).toHaveLength(1);
    const report = await cycles.finalizeCycle(second, { status: 'completed', summary: 's' });
    expect(report.retained.duplicatesSkipped).toBe(2);
  });

  it('approves only with BOTH reviewers, keeps approved and provisional apart, and voids an approval when the evidence changes', async () => {
    const { cycles, schema } = load();
    const h = await cycles.startCycle({ agentId: 'a', topicId: 't', topic: 'T', model: 'm' });
    const kept = await cycles.addFinding(h, { ...base, evidence: [ev(HASH_A, 'c1')] });
    await cycles.addFinding(h, { ...base, finding: 'Utilization is billable hours over available hours.', evidence: [ev(HASH_A, 'c2')] });

    let f = await cycles.addReview({ recordId: kept.recordId, role: 'judge', decision: 'approved', reason: 'quote matches', by: 'evidence-check' });
    expect(f.status).toBe('provisional'); // one approval is not enough
    f = await cycles.addReview({ recordId: kept.recordId, role: 'manager', decision: 'approved', reason: 'keep', by: 'atlas' });
    expect(f.status).toBe('approved');
    expect(schema.validateFinding(f)).toEqual([]);
    expect((await cycles.searchFindings({ status: 'approved' })).map((x: any) => x.recordId)).toEqual([kept.recordId]);
    expect(await cycles.searchFindings({ status: 'provisional' })).toHaveLength(1);

    // New evidence changes what was approved: the approval is stale.
    f = await cycles.addEvidence(kept.recordId, [ev(HASH_B, 'c7')], 'another source');
    expect(f.status).toBe('provisional');
    expect(f.review).toEqual({ judge: 'pending', manager: 'pending' });

    // A record that claims approval without both approvals does not validate (a number alone is never authority).
    expect(schema.validateFinding({ ...f, status: 'approved', confidence: 1 })).toEqual(expect.arrayContaining([expect.stringMatching(/both the judge and the manager/)]));
    expect(schema.validateFinding({ ...f, status: 'approved', evidence: [], review: { judge: 'approved', manager: 'approved' } })).toEqual(expect.arrayContaining([expect.stringMatching(/needs evidence/)]));
  });

  it('keeps two contradictory findings side by side for conflict review', async () => {
    const { cycles } = load();
    const h = await cycles.startCycle({ agentId: 'a', topicId: 't', topic: 'T', model: 'm' });
    const a = await cycles.addFinding(h, { ...base, finding: 'The standard realization rate is 90 percent.', evidence: [ev(HASH_A, 'c1')] });
    const b = await cycles.addFinding(h, { ...base, finding: 'The standard realization rate is 75 percent.', evidence: [ev(HASH_B, 'c2')] });
    await cycles.markConflict(a.recordId, b.recordId, 'different numbers for the same measure');
    const conflicted = await cycles.searchFindings({ status: 'conflicted' });
    expect(conflicted.map((f: any) => f.recordId).sort()).toEqual([a.recordId, b.recordId].sort());
    expect(conflicted.every((f: any) => f.finding.includes('percent'))).toBe(true); // neither was overwritten
  });

  it('marks a replaced finding superseded without deleting it', async () => {
    const { cycles } = load();
    const h = await cycles.startCycle({ agentId: 'a', topicId: 't', topic: 'T', model: 'm' });
    const old = await cycles.addFinding(h, { ...base, finding: 'Old rule applies.', evidence: [ev(HASH_A, 'c1')] });
    const next = await cycles.addFinding(h, { ...base, finding: 'New rule applies from 2026.', evidence: [ev(HASH_B, 'c2')] });
    await cycles.supersede(old.recordId, next.recordId, 'rule changed');
    expect((await cycles.getFinding(old.recordId)).status).toBe('superseded');
    expect((await cycles.getFinding(old.recordId)).finding).toBe('Old rule applies.');
  });

  it('finds knowledge again after the app restarts, and closes a cycle that was cut off', async () => {
    const { cycles } = load();
    const h = await cycles.startCycle({ agentId: 'a', topicId: 't', topic: 'T', model: 'm' });
    const kept = await cycles.addFinding(h, { ...base, evidence: [ev(HASH_A, 'c1')] });
    // The app is killed here: the cycle was never finalized. A fresh start loads the modules again over the same disk.
    jest.resetModules();
    const again = require('../../../src/knowledge/cycles');
    expect((await again.getFinding(kept.recordId)).finding).toBe(base.finding);
    expect(await again.closeInterruptedCycles()).toBe(1);
    const report = await again.readReport(h.dir);
    expect(report).toMatchObject({ status: 'interrupted', finalized: true });
    expect(report.attempted.findingsGenerated).toBe(0); // the counters were not checkpointed; the finding itself survived
    expect((await again.searchFindings({ text: 'realization profit' })).map((f: any) => f.recordId)).toEqual([kept.recordId]);
  });
});
