/**
 * BATCH 8 — Settings, Security & Storage (hardening)
 *
 * Remote server capability discovery → request-body tool gating.
 *
 * Plan reference: mobile-test-plan.md Batch 8, and the "Deliberately NOT covered"
 * note that capability discovery (supportsToolCalling) is contract-tested rather
 * than screen-observable.
 *
 * KNOWN GAP (from the assignment): when a discovered remote server reports
 * `supportsToolCalling === false`, the outgoing /v1/chat/completions request body
 * must NOT carry a `tools` array or `tool_choice`. Sending `tools` to a server
 * that advertised it cannot do tool calling can make the server 400 / reject the
 * request or hallucinate. The single owning decision point is
 * OpenAICompatibleProvider.buildRequestBody (invoked from generate()).
 *
 * These tests drive the REAL OpenAICompatibleProvider.generate() and inspect the
 * REAL request body handed to the (boundary-mocked) HTTP client. The only mock is
 * the network transport (createStreamingRequest) — the request-building logic under
 * assertion runs for real, so deleting/altering the gate would fail these tests.
 */

import { OpenAICompatibleProvider } from '../../src/services/providers/openAICompatibleProvider';
import * as httpClient from '../../src/services/httpClient';

// Boundary mock: the network transport only. The provider's request-building
// logic (buildRequestBody / capability gating) runs for real.
jest.mock('../../src/services/httpClient', () => ({
  createStreamingRequest: jest.fn(),
  createNDJSONStreamingRequest: jest.fn(),
  imageToBase64DataUrl: jest.fn(),
  fetchWithTimeout: jest.fn(),
  parseOpenAIMessage: jest.fn((event: { data: string }) => {
    if (typeof event.data !== 'string') return null;
    const data = event.data.trim();
    if (data === '[DONE]') return { object: 'done' };
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }),
}));

const TOOLS = [
  { type: 'function' as const, function: { name: 'web_search', description: 'Search', parameters: {} } },
];

/**
 * Runs generate() through the real provider and returns the request body that was
 * actually sent to the OpenAI /v1/chat/completions transport. Uses a NON-Ollama
 * endpoint (not port 11434) so the code takes the buildRequestBody path.
 */
async function captureRequestBody(opts: {
  supportsToolCalling?: boolean;
  tools?: typeof TOOLS;
}): Promise<Record<string, unknown>> {
  const provider = new OpenAICompatibleProvider('srv', {
    endpoint: 'http://192.168.1.50:1234', // NOT :11434 → OpenAI path, carries `tools`
    modelId: 'some-model',
  });
  await provider.loadModel('some-model');
  if (opts.supportsToolCalling !== undefined) {
    // Authoritative capability applied post-discovery (as remoteServerManager does).
    provider.updateCapabilities({ supportsToolCalling: opts.supportsToolCalling });
  }

  const mock = httpClient.createStreamingRequest as jest.Mock;
  mock.mockImplementation((_url, _req, onEvent) => {
    onEvent({ data: '{"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}' });
    return Promise.resolve();
  });

  await provider.generate(
    [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
    { tools: opts.tools },
    { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn() },
  );

  return mock.mock.calls[0][1].body as Record<string, unknown>;
}

describe('Batch 8 — remote server tool-calling capability gate (request builder)', () => {
  beforeEach(() => jest.clearAllMocks());

  // COVERED-REAL baseline (mirrors existing provider test, kept as the "before" side
  // of the contract): tools present + capable server → tools go on the wire.
  it('includes tools + tool_choice when the server supports tool calling and tools are provided', async () => {
    const body = await captureRequestBody({ supportsToolCalling: true, tools: TOOLS });
    expect(body.tools).toEqual(TOOLS);
    expect(body.tool_choice).toBe('auto');
  });

  it('omits tools + tool_choice when no tools are provided (regardless of capability)', async () => {
    const body = await captureRequestBody({ supportsToolCalling: true });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  /**
   * BUG-FOUND — the request builder does not consult the discovered
   * `supportsToolCalling` capability. src/services/providers/openAICompatibleProvider.ts
   * line ~102 gates only on `options.tools.length > 0`:
   *
   *   ...(options.tools && options.tools.length > 0 && { tools, tool_choice: 'auto' })
   *
   * So a server that advertised supportsToolCalling === false at discovery STILL
   * receives the tools array. The fix is to also require
   * `this.modelCapabilities.supportsToolCalling` before adding tools. This test is
   * the exact fails-before / passes-after case for that fix. Skipped until src is
   * fixed (per assignment: real src bug → do not edit src, mark BUG-FOUND + .skip).
   */
  it.skip('BUG-FOUND: omits tools + tool_choice when the server advertised supportsToolCalling=false', async () => {
    const body = await captureRequestBody({ supportsToolCalling: false, tools: TOOLS });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});
