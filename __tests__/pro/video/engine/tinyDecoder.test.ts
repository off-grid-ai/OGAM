/**
 * Which decoder a phone clip uses.
 *
 * SPEC (OGAM): a pack's tiny decoder, when it is on disk, decodes a clip in seconds; otherwise the full VAE
 * decodes. On iOS the native engine runs that tiny decoder on the CPU (on Metal it decoded Wan 2.2 Turbo
 * into colour noise), so iOS and Android both pick it the same way here.
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

it('decodes with the pack\'s tiny decoder when it is on disk', async () => {
  jest.spyOn(RNFS, 'exists').mockResolvedValue(true);
  expect(await tinyDecoderPath(TURBO)).toBe('/docs/video-models/turbo/taew2_2.safetensors');
});

it('uses the full VAE when the tiny decoder is not on disk', async () => {
  jest.spyOn(RNFS, 'exists').mockResolvedValue(false);
  expect(await tinyDecoderPath(TURBO)).toBeUndefined();
});
