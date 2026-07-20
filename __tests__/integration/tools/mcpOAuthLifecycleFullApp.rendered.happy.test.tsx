/** APP-P2-008 — OAuth cancel, reauthorization, 401 refresh, and retry stay actionable. */
import { Switch } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';
import { installPro } from '../../harness/proHarness';

const MCP_URL = 'https://mcp.notion.com/mcp';
const RESOURCE_METADATA_URL = 'https://oauth.example.test/resource-metadata';
const AUTH_SERVER = 'https://auth.example.test';
const TOKEN_ENDPOINT = `${AUTH_SERVER}/token`;
const REGISTRATION_ENDPOINT = `${AUTH_SERVER}/register`;
const TOOL_MODEL: DownloadedModel = {
  id: 'test/llama-3-oauth/llama-3-oauth-Q4_K_M.gguf',
  name: 'Llama 3 OAuth',
  author: 'test',
  fileName: 'llama-3-oauth-Q4_K_M.gguf',
  filePath: '/docs/models/llama-3-oauth-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

type OAuthControl = {
  cancelled: boolean;
  browserAttempts: number;
  refreshGrants: number;
  rpcAttempts: number;
};

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  return String((input as { url?: unknown })?.url ?? input);
}

function installOAuthBoundaries(control: OAuthControl): void {
  const secureValues = new Map<string, string>();
  const oauthAdapters = require('@offgrid/pro/mcp/oauth/adapters') as {
    configureOAuthAdapters: (adapters: Record<string, unknown>) => void;
  };
  oauthAdapters.configureOAuthAdapters({
    redirectUri: 'offgrid://oauth/callback',
    clientName: 'Off Grid AI test',
    browser: {
      authorize: async (authUrl: string) => {
        control.browserAttempts += 1;
        if (control.cancelled) throw new Error('Sign-in was cancelled');
        const state = new URL(authUrl).searchParams.get('state');
        return `offgrid://oauth/callback?code=approved&state=${state}`;
      },
    },
    storage: {
      getItem: async (key: string) => secureValues.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        secureValues.set(key, value);
      },
      removeItem: async (key: string) => {
        secureValues.delete(key);
      },
    },
    crypto: {
      randomBytes: async (length: number) =>
        Uint8Array.from({ length }, (_value, index) => (index + 17) % 256),
      sha256: async () => Uint8Array.from({ length: 32 }, () => 23),
    },
  });

  global.fetch = jest.fn(async (input, init) => {
    const url = urlOf(input);
    if (url === MCP_URL && (init?.method ?? 'GET') === 'GET') {
      return new Response('', {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`,
        },
      });
    }
    if (url === RESOURCE_METADATA_URL) {
      return Response.json({
        resource: MCP_URL,
        authorization_servers: [AUTH_SERVER],
      });
    }
    if (url.includes('.well-known/')) {
      return Response.json({
        issuer: AUTH_SERVER,
        authorization_endpoint: `${AUTH_SERVER}/authorize`,
        token_endpoint: TOKEN_ENDPOINT,
        registration_endpoint: REGISTRATION_ENDPOINT,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }
    if (url === REGISTRATION_ENDPOINT) {
      return Response.json({ client_id: 'offgrid-mobile-test' });
    }
    if (url === TOKEN_ENDPOINT) {
      const body = String(init?.body ?? '');
      if (body.includes('grant_type=refresh_token')) {
        control.refreshGrants += 1;
        return Response.json({
          access_token: 'fresh-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      return Response.json({
        access_token: 'stale-access-token',
        refresh_token: 'refresh-credential',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    return new Response('', { status: 404 });
  });

  class OAuthMcpXHR {
    status = 200;
    responseText = '';
    timeout = 0;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;

    open(): void {}
    setRequestHeader(): void {}
    getResponseHeader(name: string): string | null {
      if (name.toLowerCase() === 'content-type') return 'application/json';
      if (name.toLowerCase() === 'www-authenticate' && this.status === 401)
        return 'Bearer';
      return null;
    }
    send(payload: string): void {
      control.rpcAttempts += 1;
      const request = JSON.parse(payload) as { id: number; method: string };
      if (control.rpcAttempts === 1) {
        this.status = 401;
        this.responseText = '{}';
      } else {
        this.status = 200;
        this.responseText = JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result:
            request.method === 'tools/list'
              ? {
                  tools: [
                    {
                      name: 'notion_search',
                      description: 'Search Notion pages.',
                      inputSchema: { type: 'object' },
                    },
                  ],
                }
              : {},
        });
      }
      setTimeout(() => this.onload?.(), 0);
    }
  }
  (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
    OAuthMcpXHR;
}

function notionSwitch(
  app: Awaited<ReturnType<typeof renderMainApp>>,
): ReactTestInstance {
  let node = app.view.getByText('Notion');
  while (node.parent) {
    const toggle = app.rtl.within(node).UNSAFE_queryByType(Switch);
    if (toggle) return toggle;
    node = node.parent;
  }
  throw new Error('Notion connection toggle not found');
}

describe('full-App MCP OAuth lifecycle', () => {
  const originalFetch = global.fetch;
  const originalXhr = globalThis.XMLHttpRequest;

  afterEach(() => {
    global.fetch = originalFetch;
    globalThis.XMLHttpRequest = originalXhr;
  });

  it('returns from browser cancellation and reconnects after a 401 refresh', async () => {
    const control: OAuthControl = {
      cancelled: true,
      browserAttempts: 0,
      refreshGrants: 0,
      rpcAttempts: 0,
    };
    const app = await renderMainApp({
      boundary: { llama: true },
      downloadedModels: [TOOL_MODEL],
      beforeRender: async () => installPro(),
    });
    // App boot wires the real native adapters after beforeRender. Replace only
    // those browser/storage/transport leaves once boot settles; all OAuth and UI
    // orchestration above them remains the production path.
    installOAuthBoundaries(control);

    await openChatWithJourneyModel(app.rtl, app.view);
    app.rtl.fireEvent.press(app.view.getByTestId('quick-settings-button'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByTestId('quick-tools')),
    );
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByTestId('tools-pro-tools')),
    );
    app.rtl.fireEvent.press(app.view.getByText('Add Server'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() =>
        app.view.getByTestId('mcp-preset-add-notion'),
      ),
    );

    await app.rtl.waitFor(() => {
      expect(control.browserAttempts).toBe(1);
      expect(app.view.getByText('Notion')).toBeTruthy();
      expect(app.view.getByText('Inactive')).toBeTruthy();
      expect(notionSwitch(app).props.value).toBe(false);
    });

    control.cancelled = false;
    app.rtl.fireEvent(notionSwitch(app), 'valueChange', true);
    await app.rtl.waitFor(
      () => {
        expect(app.view.getByText('Active')).toBeTruthy();
        expect(app.view.getByText('1/1 tools')).toBeTruthy();
        expect(notionSwitch(app).props.value).toBe(true);
      },
      { timeout: 10000 },
    );
    expect(control.browserAttempts).toBe(2);
    expect(control.refreshGrants).toBe(1);
    expect(control.rpcAttempts).toBeGreaterThanOrEqual(4);
    app.view.unmount();
  }, 30000);
});
