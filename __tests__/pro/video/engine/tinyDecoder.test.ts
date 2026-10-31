/**
 * Which decoder a phone clip uses.
 *
 * SPEC (OGAM): a pack's tiny decoder, when it is on disk, decodes a clip in seconds on Android. On iOS
 * the full VAE decodes: the Metal build turned Wan 2.2 Turbo's taew2_2 decode into colour noise on an
 * iPhone 17 Pro Max, where the full VAE gives a clean clip.
 *
 * The disk is the boundary: RNFS answers whether the file is there.
 */
import RNFS from 'react-native-fs';
import { tinyDecoderPath } from '../../../../pro/video/videoPack';

const TURBO = {
  weight: '/docs/video-models/turbo/Wan2_2-TI2V-5B-Turbo-Q4_K_S.gguf',
  vae: '/docs/video-models/turbo/wan2.2_vae.safetensors',
  encoder: '/docs/video-models/turbo/umt5-xxl-encoder-Q4_K_M.gguf',
} as never;

afterEach(() => jest.restoreAllMocks());

it('Android decodes with the pack\'s tiny decoder when it is on disk', async () => {
  jest.spyOn(RNFS, 'exists').mockResolvedValue(true);
  expect(await tinyDecoderPath(TURBO, 'android')).toBe('/docs/video-models/turbo/taew2_2.safetensors');
});

it('Android uses the full VAE when the tiny decoder is not on disk', async () => {
  jest.spyOn(RNFS, 'exists').mockResolvedValue(false);
  expect(await tinyDecoderPath(TURBO, 'android')).toBeUndefined();
});

it('iOS always decodes with the full VAE, even with the tiny decoder on disk', async () => {
  const exists = jest.spyOn(RNFS, 'exists').mockResolvedValue(true);
  expect(await tinyDecoderPath(TURBO, 'ios')).toBeUndefined();
  expect(exists).not.toHaveBeenCalled();
});
