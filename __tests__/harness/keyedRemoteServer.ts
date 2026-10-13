/**
 * keyedRemoteServer — a behavior-faithful fake of a model server reached over HTTPS that requires an
 * API key, placed at the `fetch` boundary.
 *
 * Faithful to how LM Studio and Ollama answer behind an authenticating HTTPS front:
 *  - Every request without `Authorization: Bearer <key>` is refused with 401, on every path.
 *  - With the key, each flavour answers only the paths that server really serves, in its own shape;
 *    any other path is a 404, the way the real server answers an unknown route.
 *  - An aborted request rejects, so the caller's own deadline still governs.
 *
 * Nothing decides what the app should do: the real health check, discovery, capability probes,
 * stores and screens run on top and the outcome on screen is emergent.
 *
 * Also exports a stateful Keychain module (`keychainModule`) for `jest.mock('react-native-keychain')`.
 * It really stores and returns credentials, and can be told to fail reads, as the device Keychain does
 * when it is locked or its item is unreadable.
 */

export type ServerFlavour = 'lmstudio' | 'ollama';

export interface KeyedServerOptions {
  /** Origin the server answers on, e.g. 'https://studio.example.test'. */
  origin: string;
  flavour: ServerFlavour;
  /** Empty means the server accepts only anonymous requests. */
  apiKey: string;
  /** The model the server lists. */
  modelId: string;
}

export interface KeyedServerHandle {
  /** Every request the server received: path and whether it carried the right key. */
  readonly requests: ReadonlyArray<{ method: string; path: string; authorized: boolean }>;
  /** Refuse these paths with 401 even when the key is right (e.g. a token without inference rights). */
  refusePaths(paths: string[]): void;
  /** Answer every request with this status (e.g. 503 while the server restarts); null restores it. */
  failAll(status: number | null): void;
  restore(): void;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function lmStudioRoute(method: string, path: string, modelId: string): Response | null {
  if (method === 'GET' && path === '/v1/models') {
    return json({ object: 'list', data: [{ id: modelId, object: 'model', owned_by: 'organization_owner' }] });
  }
  if (method === 'GET' && path === '/api/v1/models') {
    return json({
      models: [{
        type: 'llm',
        key: modelId,
        display_name: modelId,
        max_context_length: 32768,
        capabilities: { vision: false, trained_for_tool_use: true },
      }],
    });
  }
  if (method === 'POST' && path === '/v1/chat/completions') {
    return new Response(
      'data: {"choices":[{"delta":{"role":"assistant","content":"Hi"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }
  return null;
}

function ollamaRoute(method: string, path: string, modelId: string): Response | null {
  if (method === 'GET' && path === '/v1/models') {
    return json({ object: 'list', data: [{ id: modelId, object: 'model', created: 1760000000, owned_by: 'library' }] });
  }
  if (method === 'GET' && path === '/api/tags') {
    return json({
      models: [{
        name: modelId,
        model: modelId,
        details: { family: 'llama', parameter_size: '3.2B', quantization_level: 'Q4_K_M' },
      }],
    });
  }
  if (method === 'POST' && path === '/api/show') {
    return json({
      capabilities: ['completion', 'tools'],
      model_info: { 'llama.context_length': 131072 },
      details: { family: 'llama' },
    });
  }
  return null;
}

/** Put one keyed server on the network. Requests to any other origin fall through to the previous fetch. */
export function installKeyedServer(opts: KeyedServerOptions): KeyedServerHandle {
  const original = globalThis.fetch;
  const requests: Array<{ method: string; path: string; authorized: boolean }> = [];
  let refused = new Set<string>();
  let failStatus: number | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== opts.origin) {
      if (!original) throw new TypeError('Network request failed');
      return original(input, init);
    }
    if (init?.signal?.aborted) throw new Error('Aborted');

    const method = (init?.method ?? 'GET').toUpperCase();
    const authorization = new Headers(init?.headers).get('Authorization');
    const authorized = opts.apiKey ? authorization === `Bearer ${opts.apiKey}` : authorization === null;
    requests.push({ method, path: url.pathname, authorized });

    if (failStatus !== null) return json({ error: 'unavailable' }, failStatus);
    if (!authorized || refused.has(url.pathname)) return json({ error: 'invalid api key' }, 401);
    const route = opts.flavour === 'lmstudio' ? lmStudioRoute : ollamaRoute;
    return route(method, url.pathname, opts.modelId) ?? json({ error: 'not found' }, 404);
  }) as typeof globalThis.fetch;

  return {
    requests,
    refusePaths: paths => { refused = new Set(paths); },
    failAll: status => { failStatus = status; },
    restore: () => { globalThis.fetch = original; },
  };
}

// ---------------------------------------------------------------------------
// Keychain
// ---------------------------------------------------------------------------

interface KeychainState {
  items: Map<string, { username: string; password: string }>;
  /** Services whose reads fail, as a locked or damaged Keychain item does on device. */
  unreadable: Set<string>;
}

const holder = globalThis as unknown as { __keyedServerKeychain?: KeychainState };

export function keychainState(): KeychainState {
  holder.__keyedServerKeychain ??= { items: new Map(), unreadable: new Set() };
  return holder.__keyedServerKeychain;
}

export function resetKeychain(): void {
  holder.__keyedServerKeychain = { items: new Map(), unreadable: new Set() };
}

/** Make every saved credential unreadable (or readable again). */
export function setKeychainUnreadable(unreadable: boolean): void {
  const state = keychainState();
  state.unreadable = unreadable ? new Set(state.items.keys()) : new Set();
}

/** The module for `jest.mock('react-native-keychain', () => require('<harness>').keychainModule())`. */
export function keychainModule() {
  return {
    ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock', WHEN_UNLOCKED: 'AccessibleWhenUnlocked' },
    setGenericPassword: async (username: string, password: string, options: { service: string }) => {
      keychainState().items.set(options.service, { username, password });
      return true;
    },
    getGenericPassword: async (options: { service: string }) => {
      const state = keychainState();
      if (state.unreadable.has(options.service)) {
        throw new Error('User interaction is not allowed.');
      }
      return state.items.get(options.service) ?? false;
    },
    resetGenericPassword: async (options: { service: string }) => {
      keychainState().items.delete(options.service);
      return true;
    },
  };
}
