/**
 * A paused download, and the name a multi-file model gives the part it is fetching.
 *
 * Two properties, one per surface, both of which used to be indistinguishable from something
 * else:
 *
 *  - PAUSED is not queued, not downloading, and not failed. Shared classifies it as ACTIVE (a
 *    paused row still blocks a duplicate start) but as none of the three the views branch on, so
 *    a paused row that is not handled explicitly falls through every arm and renders as a stalled
 *    download nobody can explain.
 *  - The file currently transferring is named by its published ROLE, never by its filename. A
 *    projector is "Vision support" because Shared said its role is `mmproj`, not because the name
 *    matched a pattern.
 *
 * The classification is Shared's; these assert that Mobile's surfaces consume it rather than
 * re-deriving it.
 *
 * The row-level projection (`downloadItemMapping.facadeDownloadToActiveItem`) is covered in
 * `downloadItemMapping.test.ts`, now that the module imports `hardwareService` from its own file
 * instead of the `../../services` barrel that constructed ImageGenerationService at import.
 */
import {
  downloadFileRoleLabel,
  isDownloadingStatus,
  isFailedStatus,
  isPausedStatus,
  isQueuedStatus,
} from '../../../src/utils/downloadStatus';
import { aggregateTextModelDownloads } from '../../../src/screens/ModelsScreen/modelDownloadProjection';

describe('a paused download is its own state', () => {
  it('is not queued, not downloading, and not failed', () => {
    expect(isPausedStatus('paused')).toBe(true);
    expect(isQueuedStatus('paused')).toBe(false);
    expect(isDownloadingStatus('paused')).toBe(false);
    // The one that matters most: a person who paused has not hit an error.
    expect(isFailedStatus('paused')).toBe(false);
  });

  it('does not claim every other status is paused', () => {
    for (const status of ['queued', 'downloading', 'verifying', 'completed', 'failed', 'cancelled']) {
      expect(isPausedStatus(status)).toBe(false);
    }
  });

  it('reads the legacy waiting-for-network spelling as paused, the way Shared decodes it', () => {
    // Decoded through Shared rather than compared to a literal, so one vocabulary serves
    // every surface and the legacy spelling cannot mean something different here.
    expect(isPausedStatus('waiting_for_network')).toBe(true);
  });

  it('answers false for an absent status instead of throwing', () => {
    expect(isPausedStatus(undefined)).toBe(false);
    expect(isPausedStatus(null)).toBe(false);
  });
});

describe('the Models card projection', () => {
  const row = (status: string) => ({
    modelType: 'text' as const,
    modelId: 'offgrid/demo-7b',
    status,
    bytesDownloaded: 40,
    totalBytes: 100,
  });

  it('reports a paused download as paused, not as downloading or queued', () => {
    const projection = aggregateTextModelDownloads(
      [row('paused')] as unknown as Parameters<typeof aggregateTextModelDownloads>[0],
      'offgrid',
    );

    expect(projection.paused).toBe(true);
    expect(projection.downloading).toBe(false);
    expect(projection.queued).toBe(false);
    // The bytes already on disk are still counted: paused is not "nothing happened".
    expect(projection.bytes).toEqual({ downloaded: 40, total: 100 });
    expect(projection.count).toBe(1);
  });

  it('does not mark a running download as paused', () => {
    const projection = aggregateTextModelDownloads(
      [row('downloading')] as unknown as Parameters<typeof aggregateTextModelDownloads>[0],
      'offgrid',
    );

    expect(projection.paused).toBe(false);
    expect(projection.downloading).toBe(true);
  });
});

describe('naming the file a multi-file model is fetching', () => {
  it('labels the projector by its ROLE, not by its filename', () => {
    expect(downloadFileRoleLabel('mmproj', 'mmproj-F16.gguf')).toBe('Vision support');
    // The same role wins even when the filename says nothing about vision - which is the
    // whole point of reading the role instead of the name.
    expect(downloadFileRoleLabel('mmproj', 'companion-part-2.bin')).toBe('Vision support');
  });

  it('shows the real file name when the role is the primary weights', () => {
    expect(downloadFileRoleLabel('primary', 'demo-7b-Q4_K_M.gguf')).toBe('demo-7b-Q4_K_M.gguf');
  });

  it('shows the real file name when no role was published, rather than guessing one', () => {
    expect(downloadFileRoleLabel(undefined, 'demo-7b-Q4_K_M.gguf')).toBe('demo-7b-Q4_K_M.gguf');
  });

  it('never infers a role from a filename that merely looks like a projector', () => {
    // A file NAMED mmproj with no published role is still just a file: the label is the name.
    expect(downloadFileRoleLabel(undefined, 'mmproj-F16.gguf')).toBe('mmproj-F16.gguf');
  });
});
