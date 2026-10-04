// Composition root: the second generation queue (voice) and the sidecar classifier. Neither holds
// the ModelWorkspace any more - both are facade seams.
//
// The lane is a facade property, so there is nothing left to build once. It is still ONE lane per
// app root by construction: shared owns it, and an app cannot get a second by asking twice.
import { applicationFacade } from '../applicationFacade';

/** Voice has its own queue so sentence playback can run while text is still streaming. */
export const mobileVoiceGenerationService = () =>
  applicationFacade().models.voiceLane;

export const classifierExecution = () =>
  applicationFacade().models.classification;
