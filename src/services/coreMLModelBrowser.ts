import logger from '../utils/logger';
interface CoreMLModelFile {
  path: string;
  relativePath: string;
  size: number;
  downloadUrl: string;
}

export interface CoreMLImageModel {
  id: string;
  name: string;
  displayName: string;
  backend: 'coreml';
  downloadUrl: string;
  fileName: string;
  size: number;
  repo: string;
  /** For multi-file models (no zip), individual files to download */
  files?: CoreMLModelFile[];
  /** Attention variant: 'split_einsum' (ANE) or 'original' (CPU/GPU) */
  attentionVariant?: 'split_einsum' | 'original';
}

interface HFTreeEntry {
  type: string;
  path: string;
  size: number;
  lfs?: { oid: string; size: number; pointerSize: number };
}

// All Apple Core ML Stable Diffusion repos.
// Palettized = 6-bit quantized, ~50% smaller, have ZIP downloads.
// Full precision = larger but higher quality, multi-file download required.
// SDXL iOS = 4-bit mixed-bit palettized, 768×768, ANE-optimized.
interface RepoEntry {
  repo: string;
  name: string;
  description: string;
  /** 'split_einsum' (default, ANE) or 'original' (CPU/GPU, lower peak memory) */
  variant?: 'original';
}

const REPOS: RepoEntry[] = [
  {
    repo: 'apple/coreml-stable-diffusion-v1-5-palettized',
    name: 'SD 1.5 Palettized',
    description: '6-bit quantized, 512×512',
  },
  {
    repo: 'apple/coreml-stable-diffusion-2-1-base-palettized',
    name: 'SD 2.1 Palettized',
    description: '6-bit quantized, 512×512',
  },
  {
    repo: 'apple/coreml-stable-diffusion-v1-5-palettized',
    name: 'SD 1.5 Palettized (Low RAM)',
    description: '6-bit quantized, 512×512, CPU/GPU — fits ≤4 GB devices',
    variant: 'original',
  },
  {
    repo: 'apple/coreml-stable-diffusion-2-1-base-palettized',
    name: 'SD 2.1 Palettized (Low RAM)',
    description: '6-bit quantized, 512×512, CPU/GPU — fits ≤4 GB devices',
    variant: 'original',
  },
  {
    repo: 'apple/coreml-stable-diffusion-xl-base-ios',
    name: 'SDXL (iOS)',
    description: '4-bit quantized, 768×768, ANE-optimized',
  },
  {
    repo: 'apple/coreml-stable-diffusion-v1-5',
    name: 'SD 1.5',
    description: 'Full precision, 512×512',
  },
  {
    repo: 'apple/coreml-stable-diffusion-2-1-base',
    name: 'SD 2.1 Base',
    description: 'Full precision, 512×512',
  },
];

let cachedModels: CoreMLImageModel[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchRepoTree(repo: string, path = ''): Promise<HFTreeEntry[]> {
  const url = path
    ? `https://huggingface.co/api/models/${repo}/tree/main/${path}`
    : `https://huggingface.co/api/models/${repo}/tree/main`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${repo}: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Finds a zip archive in the repo that contains compiled models.
 * @param variant 'split_einsum' (ANE-optimized, default) or 'original' (CPU/GPU)
 */
function findCompiledZip(entries: HFTreeEntry[], variant: 'split_einsum' | 'original' = 'split_einsum'): HFTreeEntry | null {
  return entries.find(
    (e) =>
      e.type === 'file' &&
      e.path.endsWith('.zip') &&
      e.path.includes(variant) &&
      e.path.includes('compiled'),
  ) || null;
}

async function fetchModelFromRepo(
  repoInfo: RepoEntry,
): Promise<CoreMLImageModel | null> {
  const { repo, name, variant } = repoInfo;
  const topLevel = await fetchRepoTree(repo);
  const isOriginal = variant === 'original';
  const id = isOriginal
    ? `coreml_${repo.replaceAll('/', '_')}_original`
    : `coreml_${repo.replaceAll('/', '_')}`;
  const attentionVariant = isOriginal ? 'original' : 'split_einsum' as const;

  // Strategy 1: Look for a zip archive (palettized + SDXL iOS repos)
  const zipEntry = findCompiledZip(topLevel, isOriginal ? 'original' : 'split_einsum');
  if (zipEntry) {
    const size = zipEntry.lfs?.size ?? zipEntry.size ?? 0;
    return {
      id,
      name,
      displayName: `${name} (Core ML)`,
      backend: 'coreml',
      downloadUrl: `https://huggingface.co/${repo}/resolve/main/${zipEntry.path}`,
      fileName: zipEntry.path,
      size,
      repo,
      attentionVariant,
    };
  }

  // Strategy 2: Multi-file download from split_einsum/compiled directory
  const variantDir = topLevel.find(
    (e) => e.type === 'directory' && e.path === 'split_einsum',
  );
  if (!variantDir) return null;

  const subEntries = await fetchRepoTree(repo, variantDir.path);
  const compiledDir = subEntries.find(
    (e) => e.type === 'directory' && e.path === 'split_einsum/compiled',
  );
  if (!compiledDir) return null;

  const basePath = compiledDir.path;

  /** Recursively enumerate all files under a path. Subdirectories fetched in parallel. */
  async function enumerate(dirPath: string, maxDepth = 4): Promise<CoreMLModelFile[]> {
    if (maxDepth <= 0) return [];
    const entries = await fetchRepoTree(repo, dirPath);
    const files: CoreMLModelFile[] = [];
    const dirPromises: Promise<CoreMLModelFile[]>[] = [];

    for (const entry of entries) {
      if (entry.type === 'file') {
        const relativePath = entry.path.startsWith(`${basePath}/`)
          ? entry.path.slice(basePath.length + 1)
          : entry.path;
        files.push({
          path: entry.path,
          relativePath,
          size: entry.lfs?.size ?? entry.size ?? 0,
          downloadUrl: `https://huggingface.co/${repo}/resolve/main/${entry.path}`,
        });
      } else if (entry.type === 'directory') {
        if (entry.path.endsWith('/analytics')) continue;
        dirPromises.push(enumerate(entry.path, maxDepth - 1));
      }
    }

    const subResults = await Promise.all(dirPromises);
    for (const sub of subResults) {
      files.push(...sub);
    }
    return files;
  }

  const files = await enumerate(compiledDir.path);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    id,
    name,
    displayName: `${name} (Core ML)`,
    backend: 'coreml',
    downloadUrl: `https://huggingface.co/${repo}/tree/main/${compiledDir.path}`,
    fileName: compiledDir.path,
    size: totalSize,
    repo,
    files,
  };
}

export async function fetchAvailableCoreMLModels(
  forceRefresh = false,
): Promise<CoreMLImageModel[]> {
  if (!forceRefresh && cachedModels && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedModels;
  }

  const models: CoreMLImageModel[] = [];

  const results = await Promise.allSettled(
    REPOS.map(async (repoInfo) => {
      const model = await fetchModelFromRepo(repoInfo);
      if (model) {
        models.push(model);
      }
    }),
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`[CoreMLBrowser] Failed to fetch ${REPOS[i].repo}:`, r.reason);
      logger.warn(`[CoreMLBrowser] Failed to fetch ${REPOS[i].repo}:`, r.reason);
    }
  });

  cachedModels = models;
  cacheTimestamp = Date.now();
  return models;
}
