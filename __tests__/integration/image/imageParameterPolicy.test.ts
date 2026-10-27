import { standardImageModelDefaults } from '@offgrid/models';
import { resolveMobileImageParameters } from '../../../src/services/imageParameterPolicy';

describe('shared image parameter policy at the Mobile generation boundary', () => {
  const model = {
    id: 'dreamshaper-xl-v2-turbo',
    name: 'DreamShaper XL v2 Turbo',
  };

  it('an sd.cpp model uses its own values, not the native engines\' global ones', () => {
    const lightning = { id: 'realvisxl-lightning', name: 'RealVisXL v5.0 Lightning (Light)', backend: 'sd' };
    const global = { imageSteps: 50, imageGuidanceScale: 7.5, imageWidth: 512 };
    // Its shared defaults (a few-step Lightning model, as on Desktop), however the global steps are set.
    const own = standardImageModelDefaults(lightning.name);
    expect(own.fewStep).toBe(true);
    expect(resolveMobileImageParameters(lightning, global)).toEqual({
      steps: own.defaultSteps,
      guidanceScale: own.defaultCfg,
      size: own.defaultSize,
    });
    expect(own.defaultSteps).toBeLessThan(global.imageSteps);
    // Its own override, when the person set one for it.
    expect(
      resolveMobileImageParameters(lightning, {
        ...global,
        imageParameterOverrides: { [lightning.id]: { steps: 6, cfgScale: 3, size: 512 } },
      }),
    ).toEqual({ steps: 6, guidanceScale: 3, size: 512 });
  });

  it('keeps a native image pack within its fixed 512 size', () => {
    expect(
      resolveMobileImageParameters({ ...model, backend: 'mnn' }, {
        imageSteps: 42,
        imageGuidanceScale: 5.5,
        imageWidth: 768,
      }),
    ).toEqual({ steps: 42, guidanceScale: 5.5, size: 512 });
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
