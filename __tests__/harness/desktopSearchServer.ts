/**
 * Off Grid AI Desktop's search, at the network boundary (`fetch`).
 *
 * Wire shape is Desktop's own (desktop/pro/main/search-gateway.ts over the shared
 * @offgrid/rag remote-search contract): `POST /v1/search {query, limit}` answers
 * `{object: 'list', data: [{id, title, snippet, kind, source, timestamp, deepLinkId}]}`, best
 * first. Like the real gateway it refuses a request without the right key with 401, answers a
 * route it does not serve with 404, and, when the computer is off, never answers at all (the
 * request fails as React Native's fetch fails: `TypeError: Network request failed`).
 */

export const DESKTOP_SEARCH_ENDPOINT = 'http://192.168.1.62:7878'; // NOSONAR - private LAN test fixture

export interface DesktopRecord {
  id: string;
  title: string;
  snippet: string;
  kind: string;
  source: string;
  timestamp: number;
  deepLinkId?: string;
}

export interface DesktopSearch {
  /** Every query the computer was asked. */
  queries: string[];
  /** The computer is switched off (true) or back on (false). */
  setOffline: (offline: boolean) => void;
  /** Add a record the computer has seen (e.g. a chat synced from this phone). */
  remember: (record: DesktopRecord) => void;
  restore: () => void;
}

export function serveDesktopSearch(options: { apiKey: string; records: DesktopRecord[] }): DesktopSearch {
  const original = globalThis.fetch;
  const records = [...options.records];
  let offline = false;
  const state: DesktopSearch = {
    queries: [],
    setOffline: value => {
      offline = value;
    },
    remember: record => {
      records.unshift(record);
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== DESKTOP_SEARCH_ENDPOINT) return original(input, init);
    if (init?.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    if (offline) throw new TypeError('Network request failed');
    const authorization = new Headers(init?.headers).get('Authorization');
    if (authorization !== `Bearer ${options.apiKey}`) {
      return json({ error: { message: 'A valid API key is required.', type: 'authentication_error' } }, 401);
    }
    const method = (init?.method ?? 'GET').toUpperCase();
    // The rest of what a phone's connection check asks Desktop: no models in this fixture.
    if (method === 'GET' && url.pathname === '/v1/models') return json({ object: 'list', data: [] });
    if (method === 'GET' && url.pathname === '/v1/models/catalog') return json({ kinds: ['text'], models: [] });
    if (method === 'GET' && url.pathname === '/v1/models/installed') return json({ installed: [] });
    if (method === 'GET' && url.pathname === '/v1/models/active') return json({ text: null });
    if (method !== 'POST' || url.pathname !== '/v1/search') {
      return json({ error: { message: 'Not found', type: 'invalid_request_error' } }, 404);
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string; limit?: number };
    const query = (body.query ?? '').toLowerCase();
    state.queries.push(body.query ?? '');
    const data = records
      .filter(record => `${record.title} ${record.snippet}`.toLowerCase().includes(query))
      .slice(0, body.limit ?? 20)
      .map(record => ({ ...record, deepLinkId: record.deepLinkId ?? record.id }));
    return json({ object: 'list', data });
  }) as typeof globalThis.fetch;
  return state;
}
