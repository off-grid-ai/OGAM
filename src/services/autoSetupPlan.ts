import type { ModelEntry } from '@offgrid/models';
import type { PickSlot } from './devicePicks';
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
  /** The phone's pick slot this chat model fills (Fast, Balanced or Best), or the starter: the
   *  best model under 1 GB, which a new person gets first. */
  pick?: PickSlot | 'starter';
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
  /** No video model runs on this phone, but videos can be made on a paired computer. */
  videoOnComputer?: boolean;
  embedding?: AutoSetupCandidate<AutoSetupEmbeddingModel>;
}

export type AutoSetupItem = AutoSetupPlan['items'][number] | NonNullable<AutoSetupPlan['embedding']>;

export interface AutoSetupCompatibleCatalog {
  video?: AutoSetupCandidate<ModelEntry>[];
  videoExclusionReason?: string;
  videoOnComputer?: boolean;
  embedding?: AutoSetupCandidate<AutoSetupEmbeddingModel>[];
  text: AutoSetupCandidate<{ modelId: string; file: ModelFile }>[];
  image: AutoSetupCandidate<ImageModelDescriptor>[];
  stt: AutoSetupCandidate<{ modelId: string }>[];
}

const PLAN_COPY: Record<
  AutoSetupTier,
  Pick<AutoSetupPlan, 'title' | 'summary'>
> = {
  lean: { title: 'Quick start', summary: 'A small model that is ready in minutes. Add bigger ones any time.' },
  balanced: { title: 'Balanced', summary: 'A comfortable fit for this phone.' },
  extreme: {
    title: 'Extreme',
    summary: 'The most this phone can run.',
  },
};

/** Each plan's chat model is one of the phone's picks, by the shared rule over the catalog pool. */
const TEXT_PICK: Record<AutoSetupTier, PickSlot | 'starter'> = {
  lean: 'starter',
  balanced: 'balanced',
  extreme: 'best',
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
  // A phone with no starter-sized model that runs well falls back to its Fast pick.
  return candidates.find(candidate => candidate.pick === TEXT_PICK[tier])
    ?? (tier === 'lean' ? candidates.find(candidate => candidate.pick === 'fast') ?? null : null);
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
    ...(video ? {} : {
      videoExclusionReason: catalog.videoExclusionReason,
      ...(catalog.videoOnComputer ? { videoOnComputer: true } : {}),
    }),
  };
}

export function selectAutoSetupPlans(
  catalog: AutoSetupCompatibleCatalog,
): AutoSetupPlan[] {
  const plans = (['lean', 'balanced', 'extreme'] as const)
    .map(tier => selectAutoSetupPlan(tier, catalog))
    .filter((plan): plan is AutoSetupPlan => plan !== null);
  // Quick start is the default, so it always stays. Extreme is the device's limit, offered unless it
  // would repeat Quick start's model (a small phone whose best model is under 1 GB): then Quick start
  // stands for both. Balanced needs a chat model of its own.
  const lean = plans.find(plan => plan.tier === 'lean');
  const extreme = plans.find(plan => plan.tier === 'extreme');
  const sameModel = (a: AutoSetupPlan, b: AutoSetupPlan | undefined): boolean => !!b && a.items[0].id === b.items[0].id;
  return plans.filter(plan => {
    if (plan.tier === 'lean') return true;
    if (plan.tier === 'extreme') return !sameModel(plan, lean);
    return !sameModel(plan, lean) && !sameModel(plan, extreme);
  });
}
