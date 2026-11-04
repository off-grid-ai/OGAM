/**
 * Specialised expert agents: routing, promotion, merge and measured expertise. Fakes only the file system.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

const H1 = 'c'.repeat(64);
const H2 = 'd'.repeat(64);
const ev = (hash: string, chunk: string, page: number) => ({ sourceId: `src-${hash.slice(0, 4)}`, sourceHash: hash, chunkId: chunk, page, quote: 'x' });

function load() {
  installNativeBoundary({ fs: true });
  return { agents: require('../../../src/knowledge/agents'), cycles: require('../../../src/knowledge/cycles') };
}

async function learn(m: ReturnType<typeof load>, agentId: string, topicId: string, items: Array<[string, string]>, hash = H1) {
  const h = await m.cycles.startCycle({ agentId, topicId, topic: topicId, model: 'test' });
  let page = 1;
  for (const [q, f] of items) await m.cycles.addFinding(h, { question: q, finding: f, confidence: 0.8, basis: 'observed', evidence: [ev(hash, `chunk-${page}`, page++)] });
  await m.cycles.finalizeCycle(h, { status: 'completed', summary: 'ok' });
}

describe('specialised agents', () => {
  it('routes two cycles on the same subject to the same agent, however the subject is worded', async () => {
    const m = load();
    const first = await m.agents.routeSubject('How do law firms price legal services?');
    expect(first).toMatchObject({ created: true, topicId: 'law-firm-pricing', agentId: 'law-firm-pricing-expert' });
    const second = await m.agents.routeSubject('Law firm profitability, billable hours and realization');
    expect(second).toMatchObject({ created: false, agentId: first.agentId });
    expect((await m.agents.listProfiles())).toHaveLength(1);
  });

  it('keeps two different subjects apart, each with only its own knowledge', async () => {
    const m = load();
    const law = await m.agents.routeSubject('law firm pricing and billable hours');
    const acct = await m.agents.routeSubject('accounting: balance sheet and depreciation');
    expect(law.agentId).not.toBe(acct.agentId);
    await learn(m, law.agentId, law.topicId, [['What is realization?', 'Realization is the share of billed time actually collected.']]);
    await learn(m, acct.agentId, acct.topicId, [['What is depreciation?', 'Depreciation spreads an asset cost over its useful life.']], H2);
    const lawFindings = await m.cycles.searchFindings({ agentId: law.agentId });
    const acctFindings = await m.cycles.searchFindings({ agentId: acct.agentId });
    expect(lawFindings.map((f: any) => f.finding)).toEqual(['Realization is the share of billed time actually collected.']);
    expect(acctFindings.map((f: any) => f.finding)).toEqual(['Depreciation spreads an asset cost over its useful life.']);
    expect(await m.cycles.searchFindings({ agentId: law.agentId, text: 'depreciation asset' })).toEqual([]);
  });

  it('opens a provisional workspace, and promotes it to a persistent Atlas expert only when the evidence and quality are there', async () => {
    const m = load();
    const r = await m.agents.routeSubject('tax deductions and filing rules');
    expect((await m.agents.getProfile(r.agentId)).stage).toBe('provisional');
    await learn(m, r.agentId, r.topicId, [['q1', 'Deductions reduce taxable income.'], ['q2', 'Filing deadlines vary by jurisdiction.']]);
    expect(await m.agents.promoteIfReady(r.agentId)).toBe(false); // too little so far
    await learn(m, r.agentId, r.topicId, [['q3', 'Withholding is collected during the year.'], ['q4', 'Credits reduce tax owed directly.'], ['q5', 'Effective dates decide which rule applies.']]);
    await m.agents.setDocumentCount(r.agentId, 1);
    expect(await m.agents.promoteIfReady(r.agentId)).toBe(false); // nothing has been reviewed yet
    const [first] = await m.cycles.searchFindings({ agentId: r.agentId, limit: 1 });
    await m.cycles.addReview({ recordId: first.recordId, role: 'judge', decision: 'needs-review', reason: 'check the jurisdiction', by: 'test' });
    expect(await m.agents.promoteIfReady(r.agentId)).toBe(true);
    const profile = await m.agents.getProfile(r.agentId);
    expect(profile).toMatchObject({ stage: 'expert' });
    const { useAgentStore } = require('../../../src/stores/agentStore');
    expect(useAgentStore.getState().getAgent(profile.atlasAgentId)).toMatchObject({ name: 'Tax Expert' });
    // Promoting again reuses the same persona.
    await m.agents.ensureAtlasAgent(r.agentId);
    expect((await m.agents.getProfile(r.agentId)).atlasAgentId).toBe(profile.atlasAgentId);
  });

  it('merges overlapping specialisations without losing a finding, and splits a broad one', async () => {
    const m = load();
    const a = await m.agents.routeSubject('accounting and bookkeeping');
    await learn(m, a.agentId, a.topicId, [['q1', 'A ledger records every transaction.'], ['q2', 'Cost accounting tracks the cost of producing goods.']]);
    const other = await m.agents.splitAgent(a.agentId, 'Cost Accounting', ['cost', 'producing']);
    expect((await m.cycles.searchFindings({ agentId: other.agentId })).map((f: any) => f.finding)).toEqual(['Cost accounting tracks the cost of producing goods.']);
    expect((await m.cycles.searchFindings({ agentId: a.agentId })).map((f: any) => f.finding)).toEqual(['A ledger records every transaction.']);
    await m.agents.mergeAgents(other.agentId, a.agentId);
    expect((await m.cycles.searchFindings({ agentId: a.agentId })).length).toBe(2);
    expect(await m.agents.resolveAgent(other.agentId)).toBe(a.agentId);
    expect((await m.agents.listProfiles()).map((p: any) => p.agentId)).toEqual([a.agentId]); // the merged one is hidden, not deleted
  });

  it('measures what an expert can find and cite instead of asserting it, and answers with provisional knowledge labelled as such', async () => {
    const m = load();
    const r = await m.agents.routeSubject('accounting principles and financial statements');
    await learn(m, r.agentId, r.topicId, [
      ['What does a balance sheet show?', 'A balance sheet shows assets, liabilities and equity at one date.'],
      ['What does an income statement show?', 'An income statement shows revenue and expenses over a period.'],
    ]);
    const ev1 = await m.agents.evaluateAgent(r.agentId);
    expect(ev1).toMatchObject({ questions: 2, answered: 2, cited: 2, score: 1 });
    expect((await m.agents.getProfile(r.agentId)).evaluation).toMatchObject({ score: 1 });
    const ctx = await m.agents.expertContext(r.agentId, 'what does the balance sheet show');
    expect(ctx.text).toMatch(/provisional, not yet reviewed/);
    expect(ctx.text).toMatch(/page 1/);
  });
});
