/**
 * Unit tests for the PURE backend resolver. No IO, no store — just the
 * capability -> backend mapping, all branches.
 */
import {
  resolveDefaultBackend,
  resolveDefaultLiteRTBackend,
} from '../../../src/services/backendResolver';
import { INFERENCE_BACKENDS } from '../../../src/types';

describe('resolveDefaultBackend', () => {
  it('iOS always defaults to Metal (OpenCL flag irrelevant)', () => {
    expect(resolveDefaultBackend({ platform: 'ios', openCLSupported: true })).toBe(
      INFERENCE_BACKENDS.METAL,
    );
    expect(resolveDefaultBackend({ platform: 'ios', openCLSupported: false })).toBe(
      INFERENCE_BACKENDS.METAL,
    );
  });

  it('Android with OpenCL support defaults to OpenCL (GPU)', () => {
    expect(
      resolveDefaultBackend({ platform: 'android', openCLSupported: true }),
    ).toBe(INFERENCE_BACKENDS.OPENCL);
  });

  it('Android without OpenCL support defaults to CPU', () => {
    expect(
      resolveDefaultBackend({ platform: 'android', openCLSupported: false }),
    ).toBe(INFERENCE_BACKENDS.CPU);
  });

  it('Android flagship Qualcomm NPU (8gen2/8gen1) defaults to NPU/HTP', () => {
    expect(
      resolveDefaultBackend({ platform: 'android', openCLSupported: true, npuSupported: true, npuVariant: '8gen2' }),
    ).toBe(INFERENCE_BACKENDS.HTP);
    expect(
      resolveDefaultBackend({ platform: 'android', openCLSupported: true, npuSupported: true, npuVariant: '8gen1' }),
    ).toBe(INFERENCE_BACKENDS.HTP);
  });

  it("Android non-flagship NPU ('min', e.g. SM8635) does NOT auto-default to NPU — GPU instead", () => {
    // NPU stays user-selectable in the UI, but auto-defaulting the beta NPU to every
    // Snapdragon is a risk we don't take; GPU is the safe auto-default here.
    expect(
      resolveDefaultBackend({ platform: 'android', openCLSupported: true, npuSupported: true, npuVariant: 'min' }),
    ).toBe(INFERENCE_BACKENDS.OPENCL);
  });

  it('non-Qualcomm chips (npuSupported false) never get NPU — GPU when Mali/OpenCL', () => {
    // MediaTek/Exynos/Tensor: hasNPU is false (Qualcomm-only), Mali → OpenCL.
    expect(
      resolveDefaultBackend({ platform: 'android', openCLSupported: true, npuSupported: false }),
    ).toBe(INFERENCE_BACKENDS.OPENCL);
  });

  it('iOS ignores NPU flags and stays Metal', () => {
    expect(
      resolveDefaultBackend({ platform: 'ios', openCLSupported: true, npuSupported: true, npuVariant: '8gen2' }),
    ).toBe(INFERENCE_BACKENDS.METAL);
  });
});

describe('resolveDefaultLiteRTBackend', () => {
  it('returns gpu when OpenCL is supported', () => {
    expect(
      resolveDefaultLiteRTBackend({ platform: 'android', openCLSupported: true }),
    ).toBe('gpu');
  });

  it('returns cpu when OpenCL is not supported', () => {
    expect(
      resolveDefaultLiteRTBackend({ platform: 'android', openCLSupported: false }),
    ).toBe('cpu');
  });

  it('iOS reports gpu when supported (Metal-class GPU)', () => {
    expect(
      resolveDefaultLiteRTBackend({ platform: 'ios', openCLSupported: true }),
    ).toBe('gpu');
  });
});
