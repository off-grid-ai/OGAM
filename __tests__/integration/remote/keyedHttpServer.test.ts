/**
 * A saved API key on a private HTTP server (backlog item 1b).
 *
 * Keys are only sent over HTTPS, so on plain HTTP the app never uses the saved key. Open servers connect without the key; only a 401/403 reports the HTTPS rule. The real
 * endpoint check and model discovery run; the remote server is the only fake, answering at the
 * fetch boundary the way a keyed llama.cpp/Ollama server on the LAN would.
 */
import { testEndpoint } from '../../../src/services/httpClientUtils';
import { fetchModelsFromServer } from '../../../src/stores/remoteServerHelpers';
import { HTTP_API_KEY_ERROR } from '../../../src/services/remoteTransportPolicy';
import type { RemoteServer } from '../../../src/types/remoteServer';

const ENDPOINT = 'http://192.168.1.40:11434';
const realFetch = globalThis.fetch;

/** A LAN server that lists its models openly but refuses every other request without a key. */
function startLanServer(status = 200): { requests: string[] } {
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (new Headers(init?.headers).has('Authorization')) {
      return new Response('Key sent over HTTP', { status: 400 });
    }
    if (status !== 200) return new Response('Authentication required', { status });
    if (url.pathname === '/v1/models') {
      return new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Unauthorized', { status: 401 });
  }) as typeof globalThis.fetch;
  return { requests };
}

const server = (apiKey?: string): RemoteServer => ({
  id: 'lan-ollama',
  name: 'LAN Ollama',
  endpoint: ENDPOINT,
  apiKey,
  providerType: 'openai-compatible',
  createdAt: '2026-09-28T10:00:00.000Z',
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('a saved key on a private HTTP server', () => {
  it('connects to an open server without sending its saved key', async () => {
    const lan = startLanServer();

    const result = await testEndpoint(ENDPOINT, 5000, 'saved-key');

    expect(result.success).toBe(true);
    expect(lan.requests).toEqual(['GET /v1/models']);
  });

  it.each([401, 403])('shows the HTTPS message after the server answers %s', async status => {
    const lan = startLanServer(status);
    const result = await testEndpoint(ENDPOINT, 5000, 'saved-key');
    expect(result).toEqual({ success: false, error: HTTP_API_KEY_ERROR, latency: expect.any(Number) });
    expect(lan.requests).toEqual(['GET /v1/models']);
  });

  it('still connects to the same server when no key is saved', async () => {
    startLanServer();

    const result = await testEndpoint(ENDPOINT, 5000);

    expect(result.success).toBe(true);
  });

  it('explains a refused capability check with the HTTPS rule, not as a rejected key', async () => {
    startLanServer();

    await expect(fetchModelsFromServer(server('saved-key'))).rejects.toThrow(HTTP_API_KEY_ERROR);
  });
});
