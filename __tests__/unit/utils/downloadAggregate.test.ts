import { aggregateActiveDownloads } from '../../../src/utils/downloadAggregate';

const entry = (overrides: Partial<any>) => ({
  modelKey: 'org/model/file.gguf', downloadId: 'd', modelId: 'org/model', fileName: 'file.gguf',
  quantization: 'Q4_0', modelType: 'text', status: 'running', bytesDownloaded: 0, totalBytes: 0,
  combinedTotalBytes: 0, progress: 0, createdAt: 0, ...overrides,
});

const asMap = (arr: any[]) => Object.fromEntries(arr.map((e, i) => [`${e.modelKey}#${i}`, e]));

describe('aggregateActiveDownloads', () => {
  it('returns idle when the model has no active entries', () => {
    const agg = aggregateActiveDownloads(asMap([entry({ modelKey: 'other/m/f', modelId: 'other/m' })]), 'org/model');
    expect(agg).toEqual({ downloading: false, queued: false, count: 0, progress: 0 });
  });

  it('sums cumulative bytes + progress across multiple active entries (a group)', () => {
    const map = asMap([
      entry({ modelKey: 'org/model/e2b', bytesDownloaded: 1000, combinedTotalBytes: 4000 }),
      entry({ modelKey: 'org/model/e4b', bytesDownloaded: 500, combinedTotalBytes: 6000 }),
    ]);
    const agg = aggregateActiveDownloads(map, 'org/model');
    expect(agg.downloading).toBe(true);
    expect(agg.count).toBe(2); // two downloads running
    expect(agg.bytes).toEqual({ downloaded: 1500, total: 10000 });
    expect(agg.progress).toBeCloseTo(0.15);
  });

  it('includes the mmproj sidecar bytes in the cumulative total', () => {
    const map = asMap([entry({ bytesDownloaded: 200, mmProjBytesDownloaded: 50, combinedTotalBytes: 1000 })]);
    const agg = aggregateActiveDownloads(map, 'org/model');
    expect(agg.bytes).toEqual({ downloaded: 250, total: 1000 });
    expect(agg.count).toBe(1);
  });

  it('reports queued (not downloading) when entries exist but all are pending', () => {
    const map = asMap([entry({ status: 'pending', combinedTotalBytes: 4000 })]);
    const agg = aggregateActiveDownloads(map, 'org/model');
    expect(agg.queued).toBe(true);
    expect(agg.downloading).toBe(false);
    expect(agg.count).toBe(0); // count is transferring entries only
  });

  it('falls back to the entry progress when totals are unknown (no bytes)', () => {
    const map = asMap([entry({ combinedTotalBytes: 0, totalBytes: 0, progress: 0.4 })]);
    const agg = aggregateActiveDownloads(map, 'org/model');
    expect(agg.bytes).toBeUndefined();
    expect(agg.progress).toBe(0.4);
  });
});
