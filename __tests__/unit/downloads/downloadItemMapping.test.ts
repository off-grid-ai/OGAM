/**
 * One Download Manager row from one facade download row.
 *
 * `facadeDownloadToActiveItem` is a pure projection; the interesting properties are the ones a
 * person reads off the row: what the file is CALLED and what STATE it is in. Real module, real
 * `downloadFileRoleLabel`, real `hardwareService` import (from its own module, which is why this
 * can load at all - the `../../services` barrel constructed ImageGenerationService at import and
 * threw without the facade). No facade fake: the projection does not need one.
 */
import type { ModelsSnapshot } from '@offgrid/application';
import { facadeDownloadToActiveItem, projectorRepairToActiveItem } from '../../../src/screens/DownloadManagerScreen/downloadItemMapping';

type FacadeRow = ModelsSnapshot['control']['downloads'][number];

const row = (overrides: Partial<FacadeRow>): FacadeRow => ({
  downloadId: 'dl-1',
  fileName: 'demo-7b-Q4_K_M.gguf',
  modelId: 'offgrid/demo-7b',
  modelKey: 'offgrid/demo-7b/demo-7b-Q4_K_M.gguf',
  modelType: 'text',
  status: 'downloading',
  bytesDownloaded: 40,
  totalBytes: 100,
  startedAt: 0,
  ...overrides,
} as FacadeRow);

describe('a facade download row becomes one Download Manager row', () => {
  it('names the part being fetched "Vision support" when Shared says its role is mmproj', () => {
    const item = facadeDownloadToActiveItem(row({
      fileName: 'demo-7b-Q4_K_M.gguf',
      currentFileRole: 'mmproj',
    }));

    // The role wins over the filename - even one that says nothing about vision.
    expect(item.fileName).toBe('Vision support');
  });

  it('shows the real filename when no role was published, rather than inventing one', () => {
    const item = facadeDownloadToActiveItem(row({
      fileName: 'mmproj-F16.gguf',
      currentFileRole: undefined,
    }));

    // A file merely NAMED like a projector is still just a file until Shared says otherwise.
    expect(item.fileName).toBe('mmproj-F16.gguf');
  });

  it('passes a paused status through unchanged, so the row can say "Paused"', () => {
    const item = facadeDownloadToActiveItem(row({ status: 'paused' }));

    expect(item.status).toBe('paused');
    expect(item.type).toBe('active');
    // The bytes already on disk still count: paused is not "nothing happened".
    expect(item.bytesDownloaded).toBe(40);
    expect(item.progress).toBeCloseTo(0.4);
  });

  it('passes the measured transfer rate through to the Download Manager row', () => {
    const item = facadeDownloadToActiveItem(row({ bytesPerSecond: 2_500_000 }));

    expect(item.bytesPerSecond).toBe(2_500_000);
  });

  it('maps the Shared projector operation onto the installed model row', () => {
    const installed = facadeDownloadToActiveItem(row({ status: 'completed' }));
    const item = projectorRepairToActiveItem({
      operationId: 'repair-1',
      kind: 'projector_repair',
      state: 'active',
      modality: 'vision',
      modelId: installed.modelId,
      progress: {
        bytesDownloaded: 50,
        totalBytes: 100,
        percent: 50,
        bytesPerSecond: 25,
      },
    }, installed);

    expect(item).toEqual(expect.objectContaining({
      fileName: 'Vision support',
      progress: 0.5,
      bytesDownloaded: 50,
      fileSize: 100,
      bytesPerSecond: 25,
    }));
  });
});
