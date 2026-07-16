/**
 * Image-model extraction integrity — the single source of truth for "is a downloaded
 * image model actually complete on disk".
 *
 * Why this exists: a partial unzip (interrupted, killed process, a flaky zip bridge)
 * left a model missing files (observed on-device: `pos_emb.bin` + `clip_v2.mnn.weight`
 * absent from an mnn model), yet the download was marked `_ready` because nothing
 * validated the extraction. At generation time the native server then died and the app
 * showed a MISLEADING "your device may not support this backend" error — masking a
 * plain missing-file bug as a hardware/SoC problem.
 *
 * The rule is backend-agnostic and needs no per-model file list:
 *  - required base files (present + non-zero): pos_emb.bin, token_emb.bin, tokenizer.json
 *  - the primary UNet: unet.mnn (mnn) or unet.bin (qnn)
 *  - MNN split-weight pairing: every `*.mnn` graph must have its non-zero `*.mnn.weight`
 *    (this is what catches a dropped 156MB `clip_v2.mnn.weight`).
 * coreml (iOS) uses a different layout validated elsewhere, so it's not checked here.
 */
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { ImageModelIncompleteError } from './modelLoadErrors';
import logger from './logger';

type ReadDirItem = Awaited<ReturnType<typeof RNFS.readDir>>[number];

export type ImageBackend = 'mnn' | 'qnn' | 'coreml';

export interface ImageDirEntry {
  name: string;
  /** Size in bytes. A present-but-zero file counts as missing (truncated write). */
  size: number;
  isFile: boolean;
}

export interface IntegrityResult {
  complete: boolean;
  /** File names that are absent or zero-byte. Empty when complete. */
  missing: string[];
}

const BASE_REQUIRED = ['pos_emb.bin', 'token_emb.bin', 'tokenizer.json'] as const;

/**
 * Pure completeness check over a flat listing of the RESOLVED model directory (the
 * dir that directly contains unet.mnn / unet.bin). No IO — unit-testable in isolation.
 */
export function checkImageModelFiles(files: ImageDirEntry[], backend: ImageBackend): IntegrityResult {
  // iOS CoreML models have a different structure (validated in coreMLModelUtils); a
  // non-empty dir is the most we assert here without falsely failing them.
  if (backend === 'coreml') {
    return { complete: files.some(f => f.isFile), missing: [] };
  }

  const sizeByName = new Map<string, number>();
  for (const f of files) if (f.isFile) sizeByName.set(f.name, f.size);

  const missing: string[] = [];
  const requirePresent = (name: string): void => {
    const size = sizeByName.get(name);
    if (size == null || size <= 0) missing.push(name);
  };

  BASE_REQUIRED.forEach(requirePresent);
  requirePresent(backend === 'mnn' ? 'unet.mnn' : 'unet.bin');

  // The clip graph the native server always loads. It may be clip_v2.mnn (upgraded) or
  // clip.mnn (base) for both backends; qnn additionally accepts a self-contained clip.bin
  // (LocalDreamModule falls back to clip.bin when no .mnn clip is present). Require the
  // graph itself here because the mnn split-weight loop below only fires for graphs that
  // ARE present — a dropped clip GRAPH would otherwise slip through.
  const requireClip = (): void => {
    const hasClip =
      (sizeByName.get('clip_v2.mnn') ?? 0) > 0 ||
      (sizeByName.get('clip.mnn') ?? 0) > 0 ||
      (backend === 'qnn' && (sizeByName.get('clip.bin') ?? 0) > 0);
    if (!hasClip) missing.push('clip_v2.mnn');
  };

  if (backend === 'mnn') {
    // mnn always passes --clip + --vae_decoder; --vae_encoder is optional (native adds it
    // only when present), so it is NOT required.
    requirePresent('vae_decoder.mnn');
    requireClip();
    // MNN split-weight pairing: an MNN graph is useless without its `*.mnn.weight`. This is
    // an MNN-FORMAT concern ONLY. QNN packages ship clip_v2.mnn as a MONOLITHIC graph with
    // weights baked in — there is no `.weight` sibling (verified against the xororz/sd-qnn
    // zip and a working on-device qnn model). Running this loop for qnn demanded a
    // clip_v2.mnn.weight that never exists, so every fresh QNN download failed the integrity
    // gate as "incomplete/corrupted" and surfaced a bogus "connection dropped" alert — even
    // though the download and extraction were perfect (Android-only: iOS is coreml).
    for (const [name, size] of sizeByName) {
      if (name.endsWith('.mnn') && size > 0) {
        const weight = `${name}.weight`;
        const weightSize = sizeByName.get(weight);
        if (weightSize == null || weightSize <= 0) missing.push(weight);
      }
    }
  } else {
    // qnn: primary is unet.bin (native binary format), vae_decoder.bin is always loaded, and
    // clip is a self-contained graph (no split weight). Mirror the mnn required set in .bin
    // form; vae_encoder is optional (native adds --vae_encoder only when present).
    requirePresent('vae_decoder.bin');
    requireClip();
  }

  return { complete: missing.length === 0, missing: [...new Set(missing)] };
}

/**
 * Locate the resolved model dir (the one containing the UNet) — mirrors the native
 * LocalDreamModule.resolveModelDir: check `modelPath` itself, then one level of
 * subdirs. Returns null if no UNet marker is found anywhere.
 */
export async function resolveImageModelDir(modelPath: string, backend: ImageBackend): Promise<string | null> {
  const marker = backend === 'mnn' ? 'unet.mnn' : 'unet.bin';
  const hasMarker = async (dir: string): Promise<boolean> => {
    // qnn models also ship a clip_v2.mnn; the marker that disambiguates is the unet.
    try { return await RNFS.exists(`${dir}/${marker}`); } catch { return false; }
  };
  if (await hasMarker(modelPath)) return modelPath;
  let items: ReadDirItem[];
  try { items = await RNFS.readDir(modelPath); } catch { return null; }
  for (const item of items) {
    if (item.isDirectory()) {
      if (await hasMarker(item.path)) return item.path;
      // One more level (e.g. output_512/qnn_models_min for qnn).
      let sub: ReadDirItem[];
      try { sub = await RNFS.readDir(item.path); } catch { continue; }
      for (const s of sub) {
        if (s.isDirectory() && await hasMarker(s.path)) return s.path;
      }
    }
  }
  return null;
}

/**
 * IO wrapper: resolve the model dir under `modelPath` and validate its contents.
 * When the UNet marker can't be found at all, that's itself an incomplete extraction.
 */
export async function validateImageModelDir(modelPath: string, backend: ImageBackend): Promise<IntegrityResult> {
  if (backend === 'coreml') return { complete: true, missing: [] };
  const dir = await resolveImageModelDir(modelPath, backend);
  if (!dir) return { complete: false, missing: [backend === 'mnn' ? 'unet.mnn' : 'unet.bin'] };
  let items: ReadDirItem[];
  try { items = await RNFS.readDir(dir); } catch { return { complete: false, missing: ['<unreadable model dir>'] }; }
  const files: ImageDirEntry[] = items.map(i => ({ name: i.name, size: Number(i.size) || 0, isFile: i.isFile() }));
  return checkImageModelFiles(files, backend);
}

/**
 * Post-unzip completeness gate shared by the primary + resume download paths. On a
 * partial extraction, re-unzip ONCE (handles a transient interrupted write) and re-check;
 * if still incomplete, throw ImageModelIncompleteError so the caller cleans up and the
 * user retries — a partial extraction is NEVER marked `_ready`. No-op for coreml.
 */
export async function ensureImageExtractionComplete(opts: {
  backend: ImageBackend | undefined;
  modelDir: string;
  zipPath: string;
  modelId: string;
}): Promise<void> {
  const { backend, modelDir, zipPath, modelId } = opts;
  if (backend !== 'mnn' && backend !== 'qnn') return;
  let result = await validateImageModelDir(modelDir, backend);
  if (!result.complete) {
    logger.warn(`[ImageDownload] incomplete extraction ${modelId} missing=[${result.missing.join(',')}] — re-unzipping once`);
    await unzip(zipPath, modelDir);
    result = await validateImageModelDir(modelDir, backend);
  }
  if (!result.complete) {
    logger.warn(`[ImageDownload] extraction STILL incomplete ${modelId} missing=[${result.missing.join(',')}] — failing`);
    throw new ImageModelIncompleteError(result.missing);
  }
}
