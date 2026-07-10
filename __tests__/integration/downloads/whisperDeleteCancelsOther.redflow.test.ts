/**
 * RED-FLOW (integration) — V1: deleting one whisper model cancels an UNRELATED in-flight download.
 *
 * whisperService.deleteModel cancels this.activeDownloadId regardless of which model id was passed
 * (whisperService.ts:172-176). So deleting an already-downloaded small.en while base.en is still
 * downloading aborts base.en. Integration boundary: only the background-download native module (stateful
 * active set) + the filesystem are faked; the REAL whisperService runs.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

describe('V1 — deleting a whisper model cancels an unrelated download (red-flow)', () => {
  it('leaves an unrelated in-flight download running when a different model is deleted', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { whisperService } = require('../../../src/services/whisperService');

    // base.en is downloading; the service tracks its native downloadId.
    boundary.download!.seedActive({ downloadId: 'dl-base', modelId: 'base.en', modelType: 'stt' });
    (whisperService as unknown as { activeDownloadId: string }).activeDownloadId = 'dl-base';

    // User deletes a DIFFERENT, already-downloaded model.
    await whisperService.deleteModel('small.en');

    // Correct: base.en's download is untouched. Today deleteModel cancels the single activeDownloadId
    // regardless of which model was deleted → base.en is aborted → RED.
    expect(boundary.download!.active().some(r => r.downloadId === 'dl-base')).toBe(true);
  });
});
