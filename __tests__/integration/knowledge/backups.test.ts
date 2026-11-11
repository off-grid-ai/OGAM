/**
 * Learning reports are kept safe: a daily automatic backup, restoring it on a wiped phone, and all reports in one readable file.
 * Each "device" is its own disk; only the device boundary (files, zip) is faked.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

beforeEach(() => jest.resetModules());

const ev = (n: number) => ({ sourceId: 'src-1111', sourceHash: '1'.repeat(64), chunkId: `ch-${n}`, page: n, quote: 'a verbatim quote from the page' });

function device() {
  const boundary = installNativeBoundary({ fs: true });
  return {
    boundary, RNFS: require('react-native-fs'),
    cycles: require('../../../src/knowledge/cycles'), agents: require('../../../src/knowledge/agents'),
    backups: require('../../../src/knowledge/backups'),
  };
}

async function learn(d: ReturnType<typeof device>) {
  const route = await d.agents.routeSubject('law firm pricing and billable hours');
  const h = await d.cycles.startCycle({ agentId: route.agentId, topicId: route.topicId, topic: 'Law firm pricing', model: 'm' });
  await d.cycles.addFinding(h, { question: 'What is realization?', finding: 'Realization is the share of billed time actually collected.', confidence: 0.8, evidence: [ev(3)] });
  await d.cycles.addFinding(h, { question: 'What is utilization?', finding: 'Utilization is billable hours over available hours.', confidence: 0.7, evidence: [ev(4)] });
  await d.cycles.finalizeCycle(h, { status: 'completed', summary: 'law' });
}

it('backs up once a day, keeps seven, and restores everything onto a wiped phone without doubling it', async () => {
  const a = device();
  expect(await a.backups.autoBackup({ now: '2026-11-05T10:00:00Z' })).toBeNull(); // nothing learned yet
  await learn(a);

  const first = await a.backups.autoBackup({ now: '2026-11-05T10:00:00Z' });
  expect(first).toMatchObject({ day: '2026-11-05' });
  expect(await a.backups.autoBackup({ now: '2026-11-05T20:00:00Z' })).toBeNull(); // already backed up today
  expect(await a.backups.autoBackup({ now: '2026-11-06T09:00:00Z' })).toMatchObject({ day: '2026-11-06' });
  for (let d = 7; d <= 15; d++) await a.backups.autoBackup({ now: `2026-11-${String(d).padStart(2, '0')}T09:00:00Z` });
  const kept = await a.backups.listBackups();
  expect(kept).toHaveLength(7);
  expect(kept[0].day).toBe('2026-11-15');

  // A backup does not count as "the last export you saved".
  const ex = require('../../../src/knowledge/exchange');
  expect(await ex.lastSuccessfulExport()).toBeNull();

  const zip = await a.RNFS.readFile(kept[0].path, 'base64');
  jest.resetModules();
  const b = device(); // a wiped phone
  expect(await b.cycles.searchFindings({ limit: 10 })).toHaveLength(0);
  await b.RNFS.writeFile('/restore/backup.zip', zip, 'base64');
  const r1 = await b.backups.restoreBackup('/restore/backup.zip');
  expect(r1.valid).toBe(true);
  expect(await b.cycles.searchFindings({ limit: 10 })).toHaveLength(2);
  const r2 = await b.backups.restoreBackup('/restore/backup.zip'); // restoring twice adds nothing
  expect(r2.imported.findings).toBe(0);
  expect(await b.cycles.searchFindings({ limit: 10 })).toHaveLength(2);
});

it('puts every cycle report in one readable file, newest first', async () => {
  const a = device();
  expect((await a.backups.allReportsMarkdown()).cycles).toBe(0);
  await learn(a);
  await learn(a);
  const { text, cycles } = await a.backups.allReportsMarkdown();
  expect(cycles).toBe(2);
  expect(text).toMatch(/^# Atlas learning reports/);
  expect(text.match(/# Learning cycle /g)).toHaveLength(2);
  expect(text).toMatch(/Findings generated/);
});

it('builds one backup when two are asked for at once', async () => {
  const a = device();
  await learn(a);
  const [x, y] = await Promise.all([a.backups.autoBackup({ now: '2026-11-05T10:00:00Z' }), a.backups.autoBackup({ now: '2026-11-05T10:00:01Z' })]);
  expect(x).toEqual(y);
  expect(await a.backups.listBackups()).toHaveLength(1);
});
