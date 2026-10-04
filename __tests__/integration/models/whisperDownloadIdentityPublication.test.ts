/**
 * The Shared Whisper download helper is the ONE owner of the whisper download identity.
 * This proves the identity it produces is the identity that reaches the reactive projection
 * consumers read: `ModelsSnapshot.control.downloads`, under the SAME model id the Whisper
 * picker and the guided-setup projection route on (the WHISPER_MODELS catalog id).
 *
 * Faked boundary: the native background-download and filesystem modules only.
 */
import { createWhisperPublicDownloadRequest, WHISPER_MODELS } from '@offgrid/application';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../harness/nativeBoundary';

const MODEL_ID = 'base.en';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

describe('the Shared whisper download identity reaches the reactive projection', () => {
  it('publishes a queued whisper download under the catalog id the UI routes on', async () => {
    installNativeBoundary({ download: true, fs: true });
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
    const { downloadTranscriptionModel } =
      require('../../../src/services/transcriptionModelApplication') as typeof import('../../../src/services/transcriptionModelApplication');

    const queued = await downloadTranscriptionModel(MODEL_ID);
    expect(queued.ok).toBe(true);

    // The identity the Shared helper owns.
    const model = WHISPER_MODELS.find(candidate => candidate.id === MODEL_ID)!;
    const owned = createWhisperPublicDownloadRequest(model);
    expect(owned.modelId).toBe(MODEL_ID);
    expect(owned.fileName).toBe(`ggml-${MODEL_ID}.bin`);
    expect(owned.modelKey).toBe(`whisper-${MODEL_ID}/ggml-${MODEL_ID}.bin`);

    // THE ASSERTION THAT PROVES PUBLICATION: the reactive projection consumers read
    // carries a row addressed by the Shared helper's identity. `modelId` is the id the
    // Whisper picker and the guided-setup projection route on; `fileName` is the artifact
    // name the Shared helper owns. If either diverges from the helper, this fails.
    const rows = fixture.application.models.snapshot().control.downloads;
    const published = rows.find(row => row.modelId === owned.modelId);
    expect(published).toBeDefined();
    expect(published!.modelId).toBe(MODEL_ID);
    expect(published!.fileName).toBe(owned.fileName);
    // The Shared download owner addresses the same artifact one way only.
    expect(owned.modelKey).toBe(`whisper-${published!.modelId}/${published!.fileName}`);
  });

});
