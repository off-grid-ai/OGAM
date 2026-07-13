/**
 * getImageGenAdvice — the GPU-path (mnn) speed/quality guidance rule. Only the mnn path
 * gets advice (NPU/CoreML are fast + fixed-shape). Encodes the on-device reality:
 *  - <20 steps looks muddy,
 *  - >256 is very slow on a mid-tier GPU,
 *  - <256 is GARBAGE (SD1.5 below training res), not just smaller.
 */
import { getImageGenAdvice, QUALITY_STEP_FLOOR, SWEET_SPOT_SIZE } from '../../../src/utils/imageGenAdvice';

describe('getImageGenAdvice', () => {
  it('gives NO advice for the NPU (qnn) path', () => {
    expect(getImageGenAdvice({ backend: 'qnn', steps: 8, width: 512 })).toEqual({
      show: false, raiseSteps: false, lowerSize: false, raiseSize: false,
    });
  });

  it('gives NO advice for CoreML (iOS ANE)', () => {
    expect(getImageGenAdvice({ backend: 'coreml', steps: 4, width: 128 }).show).toBe(false);
  });

  it('recommends raising steps on the GPU path when below the quality floor', () => {
    const a = getImageGenAdvice({ backend: 'mnn', steps: QUALITY_STEP_FLOOR - 1, width: SWEET_SPOT_SIZE });
    expect(a.raiseSteps).toBe(true);
    expect(a.show).toBe(true);
  });

  it('does not nag about steps at/above the quality floor', () => {
    expect(getImageGenAdvice({ backend: 'mnn', steps: QUALITY_STEP_FLOOR, width: SWEET_SPOT_SIZE }).raiseSteps).toBe(false);
  });

  it('recommends LOWERING size for speed when above the sweet spot', () => {
    const a = getImageGenAdvice({ backend: 'mnn', steps: 22, width: 512 });
    expect(a.lowerSize).toBe(true);
    expect(a.raiseSize).toBe(false);
    expect(a.show).toBe(true);
  });

  it('recommends RAISING size when below 256 (garbage, not "smaller") — the 128 case', () => {
    const a = getImageGenAdvice({ backend: 'mnn', steps: 22, width: 128 });
    expect(a.raiseSize).toBe(true);
    expect(a.lowerSize).toBe(false);
    expect(a.show).toBe(true);
  });

  it('is quiet at the sweet spot (256, >=20 steps)', () => {
    expect(getImageGenAdvice({ backend: 'mnn', steps: 22, width: SWEET_SPOT_SIZE })).toEqual({
      show: false, raiseSteps: false, lowerSize: false, raiseSize: false,
    });
  });

  it('a zero/unknown width does not falsely trigger raiseSize', () => {
    expect(getImageGenAdvice({ backend: 'mnn', steps: 22, width: 0 }).raiseSize).toBe(false);
  });
});
