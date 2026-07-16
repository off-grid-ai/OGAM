/**
 * DEVICE 2026-07-14 — an image sent to a gemma gguf whose projector was missing reached the native
 * completion and threw "Multimodal support not enabled. Call initMultimodal first.", crashing the turn.
 * The send is now gated on localModelAcceptsImages: a llama model can accept an image only with a present
 * projector (mmProjPath); a LiteRT model via its bundled vision flag. This pins that decision.
 */
import { localModelAcceptsImages } from '../../../src/services/engines';
import { createDownloadedModel } from '../../utils/factories';
import type { DownloadedModel } from '../../../src/types';

describe('localModelAcceptsImages — image send gate (only a working vision model accepts an image)', () => {
  it('llama WITH a projector present accepts images', () => {
    const m = createDownloadedModel({ id: 'a', engine: 'llama', filePath: '/m/gemma.gguf', fileName: 'gemma.gguf' });
    expect(localModelAcceptsImages({ ...m, mmProjPath: '/m/gemma-mmproj.gguf', isVisionModel: true } as DownloadedModel)).toBe(true);
  });

  it('llama MISSING its projector does NOT accept images (the device crash case → gated instead)', () => {
    // isVisionModel is still true (it IS a vision model that needs repair) but the projector isn't on disk.
    const m = createDownloadedModel({ id: 'a', engine: 'llama', filePath: '/m/gemma.gguf', fileName: 'gemma.gguf' });
    expect(localModelAcceptsImages({ ...m, mmProjPath: undefined, isVisionModel: true } as DownloadedModel)).toBe(false);
  });

  it('a plain (non-vision) llama model does not accept images', () => {
    const m = createDownloadedModel({ id: 'a', engine: 'llama', filePath: '/m/qwen.gguf', fileName: 'qwen.gguf' });
    expect(localModelAcceptsImages(m)).toBe(false);
  });

  it('LiteRT accepts images per its bundled vision flag, not a projector file', () => {
    const vis = createDownloadedModel({ id: 'b', engine: 'litert', filePath: '/m/gemma.litertlm', fileName: 'gemma.litertlm', liteRTVision: true });
    const noVis = createDownloadedModel({ id: 'c', engine: 'litert', filePath: '/m/x.litertlm', fileName: 'x.litertlm', liteRTVision: false });
    expect(localModelAcceptsImages(vis)).toBe(true);
    expect(localModelAcceptsImages(noVis)).toBe(false);
  });

  it('null model does not accept images', () => {
    expect(localModelAcceptsImages(null)).toBe(false);
  });
});
