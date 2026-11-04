/**
 * A long learning history must not slow startup or pull the history into memory: thousands of cycles are on disk, and startup and
 * lookups touch only what they need. Fakes only the file system.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

beforeEach(() => jest.resetModules());

const HASH = '9'.repeat(64);

it('keeps startup and lookups independent of how many cycles there are', async () => {
  installNativeBoundary({ fs: true });
  const RNFS = require('react-native-fs');
  const cycles = require('../../../src/knowledge/cycles');
  const agents = require('../../../src/knowledge/agents');
  const route = await agents.routeSubject('accounting and bookkeeping');

  // 300 finished cycles of 5 findings each, and one cycle that was running when the app was killed.
  for (let c = 0; c < 300; c++) {
    const h = await cycles.startCycle({ agentId: route.agentId, topicId: route.topicId, topic: 'Accounting', model: 'm' });
    for (let f = 0; f < 5; f++) {
      await cycles.addFinding(h, {
        question: `Question ${c}-${f}?`, finding: `Accounting fact number ${c * 5 + f} concerns ${f === 0 ? 'amortization schedules' : 'ledger entries'} in period ${c}.`,
        confidence: 0.7, evidence: [{ sourceId: 'src-9999', sourceHash: HASH, chunkId: `ch-${c}-${f}`, page: (c % 400) + 1, quote: 'a verbatim quote from the page' }],
      });
    }
    await cycles.finalizeCycle(h, { status: 'completed', summary: `cycle ${c}` });
  }
  const dangling = await cycles.startCycle({ agentId: route.agentId, topicId: route.topicId, topic: 'Accounting', model: 'm' });
  expect((await cycles.listCycles()).length).toBe(301);

  // "Restart": modules load again over the same disk. Count what startup and a search read.
  jest.resetModules();
  const reads: string[] = [];
  const read = RNFS.readFile as jest.Mock; const exists = RNFS.exists as jest.Mock;
  const origRead = read.getMockImplementation()!; const origExists = exists.getMockImplementation()!;
  read.mockImplementation(async (p: string, ...rest: unknown[]) => { reads.push(p); return origRead(p, ...rest); });
  let existsCalls = 0;
  exists.mockImplementation(async (p: string) => { existsCalls++; return origExists(p); });
  const again = require('../../../src/knowledge/cycles');

  existsCalls = 0; reads.length = 0;
  expect(await again.closeInterruptedCycles()).toBe(1); // only the cycle that was left open
  expect(existsCalls).toBeLessThan(40); // not one check per past cycle (there are 301)
  expect(reads.filter((p) => p.endsWith('findings.jsonl')).length).toBeLessThanOrEqual(1);
  expect((await again.readReport(dangling.dir)).status).toBe('interrupted');

  reads.length = 0;
  const hits = await again.searchFindings({ agentId: route.agentId, text: 'amortization schedules', limit: 10 });
  expect(hits).toHaveLength(10);
  // 1,500 findings are indexed; the search read the agent's keyword file and then only the cycles of the ten it returned.
  expect(new Set(reads.filter((p) => p.endsWith('findings.jsonl'))).size).toBeLessThanOrEqual(10);
  expect(reads.filter((p) => p.endsWith('findings.jsonl')).length).toBeLessThanOrEqual(10);
  expect(reads.filter((p) => /\/cycles\/.*report\.json$/.test(p))).toHaveLength(0);

  // The largest file ever read is a small fraction of the history.
  const stat = async (p: string) => Number((await RNFS.stat(p)).size);
  let total = 0;
  for (const c of await again.listCycles()) total += await stat(`${require('../../../src/knowledge/storage').knowledgeRoot()}/cycles/${c.dir}/findings.jsonl`).catch(() => 0);
  expect(total).toBeGreaterThan(300_000);
  const biggest = Math.max(...await Promise.all(reads.filter((p) => p.endsWith('.jsonl') || p.endsWith('.json')).map((p) => stat(p).catch(() => 0))));
  expect(biggest).toBeLessThan(total / 4);
}, 120000);
