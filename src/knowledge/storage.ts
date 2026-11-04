/**
 * Where learning knowledge lives, and how it is written safely.
 *
 *   learning/
 *     device.json                    this install's stable random id
 *     agents/agents.json             list of agent ids; agents/<id>/profile.json each agent
 *     cycles/<yyyy-mm-dd>/cycle-NNN/ report.json, report.md, findings.jsonl, reviews.jsonl, final.json
 *     documents/index.json           small list of imported documents
 *       originals/<sha256>.pdf       the PDF as imported (optional to export)
 *       extracted/<sha256>/pages-NNNN.jsonl   page text, 20 pages a file
 *       chunks/<sha256>/part-NNNN.jsonl       chunks, 50 a file
 *     knowledge/index/               small sharded lookup files (below)
 *     knowledge/revisions/<yyyy-mm>.jsonl   corrections, added evidence, supersessions
 *     knowledge/tombstones.jsonl     deletions that must not come back
 *     checkpoints/                   resume points and the job lock
 *     exports/  imports/             packages made and received
 *
 * Why files plus a sharded index instead of one database: the JSONL files ARE the interchange format, so there is one copy of each
 * finding, not a database copy and an export copy; every write is a small atomic replace, so a killed app leaves nothing
 * half-written; and nothing is ever loaded whole. The index is what makes lookups cheap: 256 small files keyed by the first two
 * characters of an id or hash (a shard stays a few kilobytes for tens of thousands of records), and a per-agent keyword file.
 * The existing RAG database (SQLite) keeps doing document retrieval for chat; this layer is the durable, portable record.
 */
import RNFS from 'react-native-fs';
import { sha256 } from 'js-sha256';

let rootDir: string | null = null;
export const setKnowledgeRoot = (dir: string | null): void => { rootDir = dir; };
export const knowledgeRoot = (): string => rootDir ?? `${RNFS.DocumentDirectoryPath}/learning`;

export const P = {
  device: () => `${knowledgeRoot()}/device.json`,
  agentsList: () => `${knowledgeRoot()}/agents/agents.json`,
  agentProfile: (id: string) => `${knowledgeRoot()}/agents/${id}/profile.json`,
  agentDir: (id: string) => `${knowledgeRoot()}/agents/${id}`,
  cyclesDir: () => `${knowledgeRoot()}/cycles`,
  cyclesIndex: () => `${knowledgeRoot()}/knowledge/index/cycles.jsonl`,
  docsIndex: () => `${knowledgeRoot()}/documents/index.json`,
  original: (hash: string) => `${knowledgeRoot()}/documents/originals/${hash}.pdf`,
  extractedDir: (hash: string) => `${knowledgeRoot()}/documents/extracted/${hash}`,
  chunksDir: (hash: string) => `${knowledgeRoot()}/documents/chunks/${hash}`,
  stateShard: (id: string) => `${knowledgeRoot()}/knowledge/index/state-${shardOf(id)}.json`,
  hashShard: (hash: string) => `${knowledgeRoot()}/knowledge/index/hash-${shardOf(hash)}.json`,
  indexDir: () => `${knowledgeRoot()}/knowledge/index`,
  agentKeywords: (agentId: string) => `${knowledgeRoot()}/knowledge/index/agent-${agentId}.jsonl`,
  revisions: (month: string) => `${knowledgeRoot()}/knowledge/revisions/${month}.jsonl`,
  revisionsDir: () => `${knowledgeRoot()}/knowledge/revisions`,
  tombstones: () => `${knowledgeRoot()}/knowledge/tombstones.jsonl`,
  checkpoint: (name: string) => `${knowledgeRoot()}/checkpoints/${name}.json`,
  openCycles: () => `${knowledgeRoot()}/checkpoints/open-cycles.json`,
  lock: () => `${knowledgeRoot()}/checkpoints/job.lock`,
  exportsDir: () => `${knowledgeRoot()}/exports`,
  importsDir: () => `${knowledgeRoot()}/imports`,
  transfers: () => `${knowledgeRoot()}/exports/history.jsonl`,
};

/** Two characters of an id/hash pick the shard. Ids made here start with hex, so shards spread evenly. */
export const shardOf = (id: string): string => {
  const hex = (id.replace(/[^0-9a-f]/gi, '') + '00').slice(0, 2).toLowerCase();
  return hex;
};

export const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, (m) => m); // keeps milliseconds: still valid ISO 8601 UTC
export const sha256Text = (text: string): string => sha256(text);

/** A random UUID (version 4 layout). Uses the platform's secure source when present. */
export function uuid(): string {
  const bytes = new Uint8Array(16);
  const g: any = globalThis;
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ------------------------------------------------------------------ serialised access
const chains = new Map<string, Promise<unknown>>();
/** Runs `fn` after every earlier call with the same key finished, so read-modify-write on one file never interleaves. */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const tail = next.catch(() => undefined);
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return next;
}

// ------------------------------------------------------------------ files
export async function ensureDir(dir: string): Promise<void> { await RNFS.mkdir(dir); }
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'));

/**
 * Replaces a file all-or-nothing: the new text goes to a temporary file, the old file is set aside, the new one moved in, the old
 * one deleted. If the app dies in between, readText restores whichever complete copy exists.
 */
export async function atomicWriteText(path: string, text: string): Promise<void> {
  await ensureDir(dirOf(path));
  const tmp = `${path}.tmp-${uuid().slice(0, 8)}`;
  const bak = `${path}.bak`;
  await RNFS.writeFile(tmp, text, 'utf8');
  const had = await RNFS.exists(path);
  if (had) { if (await RNFS.exists(bak)) await RNFS.unlink(bak); await RNFS.moveFile(path, bak); }
  await RNFS.moveFile(tmp, path);
  if (had) await RNFS.unlink(bak).catch(() => undefined);
}

/** Reads a file written by atomicWriteText; null if absent. Finishes an interrupted replace if it finds one. */
export async function readText(path: string): Promise<string | null> {
  if (await RNFS.exists(path)) return RNFS.readFile(path, 'utf8');
  const bak = `${path}.bak`;
  if (await RNFS.exists(bak)) { await RNFS.moveFile(bak, path); return RNFS.readFile(path, 'utf8'); }
  return null;
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  const text = await readText(path);
  if (text == null) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}
export const writeJson = (path: string, value: unknown): Promise<void> => atomicWriteText(path, JSON.stringify(value));

/** Appends complete lines. A crash can leave one partial last line; readJsonl skips it. */
export async function appendJsonl(path: string, records: unknown[]): Promise<void> {
  if (!records.length) return;
  await ensureDir(dirOf(path));
  await RNFS.appendFile(path, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
}

export async function readJsonl<T>(path: string): Promise<T[]> {
  if (!(await RNFS.exists(path))) return [];
  const text = await RNFS.readFile(path, 'utf8');
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* a line cut off by a crash: ignore it */ }
  }
  return out;
}

export async function listDir(dir: string): Promise<string[]> {
  if (!(await RNFS.exists(dir))) return [];
  return (await RNFS.readDir(dir)).map((e) => e.name).sort();
}

export async function removeTree(path: string): Promise<void> {
  if (await RNFS.exists(path)) await RNFS.unlink(path);
}

// ------------------------------------------------------------------ identity
export async function deviceId(): Promise<string> {
  const existing = await readJson<{ deviceId?: string }>(P.device(), {});
  if (existing.deviceId) return existing.deviceId;
  return withLock('device', async () => {
    const again = await readJson<{ deviceId?: string }>(P.device(), {});
    if (again.deviceId) return again.deviceId;
    const id = uuid();
    await writeJson(P.device(), { deviceId: id, createdAt: nowIso() });
    return id;
  });
}

// ------------------------------------------------------------------ sharded index
export interface RecordState {
  recordId: string;
  agentId: string;
  topicId: string;
  cycleId: string;
  /** The cycle's folder under cycles/ (date/cycle-NNN), so the finding file is found without scanning. */
  cycleDir: string;
  status: string;
  confidence: number;
  contentHash: string;
  revision: number;
  basis: string;
  sources: number;
  supersededBy?: string;
  updatedAt: string;
}

async function updateShard<T>(path: string, change: (map: Record<string, T>) => void): Promise<void> {
  await withLock(path, async () => {
    const map = await readJson<Record<string, T>>(path, {});
    change(map);
    await writeJson(path, map);
  });
}

export const stateIndex = {
  async get(recordId: string): Promise<RecordState | null> {
    return (await readJson<Record<string, RecordState>>(P.stateShard(recordId), {}))[recordId] ?? null;
  },
  async put(state: RecordState): Promise<void> { await updateShard<RecordState>(P.stateShard(state.recordId), (m) => { m[state.recordId] = state; }); },
  async remove(recordId: string): Promise<void> { await updateShard<RecordState>(P.stateShard(recordId), (m) => { delete m[recordId]; }); },
};

/** contentHash (+ agent) -> recordId: how the same finding is recognised when it turns up again. */
export const hashIndex = {
  async get(agentId: string, contentHash: string): Promise<string | null> {
    return (await readJson<Record<string, string>>(P.hashShard(contentHash), {}))[`${agentId}:${contentHash}`] ?? null;
  },
  async put(agentId: string, contentHash: string, recordId: string): Promise<void> {
    await updateShard<string>(P.hashShard(contentHash), (m) => { m[`${agentId}:${contentHash}`] = recordId; });
  },
  async remove(agentId: string, contentHash: string): Promise<void> {
    await updateShard<string>(P.hashShard(contentHash), (m) => { delete m[`${agentId}:${contentHash}`]; });
  },
};

// ------------------------------------------------------------------ keywords
const STOP = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'have', 'for', 'are', 'was', 'were', 'which', 'their', 'there', 'about', 'into', 'than', 'then', 'also', 'such', 'these', 'those', 'what', 'when', 'where', 'while', 'would', 'could', 'should', 'been', 'being', 'does', 'more', 'most', 'some', 'other', 'only', 'over', 'between', 'each', 'both', 'they', 'them', 'its', 'can', 'may', 'will', 'not', 'but', 'how', 'who', 'why', 'your', 'you']);
export function terms(text: string, max = 24): string[] {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 4 || STOP.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, max).map(([w]) => w);
}
