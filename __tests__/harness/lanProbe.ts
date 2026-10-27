/**
 * lanProbe — a behavior-faithful fake of the LAN at the `fetch` boundary.
 *
 * The scan asks 254 addresses on three ports whether an LLM server answers. That question is
 * settled by the network, which is outside our system, so this stands in for it. Everything above
 * it runs REAL: the subnet maths, the worker pool, the provider table, the aggregation, the
 * manager that adds the server, the store, and the screen.
 *
 * Faithful to how a subnet actually replies:
 *  - A host that is listening answers 200 with its model list.
 *  - Every other address REFUSES, the way a live host with a closed port does. Nothing here
 *    resolves out of a hat: the scan finds a server only if the real code asks the right address,
 *    on the right port, at the right path.
 *  - An aborted request rejects, so the caller's own deadline still governs.
 */

interface LiveHost {
  /** Paths this host answers, e.g. '/v1/models'. Any other path refuses, as a real server does. */
  paths: string[];
  /** The body it returns, device-shaped for an OpenAI-compatible server. */
  body: unknown;
  /**
   * Off Grid AI Desktop with API keys on: every API path answers 401, while /health stays open and
   * names the gateway, as Desktop's gateway does.
   */
  locked?: boolean;
}

export interface LanProbeHandle {
  /** Every URL the scan asked for, in order. Lets a test prove WHICH ports were tried. */
  readonly requested: readonly string[];
  uninstall: () => void;
}

const OPENAI_MODEL_LIST = {
  object: 'list',
  data: [
    { id: 'Qwen3.5-0.8B-GGUF', object: 'model', owned_by: 'offgrid' },
    { id: 'SmolVLM-500M', object: 'model', owned_by: 'offgrid' },
  ],
};

/** The body an Off Grid AI Desktop gateway returns from /v1/models. */
export const gatewayModelList = OPENAI_MODEL_LIST;

/**
 * Put the given hosts on the network for the duration of a test.
 *
 * @param live keyed by `host:port` — every address NOT listed refuses, like a real subnet.
 */
export function installLanProbe(live: Record<string, LiveHost>): LanProbeHandle {
  const original = global.fetch;
  const requested: string[] = [];

  const fake = (input: unknown, init?: { signal?: AbortSignal }): Promise<Response> => {
    const url = String(input);
    requested.push(url);

    if (init?.signal?.aborted) {
      return Promise.reject(new Error('Aborted'));
    }

    const match = /^https?:\/\/([^/]+)(\/.*)?$/.exec(url);
    const authority = match?.[1] ?? '';
    const path = match?.[2] ?? '/';
    const host = live[authority];

    if (!host || !(host.paths.some(allowed => path.startsWith(allowed)) || (host.locked && path.startsWith('/health')))) {
      // A closed port refuses at once. This is what the great majority of a /24 does.
      return Promise.reject(new Error('Network request failed'));
    }

    if (host.locked && path.startsWith('/v1/')) {
      return Promise.resolve({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) } as unknown as Response);
    }
    if (host.locked && path.startsWith('/health')) {
      const health = { name: 'Off Grid AI — local model gateway' };
      return Promise.resolve({ ok: true, status: 200, json: async () => health, text: async () => JSON.stringify(health) } as unknown as Response);
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => host.body,
      text: async () => JSON.stringify(host.body),
    } as unknown as Response);
  };

  global.fetch = fake as unknown as typeof global.fetch;

  return {
    requested,
    uninstall: () => {
      global.fetch = original;
    },
  };
}
