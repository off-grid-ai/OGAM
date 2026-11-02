import { DownloadedModel, ModelFile } from '../types';
import type { MobileLiteRTCatalogEntry } from '@offgrid/models';
import { liteRTTensorTarget } from '../utils/modelHelpers';
import { fileExceedsBudget } from './memoryBudget';
import { registerBundledCatalog, useWithRemoteCatalog, withRemoteCatalog } from '../stores/modelCatalogStore';

// Synthetic parent id for the curated LiteRT models. Used both as the model id
// in the ModelsScreen browser and as the download id in onboarding so a model
// downloaded in either place resolves to the same `${LITERT_PARENT_ID}/${file}`.
export const LITERT_PARENT_ID = 'offgrid/litert-recommended';

/**
 * The shared catalog shape (@offgrid/models). `maxContextTokens` is the supported context for the
 * pinned artifact, not the default load budget. `confirmDownload` is warning COPY to surface before
 * downloading this file — DATA only, not a device-blind "always warn" flag. Whether the warning
 * actually shows is a device-aware decision made by the caller (fileExceedsBudget: the file's size
 * vs this device's RAM budget). A device that comfortably fits the model shows no warning; one that
 * doesn't warns with this copy.
 */
export type CuratedLiteRTEntry = MobileLiteRTCatalogEntry;

export const CURATED_LITERT_ENTRIES: readonly CuratedLiteRTEntry[] = [
  {
    fileName: 'gemma-4-E2B-it.litertlm',
    hfRepoId: 'litert-community/gemma-4-E2B-it-litert-lm',
    commitHash: '6e5c4f1e395deb959c494953478fa5cec4b8008f',
    sizeBytes: 2588147712,
    displayName: 'Gemma 4 E2B',
    highlight: 'Up to 2x faster than CPU via GPU',
    liteRTVision: true,
    liteRTAudio: true,
    // Google's Gallery 1_0_19 allowlist, same repo, revision, file and byte size:
    // https://github.com/google-ai-edge/gallery/blob/main/model_allowlists/1_0_19.json
    maxContextTokens: 32000,
  },
  {
    fileName: 'gemma-4-E4B-it.litertlm',
    hfRepoId: 'litert-community/gemma-4-E4B-it-litert-lm',
    commitHash: '28299f30ee4d43294517a4ac93abd6163412f07f',
    sizeBytes: 3659530240,
    displayName: 'Gemma 4 E4B',
    highlight: 'Higher quality, same hardware efficiency as E2B',
    liteRTVision: true,
    liteRTAudio: true,
    maxContextTokens: 32000,
    confirmDownload: {
      title: 'Warning',
      message:
        "The model you have selected may exceed your device's memory and might not run reliably. For the best experience, try a smaller model.",
    },
  },
  {
    // Gemma 4 E2B compiled for the Tensor G5 TPU (Pixel 10) — the model Google's Pixel 10 TPU
    // sample runs: https://github.com/google-ai-edge/litert-samples/tree/main/samples/litert/google/sample_app_tpu
    // Listed only on a Tensor G5 phone (liteRTFileRunsOnDevice) and loaded on the TPU
    // (litert.ts resolveLiteRTBackend).
    fileName: 'gemma-4-E2B-it_Google_Tensor_G5.litertlm',
    hfRepoId: 'litert-community/gemma-4-E2B-it-litert-lm',
    commitHash: 'b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1',
    sizeBytes: 3113545589,
    displayName: 'Gemma 4 E2B (Tensor TPU)',
    highlight: 'Runs on the Pixel 10 Tensor TPU',
    liteRTVision: true,
    liteRTAudio: false,
    // Compiled for the TPU with a fixed 4096-token KV cache (every prefill/decode signature).
    maxContextTokens: 4096,
  },
];
registerBundledCatalog('litert', CURATED_LITERT_ENTRIES);

/**
 * Whether a LiteRT file can run on this phone: a build compiled for a Google Tensor TPU only on
 * that generation's TPU (`tpuGeneration` from hardwareService.getTensorTpuGeneration), any
 * portable build everywhere. Both the Models tab and onboarding filter the curated list with it.
 */
export function liteRTFileRunsOnDevice(fileName: string, tpuGeneration: number | null): boolean {
  const target = liteRTTensorTarget(fileName);
  return target === null || target === tpuGeneration;
}

/** The bundled entries merged with the remote catalog. Read these, not CURATED_LITERT_ENTRIES. */
const getCuratedLiteRTEntries = () => withRemoteCatalog('litert', CURATED_LITERT_ENTRIES);
export const useCuratedLiteRTEntries = () => useWithRemoteCatalog('litert', CURATED_LITERT_ENTRIES);

// Rebuilt when the merged list changes (a remote catalog update).
let indexedEntries: readonly CuratedLiteRTEntry[] | null = null;
let curatedLiteRTIndex = new Map<string, CuratedLiteRTEntry>();

export function getCuratedLiteRTEntry(fileName: string | undefined): CuratedLiteRTEntry | undefined {
  if (!fileName) return undefined;
  const entries = getCuratedLiteRTEntries();
  if (entries !== indexedEntries) {
    indexedEntries = entries;
    curatedLiteRTIndex = new Map(entries.map(e => [e.fileName, e]));
  }
  return curatedLiteRTIndex.get(fileName);
}

/** Do not apply a catalog limit to an unrelated import with the same filename. */
export function getCuratedLiteRTContextLimit(model: DownloadedModel | undefined): number | null {
  if (model?.engine !== 'litert') return null;
  const entry = getCuratedLiteRTEntry(model.fileName);
  if (!entry || model.fileSize !== entry.sizeBytes) return null;
  const matches = model.origin
    ? model.origin.repoId === entry.hfRepoId
      && model.origin.revision === entry.commitHash
      && model.origin.path === entry.fileName
    : model.id === `${LITERT_PARENT_ID}/${entry.fileName}`;
  return matches ? entry.maxContextTokens ?? null : null;
}

/**
 * The SINGLE owner of "should downloading this curated LiteRT model warn on THIS
 * device, and with what copy?" — returns the entry's `confirmDownload` copy ONLY
 * when the file genuinely exceeds the device RAM budget, else null. Both the Models
 * tab and the onboarding screen call this so the decision can never diverge (the
 * `confirmDownload` field is warning DATA/copy, never a device-blind "always warn"
 * flag). `ramGB` is read at the caller from the device boundary
 * (hardwareService.getTotalMemoryGB).
 */
export function curatedLiteRTDownloadWarning(
  fileName: string | undefined,
  sizeBytes: number,
  ramGB: number,
): { title: string; message: string } | null {
  const entry = getCuratedLiteRTEntry(fileName);
  if (!entry?.confirmDownload) return null;
  if (!fileExceedsBudget(sizeBytes, ramGB)) return null;
  return entry.confirmDownload;
}

export function buildCuratedLiteRTUrl(entry: CuratedLiteRTEntry): string {
  return `https://huggingface.co/${entry.hfRepoId}/resolve/${entry.commitHash}/${entry.fileName}?download=true`;
}

// ModelFile-shaped view of the curated registry, ready to feed the download
// pipeline. The registry is the single source of truth — both the ModelsScreen
// browser and the onboarding download screen build their cards from this.
export function buildCuratedLiteRTFiles(entries: readonly CuratedLiteRTEntry[] = getCuratedLiteRTEntries()): ModelFile[] {
  return entries.map(e => ({
    name: e.fileName,
    size: e.sizeBytes,
    // Repurpose the quant chip slot as an engine label for curated LiteRT
    // entries. Llama files keep their real quant strings (Q4_K_M etc.); this
    // value never appears on a .gguf card. Mixed-precision is what the actual
    // weights use, but "LiteRT" is what's useful to the reader.
    quantization: 'LiteRT',
    downloadUrl: buildCuratedLiteRTUrl(e),
    liteRTVision: e.liteRTVision,
    liteRTAudio: e.liteRTAudio,
  }));
}
