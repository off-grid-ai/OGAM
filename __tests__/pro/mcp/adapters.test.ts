/**
 * Real tests for the MCP OAuth native-adapter registry.
 *
 * NOTE: the task named `pro/mcp/adapters.ts`, but no such file exists in the pro
 * submodule. The only adapters module under the mcp tree is `pro/mcp/oauth/adapters.ts`
 * (the native-adapter seam / registry). That is the real, testable module, so these
 * tests drive it directly through the `@offgrid/pro` alias.
 *
 * This module is pure TypeScript (no native/network/clock boundaries), so nothing is
 * mocked — the real registry, real merge logic, and real throwing defaults run.
 */
import {
  configureOAuthAdapters,
  getOAuthAdapters,
  isOAuthAvailable,
  _resetOAuthAdaptersForTesting,
  type OAuthAdapters,
} from '@offgrid/pro/mcp/oauth/adapters';

// Always start each test from the pristine unconfigured registry so cases don't leak state.
beforeEach(() => {
  _resetOAuthAdaptersForTesting();
});

describe('unconfigured defaults', () => {
  it('every adapter throws a clear "not configured" error rather than silently no-op', async () => {
    const a = getOAuthAdapters();
    // browser
    expect(() => a.browser.authorize('https://x', 'y')).toThrow(/browser adapter not configured/i);
    // storage (all three methods)
    expect(() => a.storage.getItem('k')).toThrow(/storage adapter not configured/i);
    expect(() => a.storage.setItem('k', 'v')).toThrow(/storage adapter not configured/i);
    expect(() => a.storage.removeItem('k')).toThrow(/storage adapter not configured/i);
    // crypto (both methods)
    expect(() => a.crypto.randomBytes(16)).toThrow(/crypto adapter not configured/i);
    expect(() => a.crypto.sha256('abc')).toThrow(/crypto adapter not configured/i);
  });

  it('the not-configured error names the specific adapter and points at configureOAuthAdapters', () => {
    const a = getOAuthAdapters();
    expect(() => a.crypto.sha256('abc')).toThrow('[MCP OAuth] crypto');
    expect(() => a.crypto.sha256('abc')).toThrow(/configureOAuthAdapters\(\)/);
  });

  it('defaults carry a redirectUri of empty string and the Off Grid client name', () => {
    const a = getOAuthAdapters();
    expect(a.redirectUri).toBe('');
    expect(a.clientName).toBe('Off Grid AI');
  });

  it('isOAuthAvailable is false when unconfigured (both identity and empty-redirectUri conditions fail)', () => {
    expect(isOAuthAvailable()).toBe(false);
  });
});

describe('configureOAuthAdapters — partial merge', () => {
  it('overrides only the provided keys and preserves the rest of the defaults', () => {
    const browser = { authorize: jest.fn(async () => 'offgrid://oauth/callback?code=z') };
    configureOAuthAdapters({ browser });

    const a = getOAuthAdapters();
    // provided key replaced with the real object we passed
    expect(a.browser).toBe(browser);
    // untouched keys keep the throwing defaults
    expect(() => a.storage.getItem('k')).toThrow(/storage adapter not configured/i);
    expect(() => a.crypto.randomBytes(1)).toThrow(/crypto adapter not configured/i);
    // untouched scalar defaults preserved
    expect(a.clientName).toBe('Off Grid AI');
    expect(a.redirectUri).toBe('');
  });

  it('a real configured browser adapter actually runs (default no longer throws)', async () => {
    const browser = { authorize: jest.fn(async () => 'offgrid://oauth/callback?code=abc') };
    configureOAuthAdapters({ browser });
    await expect(getOAuthAdapters().browser.authorize('https://auth', 'offgrid://oauth')).resolves.toBe(
      'offgrid://oauth/callback?code=abc',
    );
    expect(browser.authorize).toHaveBeenCalledWith('https://auth', 'offgrid://oauth');
  });

  it('successive calls compose (later call overrides earlier, other keys retained)', () => {
    const storage = {
      getItem: jest.fn(async () => 'tok'),
      setItem: jest.fn(async () => undefined),
      removeItem: jest.fn(async () => undefined),
    };
    configureOAuthAdapters({ redirectUri: 'offgrid://oauth/callback' });
    configureOAuthAdapters({ storage });

    const a = getOAuthAdapters();
    // from first call
    expect(a.redirectUri).toBe('offgrid://oauth/callback');
    // from second call
    expect(a.storage).toBe(storage);
    // still-untouched key keeps the throwing default
    expect(() => a.browser.authorize('x', 'y')).toThrow(/browser adapter not configured/i);
  });

  it('later call for the same key wins', () => {
    const first = { authorize: jest.fn(async () => 'first') };
    const second = { authorize: jest.fn(async () => 'second') };
    configureOAuthAdapters({ browser: first });
    configureOAuthAdapters({ browser: second });
    expect(getOAuthAdapters().browser).toBe(second);
  });
});

describe('isOAuthAvailable — both branches of the && gate', () => {
  it('stays false when configured but redirectUri is still empty (second condition fails)', () => {
    configureOAuthAdapters({
      browser: { authorize: jest.fn(async () => '') },
    });
    // identity !== unconfigured is now true, but redirectUri.length > 0 is false
    expect(isOAuthAvailable()).toBe(false);
  });

  it('stays false when redirectUri is only whitespace-empty? no — empty string has length 0', () => {
    configureOAuthAdapters({ redirectUri: '' });
    expect(isOAuthAvailable()).toBe(false);
  });

  it('becomes true once a non-empty redirectUri is configured (both conditions pass)', () => {
    configureOAuthAdapters({ redirectUri: 'offgrid://oauth/callback' });
    expect(isOAuthAvailable()).toBe(true);
  });

  it('a single-char redirectUri already satisfies length > 0', () => {
    configureOAuthAdapters({ redirectUri: 'x' });
    expect(isOAuthAvailable()).toBe(true);
  });
});

describe('_resetOAuthAdaptersForTesting', () => {
  it('restores the throwing unconfigured defaults after configuration', () => {
    configureOAuthAdapters({
      redirectUri: 'offgrid://oauth/callback',
      browser: { authorize: jest.fn(async () => 'ok') },
    });
    expect(isOAuthAvailable()).toBe(true);

    _resetOAuthAdaptersForTesting();

    // back to the exact unconfigured behaviour
    expect(isOAuthAvailable()).toBe(false);
    expect(getOAuthAdapters().redirectUri).toBe('');
    expect(() => getOAuthAdapters().browser.authorize('x', 'y')).toThrow(/browser adapter not configured/i);
  });
});

describe('integration — configure then drive a full adapter set through the registry', () => {
  it('a fully-wired registry lets a consumer read availability and use every adapter for real', async () => {
    const kv: Record<string, string> = {};
    const full: OAuthAdapters = {
      browser: { authorize: async (_url, scheme) => `${scheme}?code=xyz` },
      storage: {
        getItem: async (k) => (k in kv ? kv[k] : null),
        setItem: async (k, v) => {
          kv[k] = v;
        },
        removeItem: async (k) => {
          delete kv[k];
        },
      },
      crypto: {
        randomBytes: async (n) => new Uint8Array(n).fill(7),
        sha256: async (input) => new Uint8Array([input.length % 256]),
      },
      redirectUri: 'offgrid://oauth/callback',
      clientName: 'Off Grid Test',
    };
    configureOAuthAdapters(full);

    // The UI gate reads real state off the registry.
    expect(isOAuthAvailable()).toBe(true);

    const a = getOAuthAdapters();
    expect(a.clientName).toBe('Off Grid Test');

    // Drive each seam through the registry and assert observable outcomes.
    await expect(a.browser.authorize('https://auth', 'offgrid://oauth')).resolves.toBe('offgrid://oauth?code=xyz');

    expect(await a.storage.getItem('missing')).toBeNull();
    await a.storage.setItem('token', 'secret');
    expect(await a.storage.getItem('token')).toBe('secret');
    await a.storage.removeItem('token');
    expect(await a.storage.getItem('token')).toBeNull();

    expect(Array.from(await a.crypto.randomBytes(3))).toEqual([7, 7, 7]);
    expect(Array.from(await a.crypto.sha256('abc'))).toEqual([3]);
  });
});
