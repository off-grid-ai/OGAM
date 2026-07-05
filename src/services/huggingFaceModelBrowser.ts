export interface HFImageModel {
  id: string;
  name: string;
  displayName: string;
  backend: 'mnn' | 'qnn';
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

  // MNN: CPU/GPU via OpenCL — label as MNN so users on Pixel/Tensor are not told
  // to pick a separate "CPU model" while the catalog only lists "GPU" and "NPU".
  return {
    id: `${baseName.toLowerCase()}_cpu`,
    name: baseName,
    displayName: `${insertSpaces(baseName)} (MNN)`,
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
