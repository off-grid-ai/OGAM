import {
  isImageApplicationInFlight,
  type ImageApplicationSnapshot,
} from '@offgrid/models';
import type { GeneratedImage } from '../types';
import logger from '../utils/logger';
import { imagePhaseTransitionLog } from './imageGenerationHelpers';
import {
  type GenerateImageParams,
  type ImageGenerationListener,
  type ImageGenerationState,
} from './imageGenerationTypes';
import { imageGenerationApplication } from './composition/image';

export { isInFlight } from './imageGenerationTypes';
export type { ImageGenPhase, ImageGenerationState } from './imageGenerationTypes';

function project(snapshot: ImageApplicationSnapshot<GeneratedImage>): ImageGenerationState {
  return {
    phase: snapshot.phase,
    isGenerating: isImageApplicationInFlight(snapshot.phase),
    progress: snapshot.progress && {
      step: snapshot.progress.step,
      totalSteps: snapshot.progress.totalSteps,
    },
    status: snapshot.status,
    previewPath: snapshot.previewUri,
    prompt: snapshot.prompt,
    conversationId: snapshot.conversationId,
    messageId: snapshot.messageId,
    error: snapshot.error,
    result: snapshot.result,
  };
}

class ImageGenerationService {
  private application: ReturnType<typeof imageGenerationApplication> | null = null;
  private readonly listeners = new Set<ImageGenerationListener>();
  private previousPhase: ImageGenerationState['phase'] = 'idle';

  /** Resolve the facade seam only after the composition root has registered it. */
  private ensureApplication(): ReturnType<typeof imageGenerationApplication> {
    if (this.application) return this.application;
    const application = imageGenerationApplication();
    application.onChange(snapshot => {
      const state = project(snapshot);
      if (state.phase !== this.previousPhase) {
        logger.log(imagePhaseTransitionLog(this.previousPhase, state));
        this.previousPhase = state.phase;
      }
      // One native event, one atomic projection update: `state` is a whole new immutable
      // snapshot handed to every subscriber. Nothing here writes the app store - the phase,
      // progress, status and preview are transient, only this projection owns them, and mirroring
      // them into the persisted store notified every unrelated app-store subscriber (the chat
      // screen subscribes to the whole store) and re-serialised the generated-image gallery on
      // every diffusion step.
      for (const listener of this.listeners) listener(state);
    });
    this.application = application;
    return application;
  }

  getState(): ImageGenerationState {
    return project(this.ensureApplication().status());
  }

  isGeneratingFor(conversationId: string): boolean {
    const state = this.getState();
    return state.isGenerating && state.conversationId === conversationId;
  }

  subscribe(listener: ImageGenerationListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  generateImage(
    params: GenerateImageParams,
    opts?: { override?: boolean },
  ): Promise<GeneratedImage | null> {
    return this.ensureApplication().start(params, { force: opts?.override });
  }

  async cancelGeneration(): Promise<void> {
    await this.ensureApplication().cancel();
  }
}

export const imageGenerationService = new ImageGenerationService();
