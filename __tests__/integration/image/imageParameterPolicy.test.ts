import { resolveMobileImageParameters } from '../../../src/services/imageParameterPolicy';

describe('shared image parameter policy at the Mobile generation boundary', () => {
  const model = {
    id: 'dreamshaper-xl-v2-turbo',
    name: 'DreamShaper XL v2 Turbo',
  };

  it('uses current settings for both local and remote callers', () => {
    expect(
      resolveMobileImageParameters(model, {
        imageSteps: 42,
        imageGuidanceScale: 5.5,
        imageWidth: 768,
      }),
    ).toEqual({ steps: 42, guidanceScale: 5.5, size: 768 });
  });

  it('lets an explicit request win and falls back from damaged persisted values', () => {
    expect(
      resolveMobileImageParameters(
        model,
        { imageSteps: 0, imageGuidanceScale: Number.NaN, imageWidth: 64 },
        { steps: 12, guidanceScale: 4 },
      ),
    ).toEqual({ steps: 12, guidanceScale: 4, size: 256 });
  });
});
