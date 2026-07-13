import { selectTextModelToLoad, fitsBudget } from '../../../src/services/selectTextModel';
import type { DownloadedModel } from '../../../src/types';

const MB = 1024 * 1024;

function model(id: string, fileSizeMB: number): DownloadedModel {
  return {
    id,
    name: id,
    author: 'test',
    filePath: `/models/${id}`,
    fileName: `${id}.gguf`,
    fileSize: fileSizeMB * MB,
    quantization: 'Q4',
    downloadedAt: '2026-07-13',
    engine: 'llama',
  };
}

// Footprint = fileSize in MB (1x) — the selection logic is independent of the
// multiplier; the real caller passes hardwareService.estimateModelRam.
const footprint = (m: DownloadedModel) => (m.fileSize || 0) / MB;

const small = model('small', 500);
const medium = model('medium', 1000);
const large = model('large', 3000);

describe('fitsBudget', () => {
  it('fits when footprint <= budget, not otherwise', () => {
    expect(fitsBudget(1000, 1000)).toBe(true); // exactly fits
    expect(fitsBudget(1001, 1000)).toBe(false);
  });
});

describe('selectTextModelToLoad', () => {
  it('returns null when nothing is downloaded', () => {
    expect(selectTextModelToLoad([], 4000, { activeId: null, footprintMB: footprint })).toBeNull();
    expect(selectTextModelToLoad([], 4000, { activeId: 'medium', footprintMB: footprint })).toBeNull();
  });

  it('uses the active model when it fits the budget', () => {
    expect(selectTextModelToLoad([small, medium, large], 2000, { activeId: 'small', footprintMB: footprint })?.id).toBe('small');
  });

  it('ignores the active model when it does NOT fit, and picks the largest that fits', () => {
    // budget 2000: large(3000) does not fit -> largest fitting is medium(1000)
    expect(selectTextModelToLoad([small, medium, large], 2000, { activeId: 'large', footprintMB: footprint })?.id).toBe('medium');
  });

  it('with no active id, picks the largest model that fits (best quality within RAM)', () => {
    expect(selectTextModelToLoad([small, medium, large], 2000, { activeId: null, footprintMB: footprint })?.id).toBe('medium');
    expect(selectTextModelToLoad([small, medium, large], 4000, { activeId: null, footprintMB: footprint })?.id).toBe('large');
  });

  it('falls back to the SMALLEST when nothing fits (run something, not an OOM)', () => {
    // budget 400: smallest is small(500) > 400, nothing fits -> smallest
    expect(selectTextModelToLoad([small, medium, large], 400, { activeId: 'large', footprintMB: footprint })?.id).toBe('small');
  });

  it('ignores an active id that is not among the downloaded models', () => {
    expect(selectTextModelToLoad([small, medium], 2000, { activeId: 'ghost', footprintMB: footprint })?.id).toBe('medium');
  });
});
