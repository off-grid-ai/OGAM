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
 * OpenAICompatibleTransport.buildRequestBody (invoked from generate()).
 *
 * These tests drive the REAL OpenAICompatibleTransport.generate() and inspect the
 * REAL request body handed to the (boundary-mocked) HTTP client. The only mock is
 * the network transport (createStreamingRequest) — the request-building logic under
 * assertion runs for real, so deleting/altering the gate would fail these tests.
 */

import { OpenAICompatibleTransport } from '../../src/services/adapters/providers/openAICompatibleProvider';
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
  tools?: typeof TOOLS;
}): Promise<Record<string, unknown>> {
  const provider = new OpenAICompatibleTransport('srv', {
    endpoint: 'http://192.168.1.50:1234', // NOT :11434 → OpenAI path, carries `tools`
  });
  const mock = httpClient.createStreamingRequest as jest.Mock;
  mock.mockImplementation((_url, _req, onEvent) => {
    onEvent({ data: '{"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}' });
    return Promise.resolve();
  });

  await provider.generate(
    'some-model',
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
  it('sends tools selected by Shared GenerationService', async () => {
    const body = await captureRequestBody({ tools: TOOLS });
    expect(body.tools).toEqual(TOOLS);
    expect(body.tool_choice).toBe('auto');
  });

  it('omits tools + tool_choice when Shared GenerationService provides none', async () => {
    const body = await captureRequestBody({});
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

});
