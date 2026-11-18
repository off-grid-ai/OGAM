/**
 * What onboarding's picks change on the phone. The groups, features and rules live in
 * @offgrid/features; this file maps them onto the phone's own setup, screens and Home.
 */
import {
  guideTopicsFor,
  modelKindsFor,
  type ModelKind,
  type Picks,
} from '@offgrid/features';
import type { AutoSetupModelKind } from './autoSetupPlan';

export const PICKS_PLATFORM = 'mobile' as const;

/** Which setup row each kind of model a feature needs is. Voice is Kokoro, set up by its feature. */
const SETUP_KIND: Partial<Record<ModelKind, AutoSetupModelKind>> = {
  chat: 'text',
  vision: 'text',
  image: 'image',
  speech: 'stt',
  video: 'video',
};

/**
 * The models setup checks for the picks: the chat model, plus what each picked feature needs (a
 * Pro feature only with Pro). No picks checks the chat model alone, as setup always did.
 */
export function setupKindsForPicks(
  picks: Picks | null,
  pro: boolean,
): AutoSetupModelKind[] {
  if (!picks) return ['text'];
  const kinds = modelKindsFor(picks.parts, PICKS_PLATFORM, pro)
    .map(kind => SETUP_KIND[kind])
    .filter((kind): kind is AutoSetupModelKind => Boolean(kind));
  return [...new Set<AutoSetupModelKind>(['text', ...kinds])];
}

/** The guide topics the picks show, in pick order, each once. */
export function pickedTopics(picks: Picks | null): string[] {
  return picks ? guideTopicsFor(picks.parts, PICKS_PLATFORM) : [];
}
