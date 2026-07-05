import { CREDIBILITY_LABELS } from '../../constants';
import {
  BackendFilter,
  CredibilityFilter,
  FilterState,
  ModelTypeFilter,
  SizeFilter,
  SortOption,
} from './types';

export const VISION_PIPELINE_TAG = 'image-text-to-text';
export const CODE_FALLBACK_QUERY = 'coder';

export const CREDIBILITY_OPTIONS: { key: CredibilityFilter; label: string; color?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'lmstudio', label: 'LM Studio', color: CREDIBILITY_LABELS.lmstudio.color },
  { key: 'official', label: 'Official', color: CREDIBILITY_LABELS.official.color },
  { key: 'verified-quantizer', label: 'Verified', color: CREDIBILITY_LABELS['verified-quantizer'].color },
  { key: 'community', label: 'Community', color: CREDIBILITY_LABELS.community.color },
];

export const MODEL_TYPE_OPTIONS: { key: ModelTypeFilter; label: string }[] = [
  { key: 'all', label: 'All Types' },
  { key: 'text', label: 'Text' },
  { key: 'vision', label: 'Vision' },
  { key: 'code', label: 'Code' },
];

export const SIZE_OPTIONS: { key: SizeFilter; label: string; min: number; max: number }[] = [
  { key: 'all', label: 'All Sizes', min: 0, max: Infinity },
  { key: 'tiny', label: '< 1B', min: 0, max: 1 },
  { key: 'small', label: '1-3B', min: 1, max: 3 },
  { key: 'medium', label: '3-8B', min: 3, max: 8 },
  { key: 'large', label: '8B+', min: 8, max: Infinity },
];

export const QUANT_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'Q4_K_M', label: 'Q4_K_M' },
  { key: 'Q4_K_S', label: 'Q4_K_S' },
  { key: 'Q5_K_M', label: 'Q5_K_M' },
  { key: 'Q6_K', label: 'Q6_K' },
  { key: 'Q8_0', label: 'Q8_0' },
];

export const STYLE_OPTIONS = [
  { key: 'all', label: 'All Styles' },
  { key: 'photorealistic', label: 'Realistic' },
  { key: 'anime', label: 'Anime' },
];

export const SD_VERSION_OPTIONS = [
  { key: 'all', label: 'All Versions' },
  { key: 'sd15', label: 'SD 1.5' },
  { key: 'sd21', label: 'SD 2.1' },
  { key: 'sdxl', label: 'SDXL' },
];

export const BACKEND_OPTIONS: { key: BackendFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mnn', label: 'MNN' },
  { key: 'qnn', label: 'NPU' },
];

export const SORT_OPTIONS: { key: SortOption; label: string; icon: string }[] = [
  { key: 'recommended', label: 'Smart', icon: 'zap' },
  { key: 'bestfit', label: 'For You', icon: 'smartphone' },
  { key: 'size', label: 'Size', icon: 'database' },
  { key: 'downloads', label: 'Downloads', icon: 'download' },
  { key: 'recency', label: 'Newest', icon: 'clock' },
];

export const initialFilterState: FilterState = {
  orgs: [],
  type: 'all',
  source: 'all',
  size: 'all',
  quant: 'all',
  sort: 'recommended',
  expandedDimension: null,
};
