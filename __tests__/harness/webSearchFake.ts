/**
 * webSearchFake — the web search provider at the `fetch` boundary.
 *
 * The built-in web_search tool fetches a results page from the search provider. Whether that page
 * comes back, and with what status, is decided by the network, so this stands in for it: it answers
 * every provider's search URL with the status the test sets (a refusal, a rate limit, an outage) and
 * records each query. Every other URL falls through to the previous fetch. The real tool handler,
 * tool loop, chat store and chat render run on top.
 *
 * `serve` adds a provider the person set up themselves (their SearXNG server, the Brave Search API,
 * Tavily) at its own origin, with its own answer; `asked` lists every request in order.
 */
/** Every built-in provider web_search asks, in turn (@offgrid/models): DuckDuckGo Lite, Bing's RSS feed, Brave. */
const SEARCH_ORIGINS = new Set([
  'https://lite.duckduckgo.com',
  'https://www.bing.com',
  'https://search.brave.com',
]);
const FIRST_BUILT_IN = 'https://lite.duckduckgo.com';

export interface WebSearchFake {
  readonly queries: readonly string[];
  /** Every search request, in order: its URL and the headers and body it carried. */
  readonly asked: ReadonlyArray<{ url: string; headers: Record<string, string>; body?: string }>;
  /** Answer requests to this origin with this status and body (a server or API the person set up). */
  serve(origin: string, status: number, body: string): void;
  /** Answer the next searches with this HTTP status and body. */
  respondWith(status: number, body?: string): void;
  restore(): void;
}

export function installWebSearchFake(initialStatus = 200): WebSearchFake {
  const original = globalThis.fetch;
  const queries: string[] = [];
  const asked: { url: string; headers: Record<string, string>; body?: string }[] = [];
  const served = new Map<string, { status: number; body: string }>();
  let status = initialStatus;
  let body = '<html><body></body></html>';

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
    const url = new URL(href);
    if (!SEARCH_ORIGINS.has(url.origin) && !served.has(url.origin)) {
      if (!original) throw new TypeError('Network request failed');
      return original(input, init);
    }
    if (init?.signal?.aborted) throw new Error('Aborted');
    asked.push({
      url: href,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const own = served.get(url.origin);
    if (own) {
      return new Response(own.body, { status: own.status, headers: { 'Content-Type': 'application/json' } });
    }
    const form =
      typeof init?.body === 'string' ? new URLSearchParams(init.body) : null;
    // Every built-in search starts at the first provider; the ones after it are asked the same query.
    if (url.origin === FIRST_BUILT_IN)
      queries.push(url.searchParams.get('q') ?? form?.get('q') ?? '');
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'text/html' },
    });
  }) as typeof globalThis.fetch;

  return {
    queries,
    asked,
    serve: (origin, nextStatus, nextBody) => {
      served.set(origin, { status: nextStatus, body: nextBody });
    },
    respondWith: (nextStatus, nextBody) => {
      status = nextStatus;
      if (nextBody !== undefined) body = nextBody;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
