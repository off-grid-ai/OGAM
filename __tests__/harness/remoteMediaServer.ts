/**
 * remoteMediaServer — a behavior-faithful fake of an OpenAI-compatible media server (a paired Desktop,
 * LM Studio, a gateway) at the `fetch` boundary.
 *
 * It answers only the media routes a real server serves, in their own shapes:
 *  - POST /v1/images/generations → `{ data: [{ b64_json }] }`
 *  - POST /v1/audio/transcriptions → `{ text }` (an empty object when the transcript is blank)
 *  - POST /v1/audio/speech → audio bytes with an audio content type
 * Any other path or origin answers 404. With `apiKey` set, a request without `Authorization: Bearer
 * <key>` is refused with 401, as an authenticating gateway does. With `hang`, the server accepts the
 * request and never answers; an aborted request rejects, as a closed socket does.
 *
 * It records each request it received (method, path, headers, body, redirect policy) so a test can read
 * what went over the wire. Nothing here decides what the app does with the answer.
 */

export interface RemoteMediaServerOptions {
  /** Origin the server answers on, e.g. 'http://192.168.1.30:7878'. */
  origin: string;
  /** Empty: the server accepts anonymous requests. */
  apiKey?: string;
  image?: string;
  /** The transcript; undefined answers `{}` (a server that heard nothing). */
  transcript?: string;
  speech?: { bytes: Uint8Array; contentType: string };
  /** Accept every request and never answer. */
  hang?: boolean;
}

export interface MediaRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  redirect: RequestInit['redirect'];
}

export interface RemoteMediaServerHandle {
  readonly requests: ReadonlyArray<MediaRequest>;
  restore(): void;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function installRemoteMediaServer(opts: RemoteMediaServerOptions): RemoteMediaServerHandle {
  const original = globalThis.fetch;
  const requests: MediaRequest[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== opts.origin) return original(input, init);
    if (init?.signal?.aborted) throw new Error('Aborted');

    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    // Keep the header names as the app wrote them, so a test reads `Authorization`, not `authorization`.
    for (const key of Object.keys((init?.headers as Record<string, string>) ?? {})) {
      headers[key] = (init?.headers as Record<string, string>)[key];
    }
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* not JSON: keep the text */ }
    }
    const method = (init?.method ?? 'GET').toUpperCase();
    requests.push({ method, path: url.pathname, headers, body, redirect: init?.redirect });

    if (opts.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    }
    if (opts.apiKey && new Headers(init?.headers).get('Authorization') !== `Bearer ${opts.apiKey}`) {
      return json({ error: 'invalid api key' }, 401);
    }
    if (method === 'POST' && url.pathname === '/v1/images/generations' && opts.image !== undefined) {
      return json({ data: [{ b64_json: opts.image }] });
    }
    if (method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
      return json(opts.transcript === undefined ? {} : { text: opts.transcript });
    }
    if (method === 'POST' && url.pathname === '/v1/audio/speech' && opts.speech) {
      return new Response(opts.speech.bytes, {
        status: 200,
        headers: { 'Content-Type': opts.speech.contentType },
      });
    }
    return json({ error: 'not found' }, 404);
  }) as typeof globalThis.fetch;

  return { requests, restore: () => { globalThis.fetch = original; } };
}
