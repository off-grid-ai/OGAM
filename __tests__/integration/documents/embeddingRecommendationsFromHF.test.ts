/**
 * Every recommended search (embedding) model loads in llama.cpp and embeds by meaning, verified against
 * the REAL Hugging Face file and the REAL engine.
 *
 * Design: capture once, reuse (as visionMmprojFromHF). The capture downloads each recommended file from its
 * pinned URL, checks its size and checksum, and runs it through llama.cpp (Homebrew `llama-embedding`, the
 * engine llama.rn wraps). It writes what happened to `__tests__/fixtures/hf/embedding-recommendations.json`.
 * Normal runs are offline: they assert the capture covers the CURRENT catalog entry by entry (a changed or
 * added recommendation fails until it is captured again) and that each one loaded and ranked by meaning.
 *
 * To refresh (downloads about 170 MB, needs `brew install llama.cpp`):
 *
 *     UPDATE_HF_FIXTURES=1 npx jest embeddingRecommendationsFromHF
 *
 * Community report, 2026-11-03: the armand01 Multilingual MiniLM had 35 more embedding rows than vocabulary
 * tokens, so llama.cpp refused it and the Search tab showed "Failed to load model".
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { RECOMMENDED_EMBEDDING_MODELS } from '../../../src/services/huggingFaceModelBrowser';

interface Capture {
  size: number;
  sha256: string;
  /** llama.cpp's refusal, or null when the file loaded. */
  loadError: string | null;
  dimension: number;
  /** Cosine similarity to a paraphrase (a translation for a multilingual model), and to an unrelated sentence. */
  near: number;
  unrelated: number;
}
type Fixture = Record<string, Capture>;

const FIXTURE_PATH = path.join(__dirname, '../../fixtures/hf/embedding-recommendations.json');
const REFRESH = !!process.env.UPDATE_HF_FIXTURES;
const SOURCE = 'The cat sleeps on the sofa.';
const UNRELATED = 'Stock prices fell sharply today.';

async function capture(candidate: (typeof RECOMMENDED_EMBEDDING_MODELS)[number], folder: string): Promise<Capture> {
  const bytes = Buffer.from(await (await fetch(candidate.downloadUrl)).arrayBuffer());
  const file = path.join(folder, `${createHash('sha256').update(candidate.id).digest('hex')}.gguf`);
  fs.writeFileSync(file, bytes);
  const near = /multilingual/i.test(candidate.name) ? 'Die Katze schläft auf dem Sofa.' : 'A cat is sleeping on the couch.';
  const result = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  try {
    const output = execFileSync('llama-embedding', [
      '-m', file, '-c', '512', '-b', '512', '-ngl', '0', '--embd-normalize', '2',
      '--embd-output-format', 'array', '--embd-separator', '|', '-p', `${SOURCE}|${near}|${UNRELATED}`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const [source, close, other] = JSON.parse(output) as number[][];
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
    return { ...result, loadError: null, dimension: source.length, near: dot(source, close), unrelated: dot(source, other) };
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? error);
    const refusal = stderr.split('\n').find(line => /error loading model|failed to load/i.test(line)) ?? stderr.slice(-300);
    return { ...result, loadError: refusal.trim(), dimension: 0, near: 0, unrelated: 0 };
  }
}

let fixture: Fixture;

beforeAll(async () => {
  if (REFRESH) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'embedding-recommendations-'));
    fixture = {};
    for (const candidate of RECOMMENDED_EMBEDDING_MODELS) fixture[candidate.id] = await capture(candidate, folder);
    fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
    fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  } else {
    fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  }
}, 600000);

describe.each(RECOMMENDED_EMBEDDING_MODELS.map(candidate => [candidate.name, candidate] as const))('%s', (_name, candidate) => {
  it('was captured from its pinned file: the bytes are the size and checksum the catalog promises', () => {
    expect(fixture[candidate.id]).toMatchObject({ size: candidate.size, sha256: candidate.sha256 });
  });

  it('loads in llama.cpp and ranks a paraphrase well above an unrelated sentence', () => {
    const captured = fixture[candidate.id];
    expect(captured.loadError).toBeNull();
    expect(captured.dimension).toBe(384);
    expect(captured.near - captured.unrelated).toBeGreaterThan(0.3);
  });
});
