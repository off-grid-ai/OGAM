/**
 * Behavior-faithful fake of an OAuth-protected remote MCP server, at the network and native
 * boundaries only. It layers on harness/mcpHttpFake (the in-memory MCP server over XMLHttpRequest)
 * and adds what a real OAuth MCP deployment does:
 *
 *   - XMLHttpRequest: the MCP endpoint refuses any request without a live Bearer token (401 +
 *     WWW-Authenticate with the RFC 9728 resource_metadata hint), as a protected server does.
 *   - fetch: the unauthenticated probe of the MCP URL answers the same 401, and can be held open
 *     to model a provider that is slow to answer.
 *   - The Keychain (react-native-keychain): an in-memory secure store that keeps what is written.
 *   - The system sign-in browser (react-native-inappbrowser-reborn): opens and stays open.
 *
 * Everything above those leaves (the OAuth client, token store, McpClient, mcpService, the store,
 * the screens) runs for real. Use createKeychainBoundary / createSignInBrowserBoundary inside
 * jest.mock factories, then installMcpOAuthFake in the test.
 *
 * Limit: the app loads the MCP SDK's discovery code with a dynamic `import()` of its ESM build
 * (pro/mcp/oauth/metadata.ts), which jest's CommonJS VM cannot run. A sign-in that gets past the
 * probe therefore fails under jest, so this fake cannot take a user all the way through the browser.
 */
import { installMcpHttpFake, type FakeMcpServer, type McpHttpFake } from './mcpHttpFake';

const AUTH_ISSUER = 'https://auth.example.test';
/** Where the app's token store keeps a server's tokens in the Keychain (pro/mcp/oauth/tokenStore.ts). */
const KEYCHAIN_TOKEN_SERVICE = (serverId: string) => `mcp_oauth_tokens_${serverId}`;

/** In-memory Keychain: what the app writes is what it reads back. */
export function createKeychainBoundary() {
  const items = new Map<string, string>();
  return {
    setGenericPassword: (username: string, password: string, opts?: { service?: string }) => {
      items.set(opts?.service ?? username, password);
      return Promise.resolve(true);
    },
    getGenericPassword: (opts?: { service?: string }) => {
      const key = opts?.service ?? '';
      return Promise.resolve(items.has(key) ? { username: 'mcp-oauth', password: items.get(key)!, service: key } : false);
    },
    resetGenericPassword: (opts?: { service?: string }) => {
      items.delete(opts?.service ?? '');
      return Promise.resolve(true);
    },
    ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  };
}

/** The system sign-in browser: it opens the page and waits for a user who has not finished yet. */
export function createSignInBrowserBoundary() {
  const opened: string[] = [];
  return {
    isAvailable: () => Promise.resolve(true),
    openAuth: (authUrl: string) => {
      opened.push(authUrl);
      return new Promise<never>(() => { /* the user is still on the sign-in page */ });
    },
    __opened: opened,
  };
}

type Keychain = ReturnType<typeof createKeychainBoundary>;

export interface McpOAuthFake extends McpHttpFake {
  /**
   * The user signed in to `mcpUrl` in an earlier session: the provider holds a live access token
   * (no refresh token, as many providers issue to public mobile clients) and the Keychain holds it.
   * Returns the OAuth metadata the app cached for that server when it signed in.
   */
  signedInEarlier: (serverId: string, mcpUrl: string) => Promise<{
    resource: string;
    auth: { issuer: string; authorizationEndpoint: string; tokenEndpoint: string; registrationEndpoint: string };
    client: { clientId: string };
  }>;
  /** Hold the provider's answer to the sign-in probe of `mcpUrl` until release(). */
  holdSignInProbe: (mcpUrl: string) => { release: () => void };
  restore: () => void;
}

/**
 * Install the fake. `servers` are the MCP servers by URL; every URL in `protectedUrls` requires a
 * Bearer token. Tokens live for `tokenLifetimeSec`, measured on the (fakeable) Date.now clock.
 */
export function installMcpOAuthFake(
  servers: Record<string, FakeMcpServer>,
  protectedUrls: string[],
  keychain: Keychain,
  tokenLifetimeSec = 3600,
): McpOAuthFake {
  const http = installMcpHttpFake(servers);
  const protectedSet = new Set(protectedUrls);
  const liveTokens = new Map<string, number>(); // access token -> expires at (ms)
  const probeHolds = new Map<string, Promise<void>>();
  const pendingReleases: Array<() => void> = [];
  let issued = 0;

  const resourceMetadataUrl = (mcpUrl: string) => {
    const u = new URL(mcpUrl);
    return `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`;
  };
  const challenge = (mcpUrl: string) => `Bearer resource_metadata="${resourceMetadataUrl(mcpUrl)}"`;

  // --- MCP endpoint: refuse requests without a live bearer token. ---
  const BaseXHR = (global as unknown as { XMLHttpRequest: new () => any }).XMLHttpRequest;
  class ProtectedMcpXHR extends BaseXHR {
    private targetUrl = '';
    private bearer: string | null = null;
    private ownHeaders: Record<string, string> = {};
    open(method: string, url: string): void { this.targetUrl = url; super.open(method, url); }
    setRequestHeader(name: string, value: string): void {
      if (name.toLowerCase() === 'authorization') this.bearer = value.replace(/^Bearer\s+/i, '');
      super.setRequestHeader(name, value);
    }
    getResponseHeader(name: string): string | null {
      return this.ownHeaders[name.toLowerCase()] ?? super.getResponseHeader(name);
    }
    send(payload: string): void {
      if (protectedSet.has(this.targetUrl)) {
        const expiresAt = this.bearer ? liveTokens.get(this.bearer) : undefined;
        if (expiresAt === undefined || expiresAt <= Date.now()) {
          setTimeout(() => {
            this.status = 401;
            this.responseText = '';
            this.ownHeaders = { 'www-authenticate': challenge(this.targetUrl) };
            this.onload?.();
          }, 0);
          return;
        }
      }
      super.send(payload);
    }
  }
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = ProtectedMcpXHR;

  // --- The unauthenticated probe over fetch. ---
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (protectedSet.has(url)) {
      const hold = probeHolds.get(url);
      probeHolds.delete(url);
      if (hold) await hold;
      return new Response('', { status: 401, headers: { 'www-authenticate': challenge(url) } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  return {
    ...http,
    signedInEarlier: async (serverId, mcpUrl) => {
      issued += 1;
      const accessToken = `access-${issued}`;
      const expiresAt = Date.now() + tokenLifetimeSec * 1000;
      liveTokens.set(accessToken, expiresAt);
      await keychain.setGenericPassword(
        'mcp-oauth',
        JSON.stringify({ accessToken, tokenType: 'Bearer', expiresAt }),
        { service: KEYCHAIN_TOKEN_SERVICE(serverId) },
      );
      return {
        resource: mcpUrl,
        auth: {
          issuer: AUTH_ISSUER,
          authorizationEndpoint: `${AUTH_ISSUER}/authorize`,
          tokenEndpoint: `${AUTH_ISSUER}/token`,
          registrationEndpoint: `${AUTH_ISSUER}/register`,
        },
        client: { clientId: 'offgrid-mobile-client' },
      };
    },
    holdSignInProbe: mcpUrl => {
      let release = () => {};
      probeHolds.set(mcpUrl, new Promise<void>(resolve => { release = resolve; }));
      pendingReleases.push(() => release());
      return { release: () => release() };
    },
    restore: () => {
      pendingReleases.splice(0).forEach(release => release());
      probeHolds.clear();
      global.fetch = originalFetch;
      http.restore();
    },
  };
}
