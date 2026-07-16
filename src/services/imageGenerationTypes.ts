/**
 * ImageGenerationService types + the pure phase predicate.
 *
 * Extracted from imageGenerationService.ts (behavior-neutral) so the service file
 * stays within the max-lines budget. imageGenerationService re-exports the public
 * symbols (ImageGenPhase, ImageGenerationState, isInFlight), so every existing
 * `import { ... } from './imageGenerationService'` keeps working unchanged.
 */
import { GeneratedImage } from '../types';

/**
 * Explicit lifecycle phase — the single source of truth for "what is image
 * generation doing right now". The UI projects this (it never assembles the
 * in-progress view from scattered flags), so the progress indicator can't flash
 * or desync: it's shown for exactly `enhancing | loading | generating | saving`
 * and hidden otherwise.
 */
export type ImageGenPhase =
  | 'idle'
  | 'enhancing'  // running the text model to enrich the prompt
  | 'loading'    // loading the image model into memory
  | 'generating' // diffusion steps running
  | 'saving'     // writing the result + adding the chat message
  | 'done'
  | 'error'
  | 'cancelled';

/** True while a generation is actively in flight (drives the progress indicator). */
export function isInFlight(phase: ImageGenPhase): boolean {
  return phase === 'enhancing' || phase === 'loading' || phase === 'generating' || phase === 'saving';
}

export interface ImageGenerationState {
  phase: ImageGenPhase;
  /** Derived from phase (isInFlight) — kept for back-compat with existing readers. */
  isGenerating: boolean;
  progress: { step: number; totalSteps: number } | null;
  status: string | null;
  previewPath: string | null;
  prompt: string | null;
  conversationId: string | null;
  error: string | null;
  result: GeneratedImage | null;
}

export type ImageGenerationListener = (state: ImageGenerationState) => void;

export interface GenerateImageParams {
  prompt: string;
  conversationId?: string;
  negativePrompt?: string;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  previewInterval?: number;
}

export interface ActiveImageModel {
  id: string;
  name: string;
  modelPath: string;
  backend?: string;
}

export interface RunGenerationOptions {
  params: GenerateImageParams;
  enhancedPrompt: string;
  activeImageModel: ActiveImageModel;
  steps: number;
  guidanceScale: number;
  imageWidth: number;
  imageHeight: number;
  useOpenCL: boolean;
}

export interface UpdateEnhancementOptions {
  conversationId: string | undefined;
  tempMessageId: string | null;
  enhancedPrompt: string;
  originalPrompt: string;
}
