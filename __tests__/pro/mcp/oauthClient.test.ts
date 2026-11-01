/**
 * Real tests for the MCP OAuth flow: pkce.ts + tokenStore.ts + metadata.ts + oauthClient.ts.
 *
 * Faked (device and network edges only):
 *   - global.fetch: the MCP server and its authorization server answer over HTTP: the
 *     protected-resource and authorization-server metadata, dynamic client registration, and the
 *     token endpoint (see serveAuthServer below).
 *   - Date.now: the expiry clock (for isAccessTokenExpired branches).
 *   - The native adapters (sign-in browser, Keychain, crypto), through configureOAuthAdapters.
 * Discovery runs the real MCP SDK over that fetch: the app loads the SDK's ESM build with a
 * dynamic import(), which jest's CommonJS VM cannot run, so the same SDK's CommonJS build is
 * served in its place. Everything that is ours runs for real.
 */

jest.mock(
  '@modelcontextprotocol/sdk/dist/esm/client/auth.js',
  () => require('../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/client/auth.js'),
  { virtual: true },
);

import {
  base64UrlEncode,
  randomUrlToken,
  generatePkce,
} from '@offgrid/pro/mcp/oauth/pkce';
import {
  configureOAuthAdapters,
  _resetOAuthAdaptersForTesting,
  type CryptoAdapter,
} from '@offgrid/pro/mcp/oauth/adapters';
import {
  exchangeCodeForTokens,
  refreshAccessToken,
  loadTokens,
  saveTokens,
  clearTokens,
  isAccessTokenExpired,
} from '@offgrid/pro/mcp/oauth/tokenStore';
import {
  authorizeServer,
  ensureAccessToken,
  forceRefresh,
  revokeLocalTokens,
} from '@offgrid/pro/mcp/oauth/oauthClient';
import { NeedsAuthorizationError, OAuthError } from '@offgrid/pro/mcp/oauth/types';
import type {
  AuthServerMetadata,
  OAuthServerMetadata,
  OAuthTokens,
} from '@offgrid/pro/mcp/oauth/types';
import { isUnder } from '../../harness/urlMatch';

// ---- dumb in-memory native fakes (the injected seam, not the code under test) ----

/** A real in-memory key/value store standing in for the Keychain. */
class MemStore {
  map = new Map<string, string>();
  getItem = jest.fn(async (k: string) => (this.map.has(k) ? this.map.get(k)! : null));
  setItem = jest.fn(async (k: string, v: string) => {
    this.map.set(k, v);
  });
  removeItem = jest.fn(async (k: string) => {
    this.map.delete(k);
  });
}

/** Deterministic crypto: randomBytes = 0,1,2,...; sha256 = fixed 32-byte digest. */
const fakeCrypto: CryptoAdapter = {
  randomBytes: jest.fn(async (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 256)),
  sha256: jest.fn(async (_input: string) => Uint8Array.from({ length: 32 }, (_, i) => (i * 7) % 256)),
};

let mem: MemStore;
let browserAuthorize: jest.Mock;

function fetchOk(json: any): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
    headers: { get: () => null },
  } as unknown as Response;
}

function fetchErr(status: number, body = 'boom'): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

const AUTH: AuthServerMetadata = {
  issuer: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  registrationEndpoint: 'https://auth.example.com/register',
  scopesSupported: ['read', 'write'],
  tokenEndpointAuthMethodsSupported: ['none'],
};

function metadata(over: Partial<AuthServerMetadata> = {}): OAuthServerMetadata {
  return {
    resource: 'https://mcp.example.com',
    auth: { ...AUTH, ...over },
    client: { clientId: 'client-123' },
  };
}

/** One request the app made to the fake MCP / authorization server. */
interface AuthRequest {
  method: string;
  url: string;
  body: string;
}

/**
 * The MCP server at https://mcp.example.com and its authorization server, over fetch. The MCP
 * server publishes protected-resource metadata naming the authorization server; that server
 * publishes its metadata, registers clients, and answers the token endpoint with `tokens` in order.
 * Returns every request the app made, in order.
 */
function serveAuthServer(opts: {
  metadata?: Record<string, unknown>;
  noRegistration?: boolean;
  tokens?: Array<Record<string, unknown>>;
} = {}): AuthRequest[] {
  const requests: AuthRequest[] = [];
  const tokens = [...(opts.tokens ?? [])];
  const meta: Record<string, unknown> = {
    issuer: AUTH.issuer,
    authorization_endpoint: AUTH.authorizationEndpoint,
    token_endpoint: AUTH.tokenEndpoint,
    registration_endpoint: AUTH.registrationEndpoint,
    scopes_supported: AUTH.scopesSupported,
    token_endpoint_auth_methods_supported: ['none'],
    response_types_supported: ['code'],
    ...opts.metadata,
  };
  if (opts.noRegistration) delete meta.registration_endpoint;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    requests.push({ method, url, body: typeof init?.body === 'string' ? init.body : '' });
    if (isUnder(url, 'https://mcp.example.com/.well-known/oauth-protected-resource')) {
      return json({ resource: 'https://mcp.example.com', authorization_servers: [AUTH.issuer] });
    }
    if (isUnder(url, `${AUTH.issuer}/.well-known`)) return json(meta);
    if (method === 'POST' && url === meta.registration_endpoint) return json({ client_id: 'reg' }, 201);
    if (method === 'POST' && url === AUTH.tokenEndpoint) {
      const next = tokens.shift();
      return next ? json(next) : json({ error: 'invalid_grant' }, 400);
    }
    return new Response('not found', { status: 404 });
  });
  return requests;
}

/** The form body the app posted to the token endpoint (the code exchange). */
function exchangeBody(requests: AuthRequest[]): string {
  const exchange = requests.find(r => r.method === 'POST' && r.url === AUTH.tokenEndpoint);
  if (!exchange) throw new Error('the app never called the token endpoint');
  return exchange.body;
}

const registrations = (requests: AuthRequest[]) =>
  requests.filter(r => r.method === 'POST' && r.url === AUTH.registrationEndpoint);

let idCounter = 0;
/** Unique serverId per test so the module-level tokenCache never bleeds across tests. */
function sid(): string {
  return `srv-${idCounter++}`;
}

beforeEach(() => {
  _resetOAuthAdaptersForTesting();
  mem = new MemStore();
  browserAuthorize = jest.fn();
  configureOAuthAdapters({
    browser: { authorize: (url: string, redir: string) => browserAuthorize(url, redir) },
    storage: mem,
    crypto: fakeCrypto,
    redirectUri: 'offgrid://oauth/callback',
    clientName: 'Off Grid AI',
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ============================ pkce.ts ============================

describe('base64UrlEncode', () => {
  it('encodes with no padding and url-safe alphabet across all remainder lengths', () => {
    // rem === 0 (multiple of 3)
    expect(base64UrlEncode(Uint8Array.from([0, 0, 0]))).toBe('AAAA');
    // rem === 1
    expect(base64UrlEncode(Uint8Array.from([255]))).toBe('_w');
    // rem === 2
    expect(base64UrlEncode(Uint8Array.from([255, 255]))).toBe('__8');
    // empty -> empty
    expect(base64UrlEncode(Uint8Array.from([]))).toBe('');
  });

  it('uses - and _ (url-safe) rather than + and /', () => {
    // 0xfb,0xff,0xbf -> would be "+/+/" in std base64; url-safe swaps to -_-_
    const out = base64UrlEncode(Uint8Array.from([0xfb, 0xef, 0xbe]));
    expect(out).not.toMatch(/[+/=]/);
    expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('randomUrlToken', () => {
  it('encodes exactly the requested number of random bytes', async () => {
    const tok = await randomUrlToken(fakeCrypto, 32);
    // 32 bytes -> ceil(32*8/6) = 43 base64url chars, no padding
    expect(tok).toHaveLength(43);
    expect(fakeCrypto.randomBytes).toHaveBeenCalledWith(32);
  });

  it('defaults to 32 bytes when no length given', async () => {
    await randomUrlToken(fakeCrypto);
    expect(fakeCrypto.randomBytes).toHaveBeenCalledWith(32);
  });
});

describe('generatePkce', () => {
  it('produces a 43-char verifier and a challenge that is the base64url of sha256(verifier)', async () => {
    const pair = await generatePkce(fakeCrypto);
    expect(pair.verifier).toHaveLength(43);
    // challenge must equal encoding of the digest our fake sha256 returns
    const digest = await fakeCrypto.sha256(pair.verifier);
    expect(pair.challenge).toBe(base64UrlEncode(digest));
    // it actually hashed the verifier, not something else
    expect(fakeCrypto.sha256).toHaveBeenCalledWith(pair.verifier);
  });
});

// ============================ tokenStore.ts ============================

describe('isAccessTokenExpired', () => {
  const base: OAuthTokens = { accessToken: 'a', tokenType: 'Bearer' };

  it('is expired when there is no access token', () => {
    expect(isAccessTokenExpired({ ...base, accessToken: '' })).toBe(true);
  });

  it('is NOT expired when expiresAt is undefined (unknown = long-lived)', () => {
    expect(isAccessTokenExpired({ ...base, expiresAt: undefined })).toBe(false);
  });

  it('respects the 60s skew: expired within the skew window, valid before it', () => {
    const now = 1_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    // expiresAt 30s out -> inside 60s skew -> treated expired
    expect(isAccessTokenExpired({ ...base, expiresAt: now + 30_000 })).toBe(true);
    // expiresAt 90s out -> beyond skew -> still valid
    expect(isAccessTokenExpired({ ...base, expiresAt: now + 90_000 })).toBe(false);
    // exactly at the skew boundary (now >= expiresAt - skew) -> expired
    expect(isAccessTokenExpired({ ...base, expiresAt: now + 60_000 })).toBe(true);
  });
});

describe('save/load/clear token cache', () => {
  it('saveTokens persists to storage and load returns the same object', async () => {
    const id = sid();
    const tokens: OAuthTokens = { accessToken: 'ax', refreshToken: 'rx', tokenType: 'Bearer' };
    await saveTokens(id, tokens);
    // stored under the prefixed key
    expect(mem.map.has(`mcp_oauth_tokens_${id}`)).toBe(true);
    await expect(loadTokens(id)).resolves.toEqual(tokens);
  });

  it('load serves from the in-memory cache without a second storage read', async () => {
    const id = sid();
    await saveTokens(id, { accessToken: 'a', tokenType: 'Bearer' });
    mem.getItem.mockClear();
    await loadTokens(id); // cached from the save
    await loadTokens(id);
    expect(mem.getItem).not.toHaveBeenCalled();
  });

  it('load returns null and caches the null when storage is empty', async () => {
    const id = sid();
    await expect(loadTokens(id)).resolves.toBeNull();
    expect(mem.getItem).toHaveBeenCalledTimes(1);
    await loadTokens(id); // second call served from cache
    expect(mem.getItem).toHaveBeenCalledTimes(1);
  });

  it('load returns null (does not throw) when stored JSON is corrupt', async () => {
    const id = sid();
    mem.map.set(`mcp_oauth_tokens_${id}`, '{not json');
    await expect(loadTokens(id)).resolves.toBeNull();
  });

  it('clearTokens removes from storage and load then returns null', async () => {
    const id = sid();
    await saveTokens(id, { accessToken: 'a', tokenType: 'Bearer' });
    await clearTokens(id);
    expect(mem.map.has(`mcp_oauth_tokens_${id}`)).toBe(false);
    mem.getItem.mockClear();
    await expect(loadTokens(id)).resolves.toBeNull();
    expect(mem.getItem).not.toHaveBeenCalled(); // cached null
  });
});

describe('exchangeCodeForTokens / refreshAccessToken (token endpoint)', () => {
  it('exchange posts an authorization_code form and parses the token response', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        fetchOk({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'read' }),
      );
    jest.spyOn(Date, 'now').mockReturnValue(1_000);

    const tokens = await exchangeCodeForTokens({
      auth: AUTH,
      client: { clientId: 'c1', clientSecret: 'sec' },
      code: 'the-code',
      codeVerifier: 'verif',
      redirectUri: 'offgrid://oauth/callback',
      resource: 'https://mcp.example.com',
    });

    expect(tokens).toEqual({
      accessToken: 'AT',
      refreshToken: 'RT',
      tokenType: 'Bearer',
      scope: 'read',
      expiresAt: 1_000 + 3600 * 1000,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(AUTH.tokenEndpoint);
    const body = (init as RequestInit).body as string;
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=the-code');
    expect(body).toContain('code_verifier=verif');
    expect(body).toContain('client_secret=sec');
  });

  it('defaults tokenType to Bearer and leaves expiresAt undefined when no expires_in', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(fetchOk({ access_token: 'AT' }));
    const tokens = await refreshAccessToken({
      auth: AUTH,
      client: { clientId: 'c1' },
      refreshToken: 'RT',
      resource: 'r',
    });
    expect(tokens.tokenType).toBe('Bearer');
    expect(tokens.expiresAt).toBeUndefined();
    expect(tokens.refreshToken).toBeUndefined();
  });

  it('refresh posts a refresh_token grant', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(fetchOk({ access_token: 'AT2' }));
    await refreshAccessToken({ auth: AUTH, client: { clientId: 'c1' }, refreshToken: 'the-rt', resource: 'r' });
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=the-rt');
  });

  it('throws OAuthError with token_response_invalid when access_token missing', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(fetchOk({ refresh_token: 'only-refresh' }));
    await expect(
      refreshAccessToken({ auth: AUTH, client: { clientId: 'c1' }, refreshToken: 'r', resource: 'r' }),
    ).rejects.toMatchObject({ code: 'token_response_invalid' });
  });

  it('throws OAuthError with token_http_error on a non-ok response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(fetchErr(400, 'invalid_grant'));
    await expect(
      refreshAccessToken({ auth: AUTH, client: { clientId: 'c1' }, refreshToken: 'r', resource: 'r' }),
    ).rejects.toMatchObject({ code: 'token_http_error' });
  });
});

// ============================ oauthClient.ts ============================

describe('authorizeServer (interactive flow)', () => {
  /** The browser returns to the app with `query`, carrying the state the app sent when asked. */
  function signInReturns(query: (state: string) => string) {
    browserAuthorize.mockImplementation(async (authUrl: string) => {
      const state = new URL(authUrl).searchParams.get('state')!;
      return `offgrid://oauth/callback${query(state)}`;
    });
  }

  it('runs discover -> register(DCR) -> browser -> exchange -> store and returns metadata + saves tokens', async () => {
    const id = sid();
    const requests = serveAuthServer({ tokens: [{ access_token: 'ACCESS', refresh_token: 'REFRESH' }] });
    browserAuthorize.mockImplementation(async (authUrl: string) => {
      // Verify the URL carries PKCE + our state; echo back the real state so it matches.
      const state = new URL(authUrl).searchParams.get('state')!;
      expect(new URL(authUrl).searchParams.get('code_challenge_method')).toBe('S256');
      expect(new URL(authUrl).searchParams.get('scope')).toBe('read write');
      return `offgrid://oauth/callback?code=AUTHCODE&state=${state}`;
    });

    const result = await authorizeServer(id, 'https://mcp.example.com');

    expect(result.client.clientId).toBe('reg');
    expect(result.auth.tokenEndpoint).toBe(AUTH.tokenEndpoint);
    // tokens actually persisted through the real store
    await expect(loadTokens(id)).resolves.toMatchObject({ accessToken: 'ACCESS', refreshToken: 'REFRESH' });
    // the app registered once, then exchanged our authorization code with the registered client id
    expect(registrations(requests)).toHaveLength(1);
    expect(exchangeBody(requests)).toContain('code=AUTHCODE');
    expect(exchangeBody(requests)).toContain('client_id=reg');
  });

  it('uses a manualClient and skips DCR (only the exchange reaches the authorization server)', async () => {
    const id = sid();
    const requests = serveAuthServer({ tokens: [{ access_token: 'MAN_ACCESS' }] });
    signInReturns(state => `?code=CODE2&state=${state}`);

    const result = await authorizeServer(id, 'https://mcp.example.com', {
      manualClient: { clientId: 'manual-id', clientSecret: 'manual-secret' },
    });

    expect(result.client).toEqual({ clientId: 'manual-id', clientSecret: 'manual-secret' });
    // no registration call; exactly one token exchange
    expect(registrations(requests)).toHaveLength(0);
    expect(requests.filter(r => r.url === AUTH.tokenEndpoint)).toHaveLength(1);
    expect(exchangeBody(requests)).toContain('client_id=manual-id');
    await expect(loadTokens(id)).resolves.toMatchObject({ accessToken: 'MAN_ACCESS' });
  });

  it('throws no_redirect_uri when no redirect URI is configured', async () => {
    _resetOAuthAdaptersForTesting();
    configureOAuthAdapters({ crypto: fakeCrypto, storage: mem, redirectUri: '' });
    await expect(authorizeServer(sid(), 'https://mcp.example.com')).rejects.toMatchObject({
      code: 'no_redirect_uri',
    });
  });

  it('throws no_dcr when there is neither a manual client nor a registration endpoint', async () => {
    const id = sid();
    // The authorization server publishes NO registration_endpoint -> no DCR path.
    serveAuthServer({ noRegistration: true });
    await expect(authorizeServer(id, 'https://mcp.example.com')).rejects.toMatchObject({ code: 'no_dcr' });
  });

  it('surfaces an authorization-denied error from the callback', async () => {
    const id = sid();
    serveAuthServer();
    browserAuthorize.mockResolvedValue(
      'offgrid://oauth/callback?error=access_denied&error_description=user%20said%20no',
    );
    await expect(authorizeServer(id, 'https://mcp.example.com')).rejects.toMatchObject({
      code: 'access_denied',
      message: expect.stringContaining('user said no'),
    });
  });

  it('falls back to the raw error code when error_description is absent (?? branch)', async () => {
    const id = sid();
    serveAuthServer();
    // no error_description -> message uses the bare `error` value
    browserAuthorize.mockResolvedValue('offgrid://oauth/callback?error=server_error');
    await expect(authorizeServer(id, 'https://mcp.example.com')).rejects.toMatchObject({
      code: 'server_error',
      message: expect.stringContaining('server_error'),
    });
  });

  it('builds an auth URL with & when the endpoint already has a query, and omits scope when none advertised', async () => {
    const id = sid();
    // endpoint already carries a query string; and no scopes_supported -> no `scope` param
    serveAuthServer({
      metadata: {
        authorization_endpoint: 'https://auth.example.com/authorize?ui=dark',
        scopes_supported: undefined,
      },
      tokens: [{ access_token: 'A' }],
    });
    let captured = '';
    browserAuthorize.mockImplementation(async (authUrl: string) => {
      captured = authUrl;
      const state = new URL(authUrl).searchParams.get('state')!;
      return `offgrid://oauth/callback?code=Z&state=${state}`;
    });

    await authorizeServer(id, 'https://mcp.example.com');
    // existing query preserved, params appended with & (not a second ?)
    expect(captured.startsWith('https://auth.example.com/authorize?ui=dark&')).toBe(true);
    expect(captured).not.toContain('scope=');
  });

  it('throws state_mismatch when the callback state does not match (CSRF guard)', async () => {
    const id = sid();
    serveAuthServer();
    browserAuthorize.mockResolvedValue('offgrid://oauth/callback?code=X&state=WRONG');
    await expect(authorizeServer(id, 'https://mcp.example.com')).rejects.toMatchObject({ code: 'state_mismatch' });
  });

  it('treats a callback with no query string as empty params (state_mismatch)', async () => {
    const id = sid();
    serveAuthServer();
    // no '?' at all -> parseCallbackParams returns {} -> params.state (undefined) !== state
    browserAuthorize.mockResolvedValue('offgrid://oauth/callback');
    await expect(authorizeServer(id, 'https://mcp.example.com')).rejects.toMatchObject({ code: 'state_mismatch' });
  });

  it('skips malformed callback pairs that have no = and still reads the valid ones', async () => {
    const id = sid();
    const requests = serveAuthServer({ tokens: [{ access_token: 'A' }] });
    // "junk" pair (no '=') is skipped; code + state still parsed
    signInReturns(state => `?junk&code=GOODCODE&state=${state}`);
    await authorizeServer(id, 'https://mcp.example.com');
    expect(exchangeBody(requests)).toContain('code=GOODCODE');
  });

  it('throws no_code when the callback has a matching state but no code', async () => {
    const id = sid();
    serveAuthServer();
    signInReturns(state => `?state=${state}`);
    await expect(authorizeServer(id, 'https://mcp.example.com')).rejects.toMatchObject({ code: 'no_code' });
  });
});

describe('ensureAccessToken', () => {
  it('throws NeedsAuthorizationError when there are no stored tokens', async () => {
    const id = sid();
    await expect(ensureAccessToken(id, metadata())).rejects.toBeInstanceOf(NeedsAuthorizationError);
  });

  it('returns the current token unchanged when it is not expired (no network)', async () => {
    const id = sid();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await saveTokens(id, { accessToken: 'STILL_GOOD', tokenType: 'Bearer', expiresAt: 2_000_000 });
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(ensureAccessToken(id, metadata())).resolves.toBe('STILL_GOOD');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears tokens and needs-auth when expired with NO refresh token', async () => {
    const id = sid();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await saveTokens(id, { accessToken: 'OLD', tokenType: 'Bearer', expiresAt: 1 }); // long expired
    await expect(ensureAccessToken(id, metadata())).rejects.toBeInstanceOf(NeedsAuthorizationError);
    // token was cleared as a side effect
    await expect(loadTokens(id)).resolves.toBeNull();
  });

  it('refreshes silently when expired WITH a refresh token, persists, and returns the new token', async () => {
    const id = sid();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await saveTokens(id, { accessToken: 'OLD', refreshToken: 'RT', tokenType: 'Bearer', expiresAt: 1 });
    jest.spyOn(global, 'fetch').mockResolvedValue(fetchOk({ access_token: 'FRESH' }));
    await expect(ensureAccessToken(id, metadata())).resolves.toBe('FRESH');
    // the fresh tokens were persisted AND kept the old refresh token (server omitted one)
    await expect(loadTokens(id)).resolves.toMatchObject({ accessToken: 'FRESH', refreshToken: 'RT' });
  });

  it('keeps a server-provided new refresh token over the old one', async () => {
    const id = sid();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await saveTokens(id, { accessToken: 'OLD', refreshToken: 'OLD_RT', tokenType: 'Bearer', expiresAt: 1 });
    jest.spyOn(global, 'fetch').mockResolvedValue(fetchOk({ access_token: 'FRESH', refresh_token: 'NEW_RT' }));
    await ensureAccessToken(id, metadata());
    await expect(loadTokens(id)).resolves.toMatchObject({ refreshToken: 'NEW_RT' });
  });

  it('clears tokens and needs-auth when the refresh call fails', async () => {
    const id = sid();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await saveTokens(id, { accessToken: 'OLD', refreshToken: 'RT', tokenType: 'Bearer', expiresAt: 1 });
    jest.spyOn(global, 'fetch').mockResolvedValue(fetchErr(401, 'invalid_grant'));
    await expect(ensureAccessToken(id, metadata())).rejects.toBeInstanceOf(NeedsAuthorizationError);
    await expect(loadTokens(id)).resolves.toBeNull();
  });
});

describe('forceRefresh', () => {
  it('returns false and clears tokens when there is no refresh token', async () => {
    const id = sid();
    await saveTokens(id, { accessToken: 'A', tokenType: 'Bearer' }); // no refreshToken
    await expect(forceRefresh(id, metadata())).resolves.toBe(false);
    await expect(loadTokens(id)).resolves.toBeNull();
  });

  it('returns false and clears tokens when there are no tokens at all', async () => {
    const id = sid();
    await expect(forceRefresh(id, metadata())).resolves.toBe(false);
  });

  it('returns true and persists refreshed tokens on success', async () => {
    const id = sid();
    await saveTokens(id, { accessToken: 'A', refreshToken: 'RT', tokenType: 'Bearer' });
    jest.spyOn(global, 'fetch').mockResolvedValue(fetchOk({ access_token: 'FORCED' }));
    await expect(forceRefresh(id, metadata())).resolves.toBe(true);
    await expect(loadTokens(id)).resolves.toMatchObject({ accessToken: 'FORCED', refreshToken: 'RT' });
  });

  it('keeps a server-provided new refresh token on a forced refresh', async () => {
    const id = sid();
    await saveTokens(id, { accessToken: 'A', refreshToken: 'OLD_RT', tokenType: 'Bearer' });
    jest.spyOn(global, 'fetch').mockResolvedValue(fetchOk({ access_token: 'F', refresh_token: 'NEW_RT' }));
    await expect(forceRefresh(id, metadata())).resolves.toBe(true);
    await expect(loadTokens(id)).resolves.toMatchObject({ accessToken: 'F', refreshToken: 'NEW_RT' });
  });

  it('returns false and clears tokens when the refresh call throws', async () => {
    const id = sid();
    await saveTokens(id, { accessToken: 'A', refreshToken: 'RT', tokenType: 'Bearer' });
    jest.spyOn(global, 'fetch').mockResolvedValue(fetchErr(400));
    await expect(forceRefresh(id, metadata())).resolves.toBe(false);
    await expect(loadTokens(id)).resolves.toBeNull();
  });
});

describe('revokeLocalTokens', () => {
  it('forgets a server’s tokens', async () => {
    const id = sid();
    await saveTokens(id, { accessToken: 'A', refreshToken: 'RT', tokenType: 'Bearer' });
    await revokeLocalTokens(id);
    await expect(loadTokens(id)).resolves.toBeNull();
    expect(mem.map.has(`mcp_oauth_tokens_${id}`)).toBe(false);
  });
});

// ============================ integration: authorize -> ensure -> revoke ============================

describe('integration: connect, use, refresh, disconnect (real cross-module path)', () => {
  it('authorizes, then ensureAccessToken serves the token, refreshes when it expires, then revoke needs-auth', async () => {
    const id = sid();
    const meta = metadata();

    // 1) connect: discovery + DCR + browser + exchange, all real orchestration
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    serveAuthServer({
      tokens: [
        { access_token: 'T1', refresh_token: 'R1', expires_in: 3600 }, // exchange
        { access_token: 'T2' }, // refresh later
      ],
    });
    browserAuthorize.mockImplementation(async (authUrl: string) => {
      const state = new URL(authUrl).searchParams.get('state')!;
      return `offgrid://oauth/callback?code=C&state=${state}`;
    });

    const resolved = await authorizeServer(id, 'https://mcp.example.com');
    expect(resolved.client.clientId).toBe('reg');

    // 2) use it right away — not expired, returns T1 from the real store, no refresh fetch
    await expect(ensureAccessToken(id, resolved)).resolves.toBe('T1');

    // 3) clock advances past expiry -> silent refresh mints T2 and keeps R1
    now += 3600 * 1000 + 10_000;
    await expect(ensureAccessToken(id, resolved)).resolves.toBe('T2');
    await expect(loadTokens(id)).resolves.toMatchObject({ accessToken: 'T2', refreshToken: 'R1' });

    // 4) disconnect -> next ensure needs authorization again
    await revokeLocalTokens(id);
    await expect(ensureAccessToken(id, meta)).rejects.toBeInstanceOf(NeedsAuthorizationError);
  });
});

// A sanity guard that OAuthError is what the module throws (type identity, not just shape).
describe('error types', () => {
  it('token endpoint failures are OAuthError instances', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(fetchErr(500));
    await expect(
      exchangeCodeForTokens({
        auth: AUTH,
        client: { clientId: 'c' },
        code: 'x',
        codeVerifier: 'v',
        redirectUri: 'r',
        resource: 'r',
      }),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});
