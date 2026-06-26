/**
 * Native implementations of the MCP OAuth adapter seams defined in
 * `@offgrid/pro` (pro/mcp/oauth/adapters.ts). The pro package keeps the OAuth
 * protocol logic pure-TS; this app-side module supplies the three things JS
 * can't do, backed by installed native libraries:
 *
 *   - browser  -> react-native-inappbrowser-reborn (ASWebAuthenticationSession /
 *                 Chrome Custom Tabs) — opens the service's login and returns the
 *                 redirect URL, so no separate deep-link listener is needed.
 *   - storage  -> react-native-keychain (Keychain / Keystore), one entry per key.
 *   - crypto   -> react-native-get-random-values (secure random) + js-sha256.
 *
 * `loadProFeatures` passes the exported object to `pro.configureOAuthAdapters(...)`
 * once, after the pro entitlement is confirmed.
 */

import 'react-native-get-random-values'; // side-effect: installs global.crypto.getRandomValues
import { sha256 } from 'js-sha256';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import * as Keychain from 'react-native-keychain';

/** Must match the scheme registered in Info.plist / AndroidManifest. */
export const MCP_OAUTH_REDIRECT_URI = 'offgrid://oauth/callback';

const browser = {
  async authorize(authUrl: string, redirectScheme: string): Promise<string> {
    const available = await InAppBrowser.isAvailable();
    if (!available) {
      throw new Error('No system browser available for sign-in');
    }
    const result = await InAppBrowser.openAuth(authUrl, redirectScheme, {
      ephemeralWebSession: false,
      showInRecents: false,
    });
    if (result.type === 'success' && result.url) return result.url;
    throw new Error('Sign-in was cancelled');
  },
};

const storage = {
  async getItem(key: string): Promise<string | null> {
    const creds = await Keychain.getGenericPassword({ service: key });
    return creds ? creds.password : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await Keychain.setGenericPassword('mcp-oauth', value, { service: key });
  },
  async removeItem(key: string): Promise<void> {
    await Keychain.resetGenericPassword({ service: key });
  },
};

const cryptoAdapter = {
  async randomBytes(length: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(length);
    // crypto.getRandomValues is polyfilled by the side-effect import above.
    crypto.getRandomValues(bytes);
    return bytes;
  },
  async sha256(input: string): Promise<Uint8Array> {
    return new Uint8Array(sha256.arrayBuffer(input));
  },
};

/** Structural match for `@offgrid/pro`'s OAuthAdapters; passed to configureOAuthAdapters. */
export const mcpOAuthNativeAdapters = {
  browser,
  storage,
  crypto: cryptoAdapter,
  redirectUri: MCP_OAUTH_REDIRECT_URI,
  clientName: 'Off Grid',
};
