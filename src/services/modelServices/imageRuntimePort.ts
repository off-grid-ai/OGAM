import { localDreamGeneratorService } from '../localDreamGenerator';

/** Image-runtime maintenance boundary. Hooks dispatch an intent and never import the engine. */
export const mobileImageRuntime = {
  clearGpuCache: (modelPath: string) => localDreamGeneratorService.clearOpenCLCache(modelPath),
};
