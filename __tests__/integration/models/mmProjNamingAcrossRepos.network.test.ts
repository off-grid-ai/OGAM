/**
 * A1 — iOS "Multimodal support not enabled. Call initMultimodal first."
 *
 * The chain a vision model must survive to actually initialize multimodal on device:
 *   (1) PAIR    — from the LIVE HF listing, `pickMmProjForDownload` picks the projector that belongs to the
 *                 model (huggingFaceService.getModelFiles → ModelFile.mmProjFile). If it returns none, the
 *                 app never even downloads a projector → text-only → the device crash.
 *   (2) RENAME  — on download the projector is renamed via `mmProjLocalName` to a shared on-disk name.
 *   (3) BELONGS — the strict on-disk matcher (`mmProjBelongsToModel`) must still accept the renamed file, or
 *                 `linkOrphanMmProj` clears the link on the next scan → text-only → the device crash.
 *
 * This test hits the REAL Hugging Face listing for every vision repo the app curates plus popular families,
 * runs the REAL product pipeline over whatever HF publishes (no hardcoded filenames, no mocks of our code),
 * and reports at WHICH stage each repo breaks. Requires network.
 */
import { huggingFaceService } from '../../../src/services/huggingface';
import { mmProjLocalName } from '../../../src/services/modelManager/download';
import { mmProjBelongsToModel } from '../../../src/services/mmproj';
import { RECOMMENDED_MODELS } from '../../../src/constants/models';

const CURATED_VISION_REPOS = RECOMMENDED_MODELS.filter(m => m.type === 'vision').map(m => m.id);

// Popular vision families in the wild (real repos confirmed via HF API during research).
const POPULAR_VISION_REPOS = [
  'ggml-org/SmolVLM-256M-Instruct-GGUF', // the exact device report (Christophe)
  'ggml-org/SmolVLM-500M-Instruct-GGUF',
  'ggml-org/Qwen2.5-VL-3B-Instruct-GGUF',
  'ggml-org/Qwen2.5-VL-7B-Instruct-GGUF',
  'unsloth/Qwen2.5-VL-7B-Instruct-GGUF',
  'ggml-org/gemma-3-4b-it-GGUF',
  'unsloth/gemma-3-4b-it-GGUF',
  'ggml-org/pixtral-12b-GGUF',
  'ggml-org/Mistral-Small-3.1-24B-Instruct-2503-GGUF',
  'ggml-org/InternVL3-2B-Instruct-GGUF',
  'openbmb/MiniCPM-V-2_6-gguf',
  'moondream/moondream2-gguf',
  'abetlen/Phi-3.5-vision-instruct-gguf',
  'leafspark/Llama-3.2-11B-Vision-Instruct-GGUF',
];

const ALL_REPOS = [...new Set([...CURATED_VISION_REPOS, ...POPULAR_VISION_REPOS])];

interface RepoResult {
  repoId: string;
  curated: boolean;
  exists: boolean;
  modelCount: number;
  pairedCount: number;
  sampleModel?: string;
  sampleProjectorHF?: string;
  sampleOnDisk?: string;
  belongsAll: boolean;
  stage: 'ok' | 'no-repo' | 'no-pairing' | 'rename-mismatch';
}

async function examineRepo(repoId: string): Promise<RepoResult> {
  const curated = CURATED_VISION_REPOS.includes(repoId);
  let files;
  try {
    files = await huggingFaceService.getModelFiles(repoId);
  } catch {
    return { repoId, curated, exists: false, modelCount: 0, pairedCount: 0, belongsAll: false, stage: 'no-repo' };
  }
  if (files.length === 0) {
    return { repoId, curated, exists: false, modelCount: 0, pairedCount: 0, belongsAll: false, stage: 'no-repo' };
  }
  const paired = files.filter(f => f.mmProjFile);
  if (paired.length === 0) {
    return { repoId, curated, exists: true, modelCount: files.length, pairedCount: 0, belongsAll: false, stage: 'no-pairing' };
  }
  const sample = paired[0];
  const sampleOnDisk = mmProjLocalName(sample.name, sample.mmProjFile!.name);
  const belongsAll = paired.every(f => mmProjBelongsToModel(f.name, mmProjLocalName(f.name, f.mmProjFile!.name)));
  return {
    repoId, curated, exists: true, modelCount: files.length, pairedCount: paired.length,
    sampleModel: sample.name, sampleProjectorHF: sample.mmProjFile!.name, sampleOnDisk,
    belongsAll, stage: belongsAll ? 'ok' : 'rename-mismatch',
  };
}

describe('mmproj naming — live HF pairing→rename→belongs pipeline across every vision repo', () => {
  const results: RepoResult[] = [];

  it('examines every repo and records the stage it reaches', async () => {
    for (const repoId of ALL_REPOS) {
      results.push(await examineRepo(repoId));
    }
    // Print the full matrix so the examination is on the record regardless of pass/fail.
    const lines = results.map(r => {
      const head = `${r.stage === 'ok' ? 'OK  ' : 'FAIL'} ${r.curated ? '*' : ' '} ${r.repoId}  stage=${r.stage} paired=${r.pairedCount}/${r.modelCount}`;
      const detail = r.sampleModel ? `\n         hfProj=${r.sampleProjectorHF}  onDisk=${r.sampleOnDisk} belongs=${r.belongsAll}` : '';
      return `${head}${detail}`;
    });
    process.stdout.write(`\n[A1 vision-projector matrix]\n${lines.join('\n')}\n`);
    expect(results.length).toBe(ALL_REPOS.length);
  }, 180000);

  it('CORE INVARIANT: every curated vision repo pairs a projector AND its renamed on-disk name belongs', () => {
    const curated = results.filter(r => r.curated);
    const broken = curated.filter(r => r.stage !== 'ok');
    expect(broken.map(r => `${r.repoId} [${r.stage}]`)).toEqual([]);
  });

  it('KNOWN-OPEN (separate, non-curated bug): exactly these wild repos still fail at PAIRING — tracked, not silently green', () => {
    // pickMmProjForDownload returns no projector for these shapes: `mmproj-model-<prec>` literal token
    // (ggml-org gemma-3, openbmb MiniCPM), a `UD-`packaged model quant (Mistral-Small), and an infixed
    // `mmproj` on a `-text-model-` weights name (moondream). None are curated. Fixing that is a SEPARATE
    // backlog item — this assertion is a ledger: a NEW pairing break, or a fix, forces this list to change.
    const noPairing = results.filter(r => r.stage === 'no-pairing').map(r => r.repoId).sort();
    expect(noPairing).toEqual([
      'ggml-org/Mistral-Small-3.1-24B-Instruct-2503-GGUF',
      'ggml-org/gemma-3-4b-it-GGUF',
      'moondream/moondream2-gguf',
      'openbmb/MiniCPM-V-2_6-gguf',
    ]);
  });
});
