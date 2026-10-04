/**
 * ImageGenerationService types + the pure phase predicate.
 *
 * Extracted from imageGenerationService.ts (behavior-neutral) so the service file
 * stays within the max-lines budget. imageGenerationService re-exports the public
 * symbols (ImageGenPhase, ImageGenerationState, isInFlight), so every existing
 * `import { ... } from './imageGenerationService'` keeps working unchanged.
 */
import {
  isImageApplicationInFlight,
  type ImageApplicationPhase,
  type ImageApplicationRequest,
} from '@offgrid/models';
import { GeneratedImage } from '../types';

/**
 * Explicit lifecycle phase — the single source of truth for "what is image
 * generation doing right now". The UI projects this (it never assembles the
 * in-progress view from scattered flags), so the progress indicator can't flash
 * or desync: it's shown for exactly `enhancing | loading | generating | saving`
 * and hidden otherwise.
 */
export type ImageGenPhase = ImageApplicationPhase;

/** True while a generation is actively in flight (drives the progress indicator). */
export const isInFlight = isImageApplicationInFlight;

export interface ImageGenerationState {
  phase: ImageGenPhase;
  /** Derived from phase (isInFlight) — kept for back-compat with existing readers. */
  isGenerating: boolean;
  progress: { step: number; totalSteps: number } | null;
  status: string | null;
  previewPath: string | null;
  prompt: string | null;
  conversationId: string | null;
  /** Stable id for the assistant message this live image turn will create. */
  messageId: string | null;
  error: string | null;
  result: GeneratedImage | null;
}

export type ImageGenerationListener = (state: ImageGenerationState) => void;

export interface GenerateImageParams extends ImageApplicationRequest {}

export interface ActiveImageModel {
  id: string;
  name: string;
  modelPath: string;
  backend?: string;
}
