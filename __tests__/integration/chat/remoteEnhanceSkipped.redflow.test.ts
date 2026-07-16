/**
 * RED-FLOW (integration) — B30/Q8: image-prompt enhancement is SKIPPED when a REMOTE text model is active.
 *
 * Device ground truth (docs/DEVICE_TEST_FINDINGS.md, B30): enhancement is a background UTILITY completion
 * ("rewrite this into a better image prompt") that must run on the ACTIVE text model. When that model is
 * REMOTE (OpenAI-compatible / LM Studio / Ollama) and NO local model is loaded, the enhancement readiness
 * gate reads llmService.isModelLoaded() (via getActiveEngineService(), which returns the local llama for a
 * non-litert model) → false → it tries an on-demand LOCAL load of the remote model id, which does nothing →
 * still "not loaded" → enhancement is SKIPPED and the ORIGINAL prompt is used. The remote branch in
 * generateStandalone is never reached because the gate bails first.
 *
 * Product-correct outcome (one sentence): with a remote text model active, enhancing "a cat" returns the
 * REMOTE model's rewritten prompt — never the untouched original.
 *
 * Real stack: the REAL imageGenerationService._enhancePrompt + real generateStandalone + real provider +
 * real processDelta run. Fake ONLY the device boundary — the streaming XHR transport — replaying a
 * device-shaped LM Studio SSE (the same OpenAI-compatible `data: {…}` shape captured in
 * docs/wire-captures/*lmstudio*). Nothing we own is mocked.
 *
 * Falsify: without the fix the gate skips → returns the ORIGINAL "a cat" → RED. Break the remote branch
 * (route to local) → local isn't loaded → throws → returns original → RED. Only routing the enhancement
 * through the active remote engine returns the rewritten prompt → GREEN.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { installRemoteModel, installRemoteStream } from '../../harness/remoteHarness';

// Device-shaped LM Studio SSE: the enhanced (rewritten) image prompt streamed as OpenAI-compatible deltas.
const ENHANCED_SSE =
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"a photorealistic tabby cat "}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"sitting on a windowsill, soft morning light"}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

describe('B30/Q8 — prompt enhancement runs on the remote text model (red-flow)', () => {
  it('returns the REMOTE model rewritten prompt, not the untouched original', async () => {
    installNativeBoundary();
    // Reach the precondition the real way: connect + select a remote (LM Studio) text model, no local loaded.
    await installRemoteModel({ name: 'LM Studio', caps: { supportsToolCalling: false, supportsThinking: false } });

    /* eslint-disable @typescript-eslint/no-var-requires */
    const { useAppStore } = require('../../../src/stores');
    const { imageGenerationService } = require('../../../src/services/imageGenerationService');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // Enhancement is opt-in — turn it on the way the user does via settings.
    useAppStore.getState().updateSettings({ enhanceImagePrompts: true });
    installRemoteStream(ENHANCED_SSE); // fake ONLY the XHR transport with the device-shaped SSE

    // Drive the REAL enhancement seam (the exact B30 surface). _enhancePrompt is the private owner of the
    // enhance step; call it through the service instance so the whole real gate + generateStandalone run.
    const enhance = (imageGenerationService as any)._enhancePrompt.bind(imageGenerationService);
    const enhanced: string = await enhance({ prompt: 'a cat' }, 20);

    // Terminal artifact: the remote model's rewritten prompt reached the caller (would be fed downstream to
    // image generation). On HEAD the gate skips remote → returns the original "a cat".
    expect(enhanced).toContain('photorealistic tabby cat');
    expect(enhanced).not.toBe('a cat');
  });
});
