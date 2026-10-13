/**
 * webSearchFake — the web search provider at the `fetch` boundary.
 *
 * The built-in web_search tool fetches a results page from the search provider. Whether that page
 * comes back, and with what status, is decided by the network, so this stands in for it: it answers
 * the provider's search URL with the status the test sets (a refusal, a rate limit, an outage) and
 * records each query. Every other URL falls through to the previous fetch. The real tool handler,
 * tool loop, chat store and chat render run on top.
 */
const SEARCH_ORIGIN = 'https://search.brave.com';

export interface WebSearchFake {
  readonly queries: readonly string[];
  /** Answer the next searches with this HTTP status and body. */
  respondWith(status: number, body?: string): void;
  restore(): void;
}

export function installWebSearchFake(initialStatus = 200): WebSearchFake {
  const original = globalThis.fetch;
  const queries: string[] = [];
  let status = initialStatus;
  let body = '<html><body></body></html>';

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== SEARCH_ORIGIN) {
      if (!original) throw new TypeError('Network request failed');
      return original(input, init);
    }
    if (init?.signal?.aborted) throw new Error('Aborted');
    queries.push(url.searchParams.get('q') ?? '');
    return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
  }) as typeof globalThis.fetch;

  return {
    queries,
    respondWith: (nextStatus, nextBody) => {
      status = nextStatus;
      if (nextBody !== undefined) body = nextBody;
    },
    restore: () => { globalThis.fetch = original; },
  };
}
