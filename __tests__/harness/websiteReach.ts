/**
 * Our website at the network boundary. Before opening a page in the in-app sheet, the app checks
 * the site answers; this puts the site online or offline for a test, and leaves every other URL to
 * whatever fetch was installed before (the Jest default refuses them). Returns the undo.
 */
const SITE = 'https://getoffgridai.co/';

export function websiteReach(online: boolean): () => void {
  const before = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(SITE)) return before(input, init);
    if (!online) throw new TypeError('Network request failed');
    return new Response(null, { status: 200 });
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = before;
  };
}
