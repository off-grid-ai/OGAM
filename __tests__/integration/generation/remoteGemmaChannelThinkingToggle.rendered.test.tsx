/**
 * DEV-B16 / B17 (capability half) — a REMOTE model that reasons via Gemma-style inline channel
 * markup (`<|channel>thought …`, NO separate reasoning_content field) must be detected as
 * thinking-capable during discovery, so the chat Thinking toggle appears for it.
 *
 * Ground truth (docs/DEVICE_TEST_FINDINGS.md):
 *   - "Inline-thinking delimiter is model-specific: Qwen3.5 = `<think>…</think>`;
 *      gemma-4-E2B = `<|channel>thought`." (part16)
 *   - B16/B17: a remote model emitted reasoning the WIRE captured, but the app showed reasoning=0
 *      and had "no thinking toggle for remote" → the reasoning never rendered.
 *
 * The fix under test lives in src/stores/remoteModelCapabilities.ts `deltaHasThinking`: it now
 * detects inline channel reasoning through the SHARED grammar (REASONING_DELIMITERS) instead of a
 * hardcoded `<think>`. probeLmStudioThinking streams a probe during discovery and runs
 * deltaHasThinking on each delta; a hit sets supportsThinking=true on the discovered model, which
 * is the ONLY thing that renders the `quick-thinking-toggle`.
 *
 * This test drives the REAL discovery path (remoteServerStore.discoverModels →
 * fetchModelsFromServer → fetchModelCapabilities → fetchLmStudioModelInfo → probeLmStudioThinking →
 * deltaHasThinking) — it does NOT pre-place caps via installRemoteModel, because that would bypass
 * the exact code the fix changed. Only the NETWORK transport is faked (global.fetch), device-shaped:
 * the LM Studio model list + a streaming probe whose delta.content carries the bare Gemma opener.
 *
 * SPEC / GREEN: after the user selects that discovered remote model and opens quick-settings, the
 * Thinking toggle is on screen. RED (revert deltaHasThinking to hardcoded `<think>`): the bare
 * Gemma opener is missed → supportsThinking stays false → the toggle never renders.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const ENDPOINT = 'http://localhost:1234';
const MODEL_ID = 'gemma-4-e2b';

// LM Studio /v1/models list (discovery entry point) — one generative model.
const V1_MODELS = JSON.stringify({
  object: 'list',
  data: [{ id: MODEL_ID, object: 'model', owned_by: 'lmstudio' }],
});

// LM Studio native /api/v1/models — the model advertised with a matching `key`. Carries NO thinking
// flag (LM Studio never advertises one — that's B17), so supportsThinking depends entirely on the probe.
const LMSTUDIO_MODELS = JSON.stringify({
  models: [{
    key: MODEL_ID,
    max_context_length: 8192,
    capabilities: { vision: false, trained_for_tool_use: false },
  }],
});

// The captured-shape probe stream: gemma-4-E2B emits its reasoning INLINE in delta.content using the
// bare channel opener `<|channel>thought` (device finding part16) — NO reasoning_content field. This is
// the exact form the old hardcoded-`<think>` deltaHasThinking missed and the shared grammar now catches.
const GEMMA_CHANNEL_PROBE_SSE =
  'data: {"choices":[{"delta":{"role":"assistant","content":"<|channel>thought"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":" the user said hi"}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' +
  'data: [DONE]\n\n';

// NEGATIVE discriminator (the anti-M10 guard): a non-thinking model streams PLAIN content — no
// channel opener, no reasoning_content/reasoning/thinking field. deltaHasThinking MUST return false
// for every delta → supportsThinking=false → NO toggle. Without this case, an always-true
// deltaHasThinking (e.g. a mutated `.includes`→`!.includes`, which is trivially true over the
// multi-delimiter list) would pass the positive test — so this case is what makes the delimiter
// check load-bearing.
const PLAIN_PROBE_SSE =
  'data: {"choices":[{"delta":{"role":"assistant","content":"Hi"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":" there, how can I help?"}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

/** Fake ONLY the network transport (global.fetch) with device-shaped responses per endpoint. Everything
 *  we own — discovery, fetchModelCapabilities, probeLmStudioThinking, deltaHasThinking — runs for real. */
function installDiscoveryFetch(probeSse: string): () => void {
  const original = global.fetch;
  const ok = (body: string): Response =>
    ({ ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body }) as unknown as Response;
  const notFound = (): Response =>
    ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }) as unknown as Response;

  global.fetch = (async (input: RequestInfo | URL) => {
    const u = typeof input === 'string' ? input : input.toString();
    // Order matters: `/api/v1/models` (LM Studio native) also ends with `/v1/models`, so match the
    // more specific path first, or the OpenAI-compat list body would be served for the native probe.
    if (u.endsWith('/api/v1/models')) return ok(LMSTUDIO_MODELS);
    if (u.endsWith('/v1/models')) return ok(V1_MODELS);
    if (u.endsWith('/v1/chat/completions')) return ok(probeSse); // the thinking probe (per-case payload)
    // /props (llama.cpp) and /api/show (Ollama) must NOT answer with real data, or they'd win the
    // capability race ahead of the LM Studio probe. A non-llama.cpp / non-Ollama server 404s here.
    return notFound();
  }) as typeof global.fetch;

  return () => { global.fetch = original; };
}

describe('remote Gemma-channel inline reasoning → Thinking toggle appears (DEV-B16/B17)', () => {
  it('detects <|channel>thought during discovery and shows quick-thinking-toggle for the remote model', async () => {
    // Mount the real ChatScreen. The local model the harness installs is unloaded below so the
    // capability path reads the remote model (the screen prefers a remote when one is active).
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });

    const { useRemoteServerStore, useAppStore } = require('../../../src/stores');
    const { llmService } = require('../../../src/services/llm');
    const { setActiveRemoteTextModelImpl } = require('../../../src/services/remoteServerManagerUtils');

    // Route remote: no local model loaded/selected (mirrors selecting a remote model on device).
    await llmService.unloadModel();
    useAppStore.getState().setActiveModelId(null);

    const restoreFetch = installDiscoveryFetch(GEMMA_CHANNEL_PROBE_SSE);
    try {
      // REAL "add a server" end state + REAL discovery — this is what runs deltaHasThinking. No caps
      // are pre-placed; supportsThinking is EMERGENT from the probe stream through the real detection.
      const serverId = useRemoteServerStore.getState().addServer({
        name: 'LM Studio', endpoint: ENDPOINT, providerType: 'openai-compatible',
      });
      await useRemoteServerStore.getState().discoverModels(serverId);

      // REAL "user selects this discovered remote model" — sets it active + registers the provider
      // and applies the discovered capabilities. Same action the model picker fires.
      await setActiveRemoteTextModelImpl(serverId, MODEL_ID);
    } finally {
      restoreFetch();
    }

    h.render();

    // Open the quick-settings popover the way the user does (the composer's quick-settings button).
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('quick-settings-button')));

    // SPEC: because the remote model was detected as thinking-capable, the Thinking toggle is shown.
    // RED (revert deltaHasThinking to hardcoded `<think>`): the bare `<|channel>thought` opener is
    // missed → supportsThinking=false → this toggle never renders.
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByTestId('quick-thinking-toggle')).not.toBeNull();
    }, { timeout: 6000 });
    // Precondition guard against a false green: the popover IS open (its always-present Image Gen row
    // is there), so a missing thinking toggle would be a real absence, not an unopened popover.
    expect(h.view!.queryByTestId('quick-image-mode')).not.toBeNull();
  });

  it('does NOT show the toggle for a remote model whose probe is PLAIN content (anti-M10 discriminator)', async () => {
    // Identical flow, but the probe streams plain content with NO reasoning signal at all →
    // deltaHasThinking must return false → supportsThinking=false → NO thinking toggle. This is the
    // discriminator: it FAILS if deltaHasThinking is broken to be always-true (the surviving M10 mutant),
    // so together with the positive case it pins detection to the actual delimiter grammar.
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    const { useRemoteServerStore, useAppStore } = require('../../../src/stores');
    const { llmService } = require('../../../src/services/llm');
    const { setActiveRemoteTextModelImpl } = require('../../../src/services/remoteServerManagerUtils');

    await llmService.unloadModel();
    useAppStore.getState().setActiveModelId(null);

    const restoreFetch = installDiscoveryFetch(PLAIN_PROBE_SSE);
    try {
      const serverId = useRemoteServerStore.getState().addServer({
        name: 'LM Studio', endpoint: ENDPOINT, providerType: 'openai-compatible',
      });
      await useRemoteServerStore.getState().discoverModels(serverId);
      await setActiveRemoteTextModelImpl(serverId, MODEL_ID);
    } finally {
      restoreFetch();
    }

    h.render();
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('quick-settings-button')));
    // Popover open (guard), but NO thinking toggle for a non-thinking model.
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('quick-image-mode')).not.toBeNull(); });
    expect(h.view!.queryByTestId('quick-thinking-toggle')).toBeNull();
  });
});
