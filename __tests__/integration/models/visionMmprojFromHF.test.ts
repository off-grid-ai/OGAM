/**
 * A1 — vision projector pairing/rename/download, verified against REAL Hugging Face data.
 *
 * Design: capture once, reuse. The real HF listing + a real download probe (opening bytes of the model and
 * its paired mmproj) are captured into a committed fixture (`__tests__/fixtures/hf/vision-repos.json`). Normal
 * runs are FAST and OFFLINE: they replay the real product pipeline (pickMmProjForDownload → mmProjLocalName →
 * mmProjBelongsToModel) over the captured real filenames, and assert the captured download probe shows a
 * genuine GGUF. No per-run network, no flakiness.
 *
 * To refresh from live HF (the "download once" step — re-hits huggingface.co, downloads the header bytes of
 * every sampled file, rewrites the fixture):
 *
 *     UPDATE_HF_FIXTURES=1 npx jest visionMmprojFromHF
 *
 * The pipeline under test is the exact code that broke on device (SmolVLM/Qwen2.5-VL, iOS, 2026-07-23).
 */
import fs from 'fs';
import path from 'path';
import { isMMProjFile, pickMmProjForDownload, mmProjBelongsToModel } from '../../../src/services/mmproj';
import { mmProjLocalName } from '../../../src/services/modelManager/download';
import { RECOMMENDED_MODELS } from '../../../src/constants/models';

const CURATED_VISION_REPOS = RECOMMENDED_MODELS.filter(m => m.type === 'vision').map(m => m.id);
const POPULAR_VISION_REPOS = [
  'ggml-org/SmolVLM-256M-Instruct-GGUF', // the exact device report
  'ggml-org/SmolVLM-500M-Instruct-GGUF',
  'ggml-org/Qwen2.5-VL-3B-Instruct-GGUF',
  'ggml-org/Qwen2.5-VL-7B-Instruct-GGUF',
  'unsloth/Qwen2.5-VL-7B-Instruct-GGUF',
  'ggml-org/pixtral-12b-GGUF',
  'ggml-org/InternVL3-2B-Instruct-GGUF',
  'ggml-org/gemma-3-4b-it-GGUF',
  'unsloth/gemma-3-4b-it-GGUF',
  'ggml-org/Mistral-Small-3.1-24B-Instruct-2503-GGUF',
  'openbmb/MiniCPM-V-2_6-gguf',
  'moondream/moondream2-gguf',
  'abetlen/Phi-3.5-vision-instruct-gguf',
  'leafspark/Llama-3.2-11B-Vision-Instruct-GGUF',
];
const ALL_REPOS = [...new Set([...CURATED_VISION_REPOS, ...POPULAR_VISION_REPOS])];

const FIXTURE_PATH = path.join(__dirname, '../../fixtures/hf/vision-repos.json');
const REFRESH = !!process.env.UPDATE_HF_FIXTURES;

interface DownloadProbe { name: string; status: number; magic: string }
interface RepoFixture {
  exists: boolean;
  ggufFiles: string[];             // every .gguf filename HF publishes (real)
  probe: { model?: DownloadProbe; mmproj?: DownloadProbe } | null; // real opening-bytes download
}
type Fixture = Record<string, RepoFixture>;

// ---- capture (live network; only when UPDATE_HF_FIXTURES=1) ----------------------------------------

async function fetchTreeGgufFiles(repoId: string): Promise<string[]> {
  const res = await fetch(`https://huggingface.co/api/models/${repoId}/tree/main?recursive=true`, {
    headers: { Accept: 'application/json' },
  });
  // Fail the refresh LOUDLY on a HF error (429/5xx) — silently returning [] would persist an empty/degraded
  // fixture and mask a real regression on the next offline run. A genuinely non-existent repo returns 200
  // with an empty tree, which is handled below (empty list), not an error.
  if (!res.ok) throw new Error(`HF tree fetch failed for ${repoId}: ${res.status}`);
  const entries: Array<{ type: string; path: string }> = await res.json();
  return entries.filter(e => e.type === 'file' && e.path.endsWith('.gguf')).map(e => e.path);
}

async function downloadHead(repoId: string, fileName: string): Promise<DownloadProbe> {
  const url = `https://huggingface.co/${repoId}/resolve/main/${fileName}`;
  const controller = new AbortController();
  const res = await fetch(url, { headers: { Range: 'bytes=0-3' }, signal: controller.signal });
  let magic = '';
  if (res.body) {
    const { value } = await res.body.getReader().read();
    if (value) magic = Buffer.from(value).subarray(0, 4).toString('latin1');
  }
  controller.abort(); // never pull the whole (multi-GB) file
  return { name: fileName, status: res.status, magic };
}

async function captureFixture(): Promise<Fixture> {
  const out: Fixture = {};
  for (const repoId of ALL_REPOS) {
    const ggufFiles = await fetchTreeGgufFiles(repoId);
    const projectors = ggufFiles.filter(isMMProjFile);
    const models = ggufFiles.filter(f => !isMMProjFile(f)).sort((a, b) => a.length - b.length);
    let probe: RepoFixture['probe'] = null;
    const sampleModel = models.find(m => pickMmProjForDownload(m, projectors)) ?? models[0];
    if (sampleModel) {
      const chosen = pickMmProjForDownload(sampleModel, projectors);
      const model = await downloadHead(repoId, sampleModel);
      const mmproj = chosen ? await downloadHead(repoId, chosen) : undefined;
      probe = { model, mmproj };
    }
    out[repoId] = { exists: ggufFiles.length > 0, ggufFiles, probe };
  }
  return out;
}

// ---- the fixture (captured real HF data) -----------------------------------------------------------

function loadFixture(): Fixture | null {
  return fs.existsSync(FIXTURE_PATH) ? JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) : null;
}

// A vision repo passes when the app pairs a projector to at least one model AND the on-disk rename of that
// projector still belongs to the model (so the link survives → initMultimodal runs).
function repoPairsAndBelongs(fx: RepoFixture): { pairs: boolean; belongs: boolean } {
  const projectors = fx.ggufFiles.filter(isMMProjFile);
  const models = fx.ggufFiles.filter(f => !isMMProjFile(f));
  const pairedModels = models.filter(m => pickMmProjForDownload(m, projectors));
  if (pairedModels.length === 0) return { pairs: false, belongs: false };
  const belongs = pairedModels.every(m => {
    const chosen = pickMmProjForDownload(m, projectors)!;
    return mmProjBelongsToModel(m, mmProjLocalName(m, chosen));
  });
  return { pairs: true, belongs };
}

(REFRESH ? describe : describe.skip)('refresh HF vision fixtures (live network — UPDATE_HF_FIXTURES=1)', () => {
  it('captures the real listing + a real download probe for every vision repo', async () => {
    const fixture = await captureFixture();
    fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
    fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
    expect(Object.keys(fixture)).toEqual(ALL_REPOS);
  }, 300000);
});

describe('vision mmproj pairing/rename/download over cached REAL Hugging Face data', () => {
  const fx = loadFixture();

  it('the HF fixture exists (run UPDATE_HF_FIXTURES=1 to capture it)', () => {
    expect(fx).not.toBeNull();
  });

  it.each(CURATED_VISION_REPOS)(
    'curated %s: pairs a projector, its renamed on-disk name belongs, and both files are real GGUF on HF',
    (repoId) => {
      const repo = fx?.[repoId];
      expect(repo?.exists).toBe(true);
      const { pairs, belongs } = repoPairsAndBelongs(repo!);
      expect({ repoId, pairs, belongs }).toEqual({ repoId, pairs: true, belongs: true });
      // the captured real download probe proves the model + its projector are genuine, present GGUF files
      expect(repo!.probe?.model?.magic).toBe('GGUF');
      expect(repo!.probe?.mmproj?.magic).toBe('GGUF');
    },
  );

  it('EVERY examined vision repo (curated + popular, all naming shapes) pairs a projector that belongs', () => {
    // Was a "known-open" ledger for the no-pairing shapes (mmproj-model literal, moondream infixed
    // mmproj + -text-model weights, unsloth UD- quant packaging). All are fixed in mmproj.ts now, so the
    // invariant is stronger: NO real vision repo is left unpaired or with a mismatched on-disk name.
    const broken = ALL_REPOS.filter(id => {
      const repo = fx?.[id];
      if (!repo?.exists) return false;
      const { pairs, belongs } = repoPairsAndBelongs(repo);
      return !pairs || !belongs;
    }).sort();
    expect(broken).toEqual([]);
  });
});
