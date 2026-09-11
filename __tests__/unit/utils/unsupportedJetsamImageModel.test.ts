/**
 * SDXL (apple/coreml-stable-diffusion-xl-base-ios) is unsupported on iOS — its ~7 GB dirty Core ML
 * footprint jetsams even a 12 GB iPhone 17 Pro Max. It's been removed from the download catalog, but
 * a copy downloaded before that must never be OFFERED as selectable (tapping it = guaranteed jetsam).
 * isUnsupportedJetsamImageModel is the guard the model selectors filter on.
 */
import { isUnsupportedJetsamImageModel } from '@offgrid/models';
import { ONNXImageModel } from '../../../src/types';

const model = (over: Partial<ONNXImageModel>): ONNXImageModel => ({
  id: 'coreml_apple_coreml-stable-diffusion-2-1-base-palettized',
  name: 'SD 2.1 Palettized',
  description: '',
  modelPath: '/models/sd21',
  downloadedAt: '2026-07-25T00:00:00Z',
  size: 1_000_000,
  backend: 'coreml',
  ...over,
});

describe('isUnsupportedJetsamImageModel', () => {
  it('hides the SDXL iOS Core ML model matched by its id slug', () => {
    expect(
      isUnsupportedJetsamImageModel(
        model({ id: 'coreml_apple_coreml-stable-diffusion-xl-base-ios', name: 'SDXL (iOS)' }),
      ),
    ).toBe(true);
  });

  it('hides it even if the id was recorded oddly but the modelPath carries the repo slug', () => {
    expect(
      isUnsupportedJetsamImageModel(
        model({ id: 'recovered_sdxl_123', modelPath: '/models/apple_coreml-stable-diffusion-xl-base-ios' }),
      ),
    ).toBe(true);
  });

  it('does NOT hide the supported palettized models (SD 2.1 / 1.5)', () => {
    expect(isUnsupportedJetsamImageModel(model({}))).toBe(false);
    expect(
      isUnsupportedJetsamImageModel(
        model({ id: 'coreml_apple_coreml-stable-diffusion-v1-5-palettized', name: 'SD 1.5 Palettized' }),
      ),
    ).toBe(false);
  });

  it('does NOT hide non-XL full-precision SD (substring must be the XL repo, not just "xl")', () => {
    expect(
      isUnsupportedJetsamImageModel(
        model({ id: 'coreml_apple_coreml-stable-diffusion-v1-5', modelPath: '/models/sd15-relaxl' }),
      ),
    ).toBe(false);
  });
});
