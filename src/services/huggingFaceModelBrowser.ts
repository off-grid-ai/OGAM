import { Buffer } from 'buffer';
import { CATALOG, searchHuggingFace, extractQuantization, standardImageModelDefaults } from '@offgrid/models';
import RNFS from 'react-native-fs';
import type { ImageModelDescriptor } from './imageModelDownloadTypes';

export interface HFImageModel {
  id: string;
  name: string;
  displayName: string;
  backend: ImageModelDescriptor['backend'];
  huggingFaceFiles?: ImageModelDescriptor['huggingFaceFiles'];
  variant?: string;
  downloadUrl: string;
  fileName: string;
  size: number;
  repo: string;
}

interface HFTreeEntry {
  type: string;
  path: string;
  size: number;
  lfs?: { oid: string; size: number; pointerSize: number };
}

const REPOS = {
  mnn: 'xororz/sd-mnn',
  qnn: 'xororz/sd-qnn',
} as const;

const VARIANT_LABELS: Record<string, string> = {
  min: 'For non-flagship Snapdragon chips',
  '8gen1': 'For Snapdragon 8 Gen 1',
  '8gen2': 'For Snapdragon 8 Gen 2/3/4/5',
};

let cachedModels: HFImageModel[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function insertSpaces(name: string): string {
  // Insert space before uppercase letters that follow lowercase or digits
  // e.g. "AnythingV5" -> "Anything V5", "AbsoluteReality" -> "Absolute Reality"
  return name.replaceAll(/([a-z\d])([A-Z])/g, '$1 $2');
}

function parseFileName(fileName: string, backend: 'mnn' | 'qnn'): Omit<HFImageModel, 'downloadUrl' | 'size' | 'repo'> | null {
  if (!fileName.endsWith('.zip')) return null;

  const baseName = fileName.replace('.zip', '');

  if (backend === 'qnn') {
    // NPU: e.g. "AnythingV5_qnn2.28_8gen2.zip"
    const match = baseName.match(/^(.+?)_qnn[\d.]+_(.+)$/);
    if (!match) return null;
    const [, name, variant] = match;
    const displayVariant = variant === 'min' ? 'non-flagship' : variant;
    return {
      id: `${name.toLowerCase()}_npu_${variant}`,
      name,
      displayName: `${insertSpaces(name)} (NPU ${displayVariant})`,
      backend: 'qnn',
      variant,
      fileName,
    };
  }

  // GPU: e.g. "AnythingV5.zip"
  return {
    id: `${baseName.toLowerCase()}_cpu`,
    name: baseName,
    displayName: `${insertSpaces(baseName)} (GPU)`,
    backend: 'mnn',
    fileName,
  };
}

async function fetchRepoFiles(repo: string): Promise<HFTreeEntry[]> {
  const response = await fetch(`https://huggingface.co/api/models/${repo}/tree/main`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${repo}: HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchAvailableModels(forceRefresh = false, opts?: { skipQnn?: boolean }): Promise<HFImageModel[]> {
  if (!forceRefresh && cachedModels && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedModels;
  }

  const fetchQnn = !opts?.skipQnn;
  const [mnnFiles, qnnFiles] = await Promise.all([
    fetchRepoFiles(REPOS.mnn),
    fetchQnn ? fetchRepoFiles(REPOS.qnn) : Promise.resolve([] as HFTreeEntry[]),
  ]);

  const models: HFImageModel[] = [];

  for (const entry of mnnFiles) {
    if (entry.type !== 'file') continue;
    const parsed = parseFileName(entry.path, 'mnn');
    if (!parsed) continue;
    models.push({
      ...parsed,
      downloadUrl: `https://huggingface.co/${REPOS.mnn}/resolve/main/${entry.path}`,
      size: entry.lfs?.size ?? entry.size,
      repo: REPOS.mnn,
    });
  }

  for (const entry of qnnFiles) {
    if (entry.type !== 'file') continue;
    const parsed = parseFileName(entry.path, 'qnn');
    if (!parsed) continue;
    models.push({
      ...parsed,
      downloadUrl: `https://huggingface.co/${REPOS.qnn}/resolve/main/${entry.path}`,
      size: entry.lfs?.size ?? entry.size,
      repo: REPOS.qnn,
    });
  }

  // Sort: GPU first, then NPU; alphabetically within each group
  models.sort((a, b) => {
    if (a.backend !== b.backend) return a.backend === 'mnn' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  cachedModels = models;
  cacheTimestamp = Date.now();
  return models;
}

export function getVariantLabel(variant?: string): string | undefined {
  return variant ? VARIANT_LABELS[variant] : undefined;
}

export function guessStyle(name: string): string {
  const lower = name.toLowerCase();
  if (
    lower.includes('reality') ||
    lower.includes('realistic') ||
    lower.includes('chillout') ||
    lower.includes('photo')
  ) {
    return 'photorealistic';
  }
  return 'anime';
}

const QWEN_IMAGE_WEIGHT = /^qwen_image_2\.1-.*\.gguf$/i;
const IMAGE_HEADER_BYTES = 1024 * 1024;

/** Bundled complete checkpoints share the Desktop catalog. Split diffusion packs
 * need an explicit companion contract before they can be offered on mobile. */
export function getSDImageModels(): HFImageModel[] {
  return CATALOG.filter(model => model.id === 'leejet/Qwen-Image-2.1-GGUF' ||
    (model.kind === 'image' && model.files.length === 1 &&
      /^(offgrid-ai\/|mzwing\/SDXL-Lightning|OlegSkutte\/sdxl-turbo)/i.test(model.id)))
    .map(model => ({
      id: `sd-${model.id.replaceAll('/', '--')}`,
      name: model.name, displayName: model.name, backend: 'sd' as const,
      // Quant variants can have a distinct catalog ID in the same HF repository.
      repo: model.files[0].url.match(/^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\//i)?.[1] ?? model.id,
      fileName: model.files[0].name, downloadUrl: model.files[0].url,
      size: model.files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
      huggingFaceFiles: model.files.map(file => ({ path: file.name, size: file.sizeBytes ?? 0, downloadUrl: file.url, sha256: file.sha256 })),
    }));
}

/** Filename candidates only. New checkpoint candidates must pass tensor validation. */
export const isSDImageWeight = (name: string): boolean => QWEN_IMAGE_WEIGHT.test(name) ||
  (/\.(gguf|safetensors)$/i.test(name) && !/[/\\]|(?:vae|clip|t5|encoder|mmproj|lora|adapter|qwen|flux|wan|hunyuan|ltx|z_image|sd3|\d{5}-of-\d{5})/i.test(name));

/** Read tensor names, never model data or metadata strings, to reject text models,
 * adapters, and UNet-only exports. A bounded or malformed header fails closed. */
function isCompleteSDCheckpoint(bytes: Buffer): boolean {
  try {
    let offset = 0;
    const take = (size: number) => {
      if (!Number.isSafeInteger(size) || size < 0 || offset + size > bytes.length) throw new Error('Incomplete header');
      const start = offset; offset += size; return start;
    };
    const u32 = () => bytes.readUInt32LE(take(4));
    const u64 = () => { const pos = take(8); return bytes.readUInt32LE(pos) + bytes.readUInt32LE(pos + 4) * 4294967296; };
    const string = () => { const length = u64(); return bytes.toString('utf8', take(length), offset); };
    let names: string[];
    if (bytes.toString('ascii', 0, 4) === 'GGUF') {
      take(4);
      const version = u32();
      if (version !== 2 && version !== 3) return false;
      const tensors = u64(), metadata = u64();
      if (tensors > 20000 || metadata > 10000) return false;
      const skipValue = (type: number, depth = 0): void => {
        if (depth > 1) throw new Error('Invalid metadata');
        const sizes: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
        if (type === 8) { string(); return; }
        if (type === 9) {
          const subtype = u32(), count = u64();
          if (count > IMAGE_HEADER_BYTES) throw new Error('Large metadata');
          for (let i = 0; i < count; i++) skipValue(subtype, depth + 1);
          return;
        }
        if (!sizes[type]) throw new Error('Unknown metadata');
        take(sizes[type]);
      };
      for (let i = 0; i < metadata; i++) { string(); skipValue(u32()); }
      names = [];
      for (let i = 0; i < tensors; i++) {
        names.push(string());
        const dimensions = u32();
        if (dimensions > 4) return false;
        take(dimensions * 8 + 4 + 8);
      }
    } else {
      const length = u64();
      names = Object.keys(JSON.parse(bytes.toString('utf8', take(length), offset)));
    }
    return names.some(name => /^model\.diffusion_model\.input_blocks\./.test(name)) &&
      names.some(name => /^first_stage_model\.decoder\./.test(name)) &&
      names.some(name => /^(cond_stage_model\.|conditioner\.embedders\.)/.test(name));
  } catch { return false; }
}

export async function validateSDCheckpointFile(path: string): Promise<boolean> {
  const size = Number((await RNFS.stat(path)).size);
  return isCompleteSDCheckpoint(Buffer.from(await RNFS.read(path, Math.min(size, IMAGE_HEADER_BYTES), 0, 'base64'), 'base64'));
}

/** The same required-file list is used by loading, recovery, and model transfer. */
export function getSDImagePackFiles(names: string[], modelId?: string): NonNullable<HFImageModel['huggingFaceFiles']> | null {
  const weights = names.filter(isSDImageWeight);
  if (weights.length !== 1) return null;
  const templates = getSDImageModels();
  if (!QWEN_IMAGE_WEIGHT.test(weights[0])) {
    const template = templates.find(model => model.id === modelId && model.fileName === weights[0]);
    return [{ path: weights[0], size: 0, sha256: template?.huggingFaceFiles?.[0].sha256 }];
  }
  const template = templates.find(model => model.repo === 'leejet/Qwen-Image-2.1-GGUF');
  if (!template?.huggingFaceFiles) return null;
  return template.huggingFaceFiles.map(file => file.path === template.fileName
    ? { path: weights[0], size: 0, sha256: modelId === template.id && weights[0] === file.path ? file.sha256 : undefined }
    : file);
}

/** Replace catalog size estimates with immutable Hugging Face file metadata. */
export async function resolveSDImageDownloadFiles(repo: string, files: NonNullable<HFImageModel['huggingFaceFiles']>) {
  if (files.every(file => file.sha256 && /\/resolve\/[a-f0-9]{40}\//i.test(file.downloadUrl ?? ''))) return files;
  const response = await fetch(`https://huggingface.co/api/models/${repo}?blobs=true`);
  if (!response.ok) throw new Error('Could not verify the image download files. Try again.');
  const data = await response.json() as { sha: string; siblings?: { rfilename: string; size?: number; lfs?: { size: number; sha256?: string } }[] };
  if (!/^[a-f0-9]{40}$/i.test(data.sha)) throw new Error('The model repository has no stable revision.');
  return files.map(file => {
    if (file.sha256 && /\/resolve\/[a-f0-9]{40}\//i.test(file.downloadUrl ?? '')) return file;
    const source = data.siblings?.find(candidate => candidate.rfilename === file.path);
    const size = source?.lfs?.size ?? source?.size ?? 0;
    if (!source || size <= 0) throw new Error(`Required image file is missing: ${file.path}`);
    return { path: file.path, size, sha256: source.lfs?.sha256,
      downloadUrl: `https://huggingface.co/${repo}/resolve/${data.sha}/${file.path.split('/').map(encodeURIComponent).join('/')}` };
  });
}

export async function searchSDImageModels(query: string, signal?: AbortSignal): Promise<HFImageModel[]> {
  const params = new URLSearchParams({ search: query, pipeline_tag: 'text-to-image', sort: 'downloads', direction: '-1', limit: '10' });
  const [ggufRepos, checkpointResponse] = await Promise.all([
    searchHuggingFace(query, { kind: 'image', limit: 10, fetchImpl: (url, init) => fetch(url, { ...init, signal }) }),
    fetch(`https://huggingface.co/api/models?${params}`, { signal }),
  ]);
  if (!checkpointResponse.ok) throw new Error('Could not search image models on Hugging Face. Try again.');
  const checkpointRepos = await checkpointResponse.json() as { id: string }[];
  const repositories = [...new Map([...ggufRepos, ...checkpointRepos].map(repo => [repo.id, repo])).values()];
  const catalogModels = getSDImageModels();
  const template = catalogModels.find(model => model.repo === 'leejet/Qwen-Image-2.1-GGUF')!;
  const companion = template.huggingFaceFiles!.filter(file => file.path !== template.fileName);
  const models: HFImageModel[] = [];
  let readableRepos = 0;
  for (const repo of repositories) {
    if (signal?.aborted) throw new Error('Image search cancelled.');
    try {
      const response = await fetch(`https://huggingface.co/api/models/${repo.id}?blobs=true`, { signal });
      if (!response.ok) continue;
      const data = await response.json() as { sha: string; siblings?: { rfilename: string; size?: number; lfs?: { size: number; sha256?: string } }[] };
      if (!/^[a-f0-9]{40}$/i.test(data.sha)) continue;
      readableRepos++;
      // Bound header work per repo. Unsupported files remain absent from downloads.
      const candidates = (data.siblings ?? []).filter(file => isSDImageWeight(file.rfilename) && (file.lfs?.size ?? file.size ?? 0) > 0).slice(0, 8);
      for (const file of candidates) {
        const downloadUrl = `https://huggingface.co/${repo.id}/resolve/${data.sha}/${encodeURIComponent(file.rfilename)}`;
        const qwen = QWEN_IMAGE_WEIGHT.test(file.rfilename);
        if (!qwen) {
          const header = await fetch(downloadUrl, { signal, headers: { Range: `bytes=0-${IMAGE_HEADER_BYTES - 1}` } });
          if (header.status !== 206 || !/^bytes 0-\d+\//.test(header.headers.get('content-range') ?? '') ||
            Number(header.headers.get('content-length')) > IMAGE_HEADER_BYTES) continue;
          if (!isCompleteSDCheckpoint(Buffer.from(await header.arrayBuffer()))) continue;
        }
        const size = file.lfs?.size ?? file.size ?? 0;
        const canonical = catalogModels.find(model => model.repo === repo.id && model.fileName === file.rfilename);
        const id = canonical?.id ?? `sd-${repo.id.replaceAll('/', '--')}--${file.rfilename}`;
        if (id.length > 160) continue;
        const displayName = canonical?.displayName ?? (qwen ? `Qwen Image 2.1 ${extractQuantization(file.rfilename)}` : file.rfilename.replace(/\.(gguf|safetensors)$/i, ''));
        const parts = [{ path: file.rfilename, size, downloadUrl, sha256: file.lfs?.sha256 }, ...(qwen ? companion : [])];
        models.push({ id, name: displayName, displayName, backend: 'sd', repo: repo.id, fileName: file.rfilename,
          downloadUrl, size: parts.reduce((sum, part) => sum + part.size, 0), huggingFaceFiles: parts });
      }
    } catch { /* One inaccessible repository must not hide other supported results. */ }
  }
  if (repositories.length && !readableRepos) throw new Error('Could not read image model files from Hugging Face. Try again.');
  if (repositories.length && !models.length) throw new Error('No complete supported image checkpoints found. Use SD 1.x, SD 2.x, SDXL, or Qwen Image 2.1. Split models and adapters need other files.');
  return models;
}

export async function resolveSDImagePack(_modelId: string, modelPath: string) {
  const files = getSDImagePackFiles((await RNFS.readDir(modelPath)).filter(file => file.isFile()).map(file => file.name));
  if (!files) throw new Error('Select one complete SD checkpoint or a Qwen Image 2.1 pack.');
  const weight = files[0].path;
  const defaults = standardImageModelDefaults(weight);
  if (!QWEN_IMAGE_WEIGHT.test(weight)) {
    if (!await validateSDCheckpointFile(`${modelPath}/${weight}`)) throw new Error('This checkpoint is unsupported or incomplete. It must include the SD image model, text encoder, and VAE.');
    return { family: 'checkpoint', weight: `${modelPath}/${weight}`, vae: '', llm: '', sampler: defaults.sampler, scheduler: defaults.scheduler };
  }
  const required = (pattern: RegExp) => {
    const file = files.find(part => pattern.test(part.path));
    if (!file) throw new Error('The image model pack is incomplete.');
    return `${modelPath}/${file.path}`;
  };
  return { family: 'qwen-image-2.1', weight: `${modelPath}/${weight}`,
    vae: required(/vae.*\.safetensors$/i), llm: required(/^Qwen3VL-.*\.gguf$/i),
    sampler: defaults.sampler, scheduler: defaults.scheduler };
}

export const BUNDLED_EMBEDDING_MODEL = {
  id: 'bundled:all-MiniLM-L6-v2-Q8_0', name: 'MiniLM L6 (built-in)',
  description: 'English text search. Included with the app.', size: 0, downloadUrl: undefined,
} as const;

/** Pinned Hugging Face files; runtime validation is still required on each phone. */
export const RECOMMENDED_EMBEDDING_MODELS = [
  {
    id: 'leliuga/all-MiniLM-L12-v2-GGUF@f048c4f3577816f9825989a59a7eed3c9afa3f1d/all-MiniLM-L12-v2.Q8_0.gguf',
    name: 'MiniLM L12', description: 'English text search, 12-layer encoder.', size: 36413728,
    downloadUrl: 'https://huggingface.co/leliuga/all-MiniLM-L12-v2-GGUF/resolve/f048c4f3577816f9825989a59a7eed3c9afa3f1d/all-MiniLM-L12-v2.Q8_0.gguf',
    sha256: '161d07a32057e754e1fe82e30547c736032ab255a6719890b7e76414c565b748',
  },
  {
    id: 'armand01/paraphrase-multilingual-MiniLM-L12-v2-Q6_K-GGUF@34b69e1683fccf80bbbe7255b8651cd7a76e8891/paraphrase-multilingual-minilm-l12-v2.Q6_K.gguf',
    name: 'Multilingual MiniLM L12', description: 'Text search across multiple languages.', size: 130844160,
    downloadUrl: 'https://huggingface.co/armand01/paraphrase-multilingual-MiniLM-L12-v2-Q6_K-GGUF/resolve/34b69e1683fccf80bbbe7255b8651cd7a76e8891/paraphrase-multilingual-minilm-l12-v2.Q6_K.gguf',
    sha256: 'b5780f54a02b2e9a1cded186d349800aedfd6fb38635c41f532a9385fed34d32',
  },
] as const;

/** GGUF text encoders are candidates until the local runtime validates the file. */
export async function searchEmbeddingModels(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({
    search: query.trim(), filter: 'gguf',
    sort: 'downloads', direction: '-1', limit: '20',
  });
  const searches = await Promise.all(['sentence-similarity', 'feature-extraction'].map(async tag => {
    const response = await fetch(`https://huggingface.co/api/models?${params}&pipeline_tag=${tag}`, { signal });
    if (!response.ok) throw new Error(`Embedding search failed: HTTP ${response.status}`);
    return await response.json() as { id: string }[];
  }));
  const repos = [...new Map(searches.flat().map(repo => [repo.id, repo])).values()];
  const listings = await Promise.allSettled(repos.map(async repo => {
    const result = await fetch(`https://huggingface.co/api/models/${repo.id}?blobs=true`, { signal });
    if (!result.ok) throw new Error(`Could not read ${repo.id}`);
    const data = await result.json() as {
      sha: string;
      gguf?: { architecture?: string };
      siblings?: { rfilename: string; size?: number; lfs?: { size: number; sha256?: string } }[];
    };
    if (!/^[a-f0-9]{40}$/i.test(data.sha) || (data.gguf?.architecture && data.gguf.architecture !== 'bert')) return [];
    return (data.siblings ?? []).filter(file =>
      /\.gguf$/i.test(file.rfilename) &&
      !/mmproj|(?:-\d{5}-of-\d{5})/i.test(file.rfilename) &&
      (file.lfs?.size ?? file.size ?? 0) > 0,
    ).map(file => ({
      id: `${repo.id}@${data.sha}/${file.rfilename}`,
      name: `${repo.id} / ${file.rfilename}`,
      size: file.lfs?.size ?? file.size ?? 0,
      sha256: file.lfs?.sha256,
      downloadUrl: `https://huggingface.co/${repo.id}/resolve/${data.sha}/${file.rfilename.split('/').map(encodeURIComponent).join('/')}`,
    }));
  }));
  if (signal?.aborted) throw new Error('Embedding search cancelled');
  if (listings.length && listings.every(result => result.status === 'rejected')) {
    throw new Error('Could not read embedding model files. Try again.');
  }
  return listings.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
