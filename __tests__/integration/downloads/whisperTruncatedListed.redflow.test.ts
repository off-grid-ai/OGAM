/**
 * RED-FLOW (integration) — V2: a truncated/partial whisper file on disk is listed as a COMPLETED model.
 *
 * An app-kill mid-download leaves a short ggml-<id>.bin at the final path (no .part). whisperService
 * .listDownloadedModels filters by NAME only (whisperService.ts:162-169) with no size floor — a
 * MIN_MODEL_FILE_SIZE exists (:186) but is applied only in validateModelFile, not here. So the Download
 * Manager shows the corrupt file as "downloaded", then load rejects it with no retry.
 *
 * Integration boundary: only the filesystem is faked (stateful in-memory disk). The REAL whisperService
 * listing logic runs. The returned list is exactly what the DM's voice section renders.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

const MB = 1024 * 1024;

async function listAfterSeeding(files: Array<{ id: string; sizeBytes: number }>): Promise<string[]> {
  const boundary = installNativeBoundary({ fs: true });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { whisperService } = require('../../../src/services/whisperService');
  const dir = `${boundary.fs!.DocumentDirectoryPath}/whisper-models`;
  files.forEach(f => boundary.fs!.seedFile(`${dir}/ggml-${f.id}.bin`, f.sizeBytes));
  const listed = await whisperService.listDownloadedModels();
  return listed.map((m: { modelId: string }) => m.modelId);
}

describe('V2 — truncated whisper file listed as completed (red-flow)', () => {
  it('does NOT list a sub-threshold (truncated) whisper file as a downloaded model', async () => {
    // base.en is ~142MB; a 5MB file is a truncated/interrupted download.
    const listed = await listAfterSeeding([{ id: 'base.en', sizeBytes: 5 * MB }]);
    // Correct: the corrupt 5MB file is not surfaced as completed. Today listDownloadedModels has no
    // size floor, so it appears as "downloaded" → RED.
    expect(listed).not.toContain('base.en');
  });

  it('control: a full-size whisper file IS listed (proves the red tracks the size floor)', async () => {
    const listed = await listAfterSeeding([{ id: 'tiny.en', sizeBytes: 75 * MB }]);
    expect(listed).toContain('tiny.en');
  });
});
