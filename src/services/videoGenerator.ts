import { NativeEventEmitter, NativeModules } from 'react-native';
import type {
  ResolvedVideoRequest,
  VideoGenerationUpdateContract,
} from '@offgrid/models';
const native = NativeModules.VideoGenerationModule;
export const videoGenerator = {
  available: () => !!native,
  cancel: async (): Promise<void> => {
    if (native) await native.cancel();
  },
  async generate(
    request: ResolvedVideoRequest,
    pack: { weight: string; vae: string; encoder: string },
    outputPath: string,
    onUpdate: (update: VideoGenerationUpdateContract) => void,
  ): Promise<string> {
    if (!native)
      throw new Error('This build does not include the video engine.');
    const listener = new NativeEventEmitter(native).addListener(
      'VideoGenerationProgress',
      event => {
        onUpdate({
          stage: event.stage,
          progress:
            event.total > 0 ? { step: event.step, total: event.total } : null,
        });
      },
    );
    try {
      return (await native.generate({ ...request, ...pack, outputPath })).path;
    } finally {
      listener.remove();
    }
  },
};
