/**
 * Integration guard: a remote image route executes the user's exact prompt.
 *
 * Prompt enhancement is a local-image preparation step. Even when a remote text model is ready and
 * enhancement is enabled, a remote image request must not spend a text-model turn or replace the prompt.
 * The real canonical selection, Shared image application service, Shared GenerationService, Mobile remote
 * adapter, and persistence path run here. Only native modules and HTTP are controlled boundaries.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import {
  installRemoteModel,
  installRemoteStream,
} from '../../harness/remoteHarness';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

const ENHANCED_SSE =
  'data: {"choices":[{"delta":{"content":"a rewritten photorealistic cat"}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

describe('remote image generation skips local prompt enhancement', () => {
  it('sends the original prompt to the exact remote image route', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const originalFetch = global.fetch;
    const originalXHR = global.XMLHttpRequest;
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    const fixture: MobileApplicationFixture =
      await startMobileApplicationFixture();

    try {
      const { serverId } = await installRemoteModel({
        name: 'LM Studio',
        caps: { supportsToolCalling: false, supportsThinking: false },
      });
      const { useAppStore } = require('../../../src/stores');
      const {
        selectMobileModel,
      } = require('../../../src/services/modelServices');
      const {
        remoteServerManager,
      } = require('../../../src/services/remoteServerManager');
      const {
        imageGenerationService,
      } = require('../../../src/services/imageGenerationService');

      const imageModelId = 'remote-image-model';
      await remoteServerManager.updateServer(serverId, {
        catalog: { image: [{ id: imageModelId, name: 'Remote Image Model' }] },
      });
      await selectMobileModel({
        source: 'remote',
        hostId: serverId,
        modality: 'image',
        modelId: imageModelId,
      });
      useAppStore.getState().updateSettings({ enhanceImagePrompts: true });

      // If enhancement runs, this transport produces a different prompt. The image request must ignore it.
      installRemoteStream(ENHANCED_SSE);
      const fetchBoundary = jest.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) => ({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2U=' }] }),
          text: async () => '',
        }),
      );
      global.fetch = fetchBoundary as unknown as typeof fetch;

      const generated = await imageGenerationService.generateImage({
        prompt: 'a cat',
      });

      expect(generated).not.toBeNull();
      expect(fetchBoundary).toHaveBeenCalledTimes(1);
      const request = fetchBoundary.mock.calls[0][1] as RequestInit;
      expect(JSON.parse(request.body as string)).toMatchObject({
        model: imageModelId,
        prompt: 'a cat',
      });
      expect(boundary.diffusion.calls.generateImage).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
      global.XMLHttpRequest = originalXHR;
      await fixture.dispose();
    }
  });
});
