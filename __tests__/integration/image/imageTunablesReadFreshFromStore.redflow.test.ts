/**
 * DEVICE 2026-07-14 — image Steps / cfg (guidance) were OFF BY ONE: change the value in Chat Settings,
 * and the NEXT generation still used the previous value; only the generation after picked it up. Image
 * SIZE applied immediately. Root cause: handleImageGenerationFn threaded steps/guidanceScale from
 * deps.settings — a React render snapshot that lags the store by one change — as explicit params, and
 * those params OVERRODE the service's fresh read. Width/height were never passed, so the service read
 * them fresh from useAppStore.getState() and were always current (why size worked and these didn't).
 *
 * This drives the REAL public imageGenerationService + Shared image application service + REAL
 * localDreamGenerator native mapping over the faked diffusion leaf. The Shared-backed application port
 * must read the current store when the operation starts; no removed React callback or render snapshot is
 * part of the image-generation contract.
 *
 * RED before the original fix: native received a stale render value (8 / 7.5). GREEN: native receives
 * 11 / 3.5. If the application port captures settings before this operation starts, this test goes red.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { createONNXImageModel } from '../../utils/factories';

let applicationFixture:
  | import('../../harness/mobileApplicationFixture').MobileApplicationFixture
  | undefined;

afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = undefined;
});

describe('image tunables read FRESH from the store, not a stale caller snapshot — device 2026-07-14', () => {
  it('steps + guidance reaching native are the current store values, not the (stale) deps.settings', async () => {
    const boundary = installNativeBoundary({
      fs: true,
      ram: {
        platform: 'android',
        totalBytes: 12 * 1024 ** 3,
        availBytes: 8 * 1024 ** 3,
      },
    });

    const { useAppStore } = require('../../../src/stores');
    await useAppStore.persist.rehydrate();

    // A downloaded + active image model (coreml = a non-empty dir on the in-memory disk).
    const imgModel = createONNXImageModel({
      id: 'sd',
      name: 'SD',
      modelPath: '/models/sd',
      backend: 'coreml',
    });
    boundary.fs!.seedFile('/models/sd/model.mlmodelc', 8 * 1024 * 1024);

    // The STORE carries the FRESH tunables (what the user just set). Enhancement OFF so no text model
    // is needed; size is small so the run is quick. This is the single source the service must read.
    useAppStore.setState({
      downloadedImageModels: [imgModel],

      settings: {
        ...useAppStore.getState().settings,
        imageSteps: 11,
        imageGuidanceScale: 3.5,
        imageWidth: 256,
        imageHeight: 256,
        enhanceImagePrompts: false,
      },
    });
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    applicationFixture = await startMobileApplicationFixture();
    await applicationFixture.refreshModels();
    const routeId = applicationFixture.application.models.resolveRoute(
      'image',
      'sd',
    );
    expect(routeId).not.toBeNull();
    const selected = await applicationFixture.application.models.select({
      modality: 'image',
      modelId: routeId,
    });
    expect(selected.ok).toBe(true);
    expect(useAppStore.getState().settings.imageSteps).toBe(11);
    expect(useAppStore.getState().settings.imageGuidanceScale).toBe(3.5);

    const {
      imageGenerationService,
    } = require('../../../src/services/imageGenerationService');
    await imageGenerationService.generateImage({ prompt: 'a fox in snow' });

    // The REAL native generateImage ran once, and the params it received are the FRESH store values.
    await Promise.resolve();
    const calls = boundary.diffusion.calls.generateImage;
    expect(calls.length).toBe(1);
    expect(calls[0].steps).toBe(11); // RED before: 8 (stale deps snapshot)
    expect(calls[0].guidanceScale).toBe(3.5); // RED before: 7.5 (stale deps snapshot)
  });
});
