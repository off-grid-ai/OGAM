import { CATALOG, type MobileTextCatalogModel, type ModelEntry } from '@offgrid/models';
import { textModelBudget } from '../services/memoryBudget';
import { registerBundledCatalog } from '../stores/modelCatalogStore';
import { engineLoadsCatalogModel } from '../services/llamaEngineSupport';

// Model size recommendations based on device RAM
export const MODEL_RECOMMENDATIONS = {
  // RAM in GB -> the quantization to suggest
  memoryToParams: [
    { minRam: 3, maxRam: 4, quantization: 'Q4_K_M' },
    { minRam: 4, maxRam: 6, quantization: 'Q4_K_M' },
    { minRam: 6, maxRam: 8, quantization: 'Q4_K_M' },
    { minRam: 8, maxRam: 12, quantization: 'Q4_K_M' },
    { minRam: 12, maxRam: 16, quantization: 'Q4_K_M' },
    { minRam: 16, maxRam: Infinity, quantization: 'Q4_K_M' },
  ],
};

// The phone's curated chat models are the shared catalog's (@offgrid/models): one list for every
// app. Kept in the shape the phone's screens read. A model replaced by a newer one, or one this
// engine's llama.cpp build cannot load, is not offered; an installed one keeps working, because
// names and files are looked up in the full catalog.
function offeredOnPhone(entry: ModelEntry): boolean {
  if (entry.kind !== 'text' && entry.kind !== 'vision') return false;
  if (entry.availability === 'coming_soon' || entry.grounder || entry.quantOf || entry.supersededBy) return false;
  if (!engineLoadsCatalogModel(entry)) return false;
  return entry.files.some(file => (file.role === 'primary' || file.role === undefined) && !!file.sizeBytes);
}

/** RAM a model needs on a phone when the catalog does not say: its download over the phone's
 *  "Runs well" share of RAM. */
function phoneMinRamGb(entry: ModelEntry): number {
  if (entry.minRamGb) return entry.minRamGb;
  const bytes = entry.files.filter(f => f.role !== 'aux').reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0);
  return Math.ceil(bytes / 1e9 / textModelBudget().soft);
}

/** The catalog names a maker for people ("Meta"); the maker filter keys by its Hugging Face org
 *  ("meta-llama"). One map so a catalog model is found under its maker's filter. */
const CATALOG_ORG_TO_FILTER_KEY: Record<string, string> = {
  Meta: 'meta-llama',
  NVIDIA: 'nvidia',
  Mistral: 'mistralai',
};

export const RECOMMENDED_MODELS: MobileTextCatalogModel[] = CATALOG.filter(offeredOnPhone).map(entry => ({
  id: entry.id,
  name: entry.name,
  params: entry.params ?? 0,
  description: entry.description ?? '',
  minRam: phoneMinRamGb(entry),
  maxRam: undefined,
  type: entry.kind === 'vision' ? 'vision' : 'text',
  org: CATALOG_ORG_TO_FILTER_KEY[entry.org ?? ''] ?? entry.org ?? entry.id.split('/')[0],
  isNew: entry.isNew,
  activeParams: entry.activeParams,
  nonCommercial: entry.nonCommercial,
}));
// The bundled fallback: screens read it merged with the remote catalog (withRemoteCatalog('text', …)).
registerBundledCatalog('text', RECOMMENDED_MODELS);

// Trending model families — one best-fit per family is shown as "trending"
export const TRENDING_FAMILIES: Record<string, string[]> = {
  minicpm5: ['openbmb/MiniCPM5-2B-GGUF'],
  gemma4: ['unsloth/gemma-4-E2B-it-GGUF', 'unsloth/gemma-4-E4B-it-GGUF'],
  qwen35: ['unsloth/Qwen3.5-0.8B-GGUF', 'unsloth/Qwen3.5-2B-GGUF', 'unsloth/Qwen3.5-9B-GGUF'],
};
// Flat list used for badge rendering
export const TRENDING_MODEL_IDS = Object.values(TRENDING_FAMILIES).flat();

// Model organization filter options
export const MODEL_ORGS = [
  { key: 'openbmb', label: 'OpenBMB' },
  { key: 'Qwen', label: 'Qwen' },
  { key: 'meta-llama', label: 'Llama' },
  { key: 'google', label: 'Google' },
  { key: 'microsoft', label: 'Microsoft' },
  { key: 'mistralai', label: 'Mistral' },
  { key: 'deepseek-ai', label: 'DeepSeek' },
  { key: 'HuggingFaceTB', label: 'HuggingFace' },
  { key: 'nvidia', label: 'NVIDIA' },
  { key: 'LiquidAI', label: 'Liquid AI' },
];

// Quantization levels and their properties
export const QUANTIZATION_INFO: Record<string, {
  bitsPerWeight: number;
  quality: string;
  description: string;
  recommended: boolean;
}> = {
  'Q2_K': { bitsPerWeight: 2.625, quality: 'Low', description: 'Extreme compression, noticeable quality loss', recommended: false },
  'Q3_K_S': { bitsPerWeight: 3.4375, quality: 'Low-Medium', description: 'High compression, some quality loss', recommended: false },
  'Q3_K_M': { bitsPerWeight: 3.4375, quality: 'Medium', description: 'Good compression with acceptable quality', recommended: false },
  'Q4_0': { bitsPerWeight: 4, quality: 'Medium', description: 'Basic 4-bit quantization', recommended: false },
  'Q4_K_S': { bitsPerWeight: 4.5, quality: 'Medium-Good', description: 'Good balance of size and quality', recommended: true },
  'Q4_K_M': { bitsPerWeight: 4.5, quality: 'Good', description: 'Optimal for mobile - best balance', recommended: true },
  'Q5_K_S': { bitsPerWeight: 5.5, quality: 'Good-High', description: 'Higher quality, larger size', recommended: false },
  'Q5_K_M': { bitsPerWeight: 5.5, quality: 'High', description: 'Near original quality', recommended: false },
  'Q6_K': { bitsPerWeight: 6.5, quality: 'Very High', description: 'Minimal quality loss', recommended: false },
  'Q8_0': { bitsPerWeight: 8, quality: 'Excellent', description: 'Best quality, largest size', recommended: false },
};
