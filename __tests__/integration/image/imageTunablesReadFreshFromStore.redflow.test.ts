/**
 * DEVICE 2026-07-14 — image Steps / cfg (guidance) were OFF BY ONE: change the value in Chat Settings,
 * and the NEXT generation still used the previous value; only the generation after picked it up. Image
 * SIZE applied immediately. Root cause: handleImageGenerationFn threaded steps/guidanceScale from
 * deps.settings — a React render snapshot that lags the store by one change — as explicit params, and
 * those params OVERRODE the service's fresh read. Width/height were never passed, so the service read
 * them fresh from useAppStore.getState() and were always current (why size worked and these didn't).
 *
 * This drives the REAL handleImageGenerationFn + REAL imageGenerationService + REAL localDreamGenerator
 * native mapping over the faked diffusion leaf, with a deliberately STALE deps.settings (imageSteps 8 /
 * guidance 7.5) while the STORE holds the fresh values (11 / 3.5). The tunables that reach native must be
 * the FRESH store values, exactly as size already does.
 *
 * RED before the fix: native received the stale deps values (8 / 7.5). GREEN: native receives 11 / 3.5.
 * Litmus — restore `steps: deps.settings.imageSteps` and this goes red.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { createONNXImageModel } from '../../utils/factories';

describe('image tunables read FRESH from the store, not a stale caller snapshot — device 2026-07-14', () => {
  it('steps + guidance reaching native are the current store values, not the (stale) deps.settings', async () => {
    const boundary = installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * 1024 ** 3, availBytes: 8 * 1024 ** 3 } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { handleImageGenerationFn } = require('../../../src/screens/ChatScreen/useChatGenerationActions');
    const { useAppStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // A downloaded + active image model (coreml = a non-empty dir on the in-memory disk).
    const imgModel = createONNXImageModel({ id: 'sd', name: 'SD', modelPath: '/models/sd', backend: 'coreml' });
    boundary.fs!.seedFile('/models/sd/model.mlmodelc', 8 * 1024 * 1024);

    // The STORE carries the FRESH tunables (what the user just set). Enhancement OFF so no text model
    // is needed; size is small so the run is quick. This is the single source the service must read.
    useAppStore.setState({
      downloadedImageModels: [imgModel],
      activeImageModelId: 'sd',
      settings: {
        ...useAppStore.getState().settings,
        imageSteps: 11, imageGuidanceScale: 3.5, imageWidth: 256, imageHeight: 256,
        enhanceImagePrompts: false,
      },
    });

    // deps.settings is a STALE snapshot — one change behind the store (the off-by-one window). If the
    // handler trusts it, native gets 8 / 7.5. It must NOT.
    const deps = {
      activeImageModel: imgModel,
      settings: { imageSteps: 8, imageGuidanceScale: 7.5 } as never,
      imageGenState: { error: null } as never,
      setAlertState: () => {},
      addMessage: () => ({} as never),
    };

    await handleImageGenerationFn(deps as never, { prompt: 'a fox in snow', conversationId: 'c1', skipUserMessage: true });

    // The REAL native generateImage ran once, and the params it received are the FRESH store values.
    await Promise.resolve();
    const calls = boundary.diffusion.calls.generateImage;
    expect(calls).toHaveLength(1);
    expect(calls[0].steps).toBe(11);          // RED before: 8 (stale deps snapshot)
    expect(calls[0].guidanceScale).toBe(3.5); // RED before: 7.5 (stale deps snapshot)
  });
});
