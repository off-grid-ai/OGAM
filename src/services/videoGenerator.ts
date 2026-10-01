import logger from '../utils/logger';
import { NativeEventEmitter, NativeModules } from 'react-native';
import { videoArchitecture } from '@offgrid/models';
import type {
  ResolvedVideoRequest,
  VideoModelPack,
  VideoGenerationUpdateContract,
} from '@offgrid/models';
const native = NativeModules.VideoGenerationModule;
type NativeVideoStatus = {
  path: string;
  phase: 'running' | 'succeeded' | 'failed';
  stage: VideoGenerationUpdateContract['stage'];
  step: number;
  total: number;
  backend?: VideoGenerationUpdateContract['backend'];
  preview?: VideoGenerationUpdateContract['preview'];
  code?: string;
  error?: string;
};
export const videoGenerator = {
  available: () => !!native,
  async getStatus(outputPath: string): Promise<NativeVideoStatus | null> {
    return native?.getVideoStatus ? native.getVideoStatus(outputPath) : null;
  },
  async recover(
    request: ResolvedVideoRequest,
    outputPath: string,
    onUpdate: (update: VideoGenerationUpdateContract) => void,
  ): Promise<string> {
    for (;;) {
      const status = await videoGenerator.getStatus(outputPath);
      if (!status) throw new Error('The native video job is no longer available.');
      if (status.stage !== 'generating' || status.total === request.steps) onUpdate({
        stage: status.stage,
        backend: status.backend ?? null,
        progress: status.total > 0 ? { step: status.step, total: status.total } : null,
        ...(status.preview?.path === `${outputPath}.preview.png` ? { preview: status.preview } : {}),
      });
      if (status.phase === 'succeeded') return status.path;
      if (status.phase === 'failed') {
        throw Object.assign(new Error(status.error ?? 'Video generation failed.'), { code: status.code });
      }
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }
  },
  cancel: async (): Promise<void> => {
    if (native) await native.cancel();
  },
  async generate(
    request: ResolvedVideoRequest,
    pack: VideoModelPack,
    outputPath: string,
    onUpdate: (update: VideoGenerationUpdateContract) => void,
    onInterrupted?: (reason: string) => void,
    diagnosticBackend?: 'auto' | 'gpu' | 'cpu',
  ): Promise<string> {
    if (!native)
      throw new Error('This build does not include the video engine.');
    // Step zero marks the start of sampling, before the first step completes.
    let lastStep = -1;
    let lastProgress = '';
    const listener = new NativeEventEmitter(native).addListener(
      'VideoGenerationProgress',
      event => {
        if (typeof event.lifecycle === 'string') {
          logger.log('[VideoLifecycle]', event.at, event.lifecycle);
          return;
        }
        if (typeof event.interruption === 'string') {
          logger.warn('[VideoLifecycle] interrupted', event.interruption);
          onInterrupted?.(event.interruption);
          return;
        }
        // sd.cpp also sends tensor-loading and VAE tile counters through this
        // callback. Only sampling steps belong in the generation step count.
        if (event.stage === 'generating') {
          if (
            event.total !== request.steps ||
            event.step <= lastStep ||
            event.step > request.steps
          )
            return;
          lastStep = event.step;
        }
        const progressKey = `${event.stage}:${event.step}:${event.total}`;
        if (progressKey !== lastProgress) {
          lastProgress = progressKey;
          logger.log('[VideoProgress]', {
            stage: event.stage, step: event.step, total: event.total,
          });
        }
        onUpdate({
          stage: event.stage,
          backend: event.backend ?? null,
          ...(event.preview &&
          event.preview.path === `${outputPath}.preview.png` &&
          Number.isFinite(event.preview.width) && event.preview.width > 0 &&
          Number.isFinite(event.preview.height) && event.preview.height > 0
            ? { preview: event.preview }
            : {}),
          progress:
            event.total > 0 ? { step: event.step, total: event.total } : null,
        });
      },
    );
    try {
      return (
        await native.generate({
          ...request,
          ...pack,
          outputPath,
          ...(__DEV__ && diagnosticBackend ? { diagnosticBackend } : {}),
          flowShift: videoArchitecture(pack.weight)?.startsWith('wan') ? 3 : 0,
        })
      ).path;
    } finally {
      listener.remove();
    }
  },
};
