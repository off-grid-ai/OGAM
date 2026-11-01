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
 * These tests drive the REAL OpenAICompatibleProvider.generate() over the REAL HTTP client and
 * inspect the request body that reached the network. The only fake is the server at the
 * XMLHttpRequest boundary (remoteHarness.recordRemoteStream) — the request-building logic under
 * assertion runs for real, so deleting/altering the gate would fail these tests.
 */

import { OpenAICompatibleProvider } from '../../src/services/providers/openAICompatibleProvider';
import { recordRemoteStream } from '../harness/remoteHarness';

const TOOLS = [
  { type: 'function' as const, function: { name: 'web_search', description: 'Search', parameters: {} } },
];

/**
 * Runs generate() through the real provider and returns the request body the server received on
 * /v1/chat/completions. Uses a NON-Ollama endpoint (not port 11434) so the code takes the
 * buildRequestBody path.
 */
async function captureRequestBody(opts: {
  supportsToolCalling?: boolean;
  tools?: typeof TOOLS;
}): Promise<Record<string, unknown>> {
  const server = recordRemoteStream(
    'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
  );
  const provider = new OpenAICompatibleProvider('srv', {
    endpoint: 'http://192.168.1.50:1234', // NOT :11434 → OpenAI path, carries `tools`
    modelId: 'some-model',
  });
  await provider.loadModel('some-model');
  if (opts.supportsToolCalling !== undefined) {
    // Authoritative capability applied post-discovery (as remoteServerManager does).
    provider.updateCapabilities({ supportsToolCalling: opts.supportsToolCalling });
  }

  let reply = '';
  await new Promise<void>((resolve, reject) => {
    provider
      .generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        { tools: opts.tools },
        { onToken: token => { reply += token; }, onComplete: () => resolve(), onError: reject },
      )
      .catch(reject);
  });
  expect(reply).toBe('ok');

  const chat = server.requests.filter(request => request.url.endsWith('/v1/chat/completions'));
  expect(chat).toHaveLength(1);
  return chat[0].body!;
}

describe('Batch 8 — remote server tool-calling capability gate (request builder)', () => {
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

  it('omits tools + tool_choice when the server advertised supportsToolCalling=false', async () => {
    const body = await captureRequestBody({ supportsToolCalling: false, tools: TOOLS });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});
