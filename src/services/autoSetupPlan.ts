import type { ModelEntry } from '@offgrid/models';
import type { ModelFile } from '../types';
import type { ImageModelDescriptor } from './imageModelDownloadTypes';

export type AutoSetupTier = 'lean' | 'balanced' | 'extreme';
export type AutoSetupModelKind = 'text' | 'image' | 'stt' | 'video' | 'embedding';

export interface AutoSetupEmbeddingModel {
  id: string;
  name: string;
  size: number;
  downloadUrl?: string;
  sha256?: string;
  description?: string;
}

interface AutoSetupCandidate<T = unknown> {
  id: string;
  name: string;
  kind: AutoSetupModelKind;
  sizeBytes: number;
  fitScore: number;
  parameterCountB?: number;
  payload: T;
}

export interface AutoSetupPlan {
  tier: AutoSetupTier;
  title: string;
  summary: string;
  items: readonly [
    AutoSetupCandidate<{ modelId: string; file: ModelFile }>,
    AutoSetupCandidate<ImageModelDescriptor>,
    AutoSetupCandidate<{ modelId: string }>,
    ...AutoSetupCandidate<ModelEntry>[],
  ];
  totalBytes: number;
  videoExclusionReason?: string;
  embedding?: AutoSetupCandidate<AutoSetupEmbeddingModel>;
}

export type AutoSetupItem = AutoSetupPlan['items'][number] | NonNullable<AutoSetupPlan['embedding']>;

export interface AutoSetupCompatibleCatalog {
  video?: AutoSetupCandidate<ModelEntry>[];
  videoExclusionReason?: string;
  embedding?: AutoSetupCandidate<AutoSetupEmbeddingModel>[];
  text: AutoSetupCandidate<{ modelId: string; file: ModelFile }>[];
  image: AutoSetupCandidate<ImageModelDescriptor>[];
  stt: AutoSetupCandidate<{ modelId: string }>[];
}

const PLAN_COPY: Record<
  AutoSetupTier,
  Pick<AutoSetupPlan, 'title' | 'summary'>
> = {
  lean: { title: 'Lean', summary: 'Smaller model downloads.' },
  balanced: { title: 'Balanced', summary: 'Models near the middle of each list.' },
  extreme: {
    title: 'Extreme',
    summary: 'Largest model downloads.',
  },
};

const AUTO_SETUP_TEXT_TARGET_BILLIONS: Record<AutoSetupTier, number> = {
  lean: 2,
  balanced: 4,
  extreme: 9,
};

function choose<T>(
  tier: AutoSetupTier,
  candidates: AutoSetupCandidate<T>[],
): AutoSetupCandidate<T> | null {
  if (candidates.length === 0) return null;
  if (tier === 'balanced')
    return [...candidates].sort((a, b) => a.fitScore - b.fitScore)[0];
  const bySize = [...candidates].sort((a, b) => a.sizeBytes - b.sizeBytes);
  if (tier === 'lean') return bySize[0];
  return bySize.at(-1) ?? null;
}

function chooseText(
  tier: AutoSetupTier,
  candidates: AutoSetupCompatibleCatalog['text'],
): AutoSetupCompatibleCatalog['text'][number] | null {
  if (candidates.length === 0) return null;
  if (tier === 'lean') {
    const qwen2b = candidates.find(candidate =>
      candidate.id.startsWith('unsloth/Qwen3.5-2B-GGUF/'),
    );
    if (qwen2b) return qwen2b;
  }
  const target = AUTO_SETUP_TEXT_TARGET_BILLIONS[tier];
  return [...candidates].sort((a, b) => {
    const aDistance = Math.abs((a.parameterCountB ?? 0) - target);
    const bDistance = Math.abs((b.parameterCountB ?? 0) - target);
    return (
      aDistance - bDistance ||
      a.fitScore - b.fitScore ||
      a.sizeBytes - b.sizeBytes
    );
  })[0];
}

/** Pure plan selector. Its input contains only candidates admitted by existing compatibility owners. */
function selectAutoSetupPlan(
  tier: AutoSetupTier,
  catalog: AutoSetupCompatibleCatalog,
): AutoSetupPlan | null {
  const text = chooseText(tier, catalog.text);
  const selectedImage = choose(tier, catalog.image);
  const androidImagePreference = tier === 'lean' ? /anything[\s_-]*v5/i
    : tier === 'balanced' ? /absolute[\s_-]*reality/i
    : /dream[\s_-]*shaper[\s_-]*v8/i;
  const preferredImage = androidImagePreference && selectedImage?.payload.backend !== 'coreml'
    ? catalog.image.find(candidate =>
        candidate.payload.backend === selectedImage?.payload.backend &&
        androidImagePreference.test(candidate.name),
      )
    : null;
  const image =
    preferredImage ?? (selectedImage && /nai[\s_-]*anime/i.test(selectedImage.name)
      ? catalog.image.find(
          candidate =>
            candidate.payload.backend === selectedImage.payload.backend &&
            /absolute[\s_-]*reality/i.test(candidate.name),
        ) ?? selectedImage
      : selectedImage);
  const stt = choose(tier, catalog.stt);
  if (!text || !image || !stt) return null;
  const video = choose(tier, catalog.video ?? []);
  const embedding = choose(tier, catalog.embedding ?? []);
  const items: AutoSetupPlan['items'] = [text, image, stt, ...(video ? [video] : [])];
  return {
    tier,
    ...PLAN_COPY[tier],
    items,
    totalBytes: items.reduce((total, item) => total + item.sizeBytes, embedding?.sizeBytes ?? 0),
    ...(embedding ? { embedding } : {}),
    ...(video ? {} : { videoExclusionReason: catalog.videoExclusionReason }),
  };
}

export function selectAutoSetupPlans(
  catalog: AutoSetupCompatibleCatalog,
): AutoSetupPlan[] {
  return (['lean', 'balanced', 'extreme'] as const)
    .map(tier => selectAutoSetupPlan(tier, catalog))
    .filter((plan): plan is AutoSetupPlan => plan !== null);
}
