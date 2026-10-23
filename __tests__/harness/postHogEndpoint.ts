/**
 * Fake PostHog Cloud EU endpoint — the network boundary for opt-in analytics.
 *
 * Installed at `fetch` (the SDK's only transport), it records every request to a PostHog host and
 * answers like the real ingest API (`{ status: 1 }`). Every other URL still goes to the previous
 * fetch (jest.setup's "network disabled" guard), so no test ever reaches the real host. Events are
 * decoded exactly as the server would read them, including gzip bodies.
 */
import { gunzipSync } from 'node:zlib';

export interface PostHogEvent {
  event: string;
  distinct_id?: string;
  properties: Record<string, unknown>;
}

export interface PostHogEndpoint {
  /** Every URL the app requested on a PostHog host, in order. */
  readonly urls: string[];
  /** Every event delivered in a batch, in order. */
  readonly events: PostHogEvent[];
  /** The raw request bodies, decoded to text. */
  readonly bodies: string[];
  named(event: string): PostHogEvent[];
  restore(): void;
}

const POSTHOG_HOST = /^https:\/\/[a-z0-9.-]*posthog\.com\//i;

async function bodyBytes(body: unknown): Promise<Buffer> {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  const blob = body as { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof blob.arrayBuffer === 'function') return Buffer.from(new Uint8Array(await blob.arrayBuffer()));
  return Buffer.from(String(body), 'utf8');
}

async function decode(body: unknown): Promise<string> {
  const bytes = await bodyBytes(body);
  const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return (gzipped ? gunzipSync(bytes) : bytes).toString('utf8');
}

export function installPostHogEndpoint(): PostHogEndpoint {
  const urls: string[] = [];
  const events: PostHogEvent[] = [];
  const bodies: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!POSTHOG_HOST.test(url)) return previous(input, init);
    urls.push(url);
    const text = await decode(init?.body);
    bodies.push(text);
    if (text) {
      const payload = JSON.parse(text) as { batch?: PostHogEvent[] } & PostHogEvent;
      for (const event of payload.batch ?? [payload]) events.push(event);
    }
    return new Response(JSON.stringify({ status: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    urls,
    events,
    bodies,
    named: name => events.filter(event => event.event === name),
    restore: () => {
      globalThis.fetch = previous;
    },
  };
}
