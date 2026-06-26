jest.mock('react-native-get-random-values', () => ({}), { virtual: true });
jest.mock('react-native-inappbrowser-reborn', () => ({
  __esModule: true,
  default: { isAvailable: jest.fn(), openAuth: jest.fn() },
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

import InAppBrowser from 'react-native-inappbrowser-reborn';
import * as Keychain from 'react-native-keychain';
import { mcpOAuthNativeAdapters, MCP_OAUTH_REDIRECT_URI } from '../../../src/services/mcpOAuthNativeAdapters';

const { browser, storage, crypto: cryptoAdapter } = mcpOAuthNativeAdapters;

describe('browser.authorize', () => {
  it('returns the callback URL on success', async () => {
    (InAppBrowser.isAvailable as jest.Mock).mockResolvedValue(true);
    (InAppBrowser.openAuth as jest.Mock).mockResolvedValue({ type: 'success', url: 'offgrid://oauth/callback?code=abc' });
    await expect(browser.authorize('https://auth.example.com', MCP_OAUTH_REDIRECT_URI))
      .resolves.toBe('offgrid://oauth/callback?code=abc');
  });

  it('throws when no browser is available', async () => {
    (InAppBrowser.isAvailable as jest.Mock).mockResolvedValue(false);
    await expect(browser.authorize('https://auth.example.com', 'x')).rejects.toThrow(/no system browser/i);
  });

  it('throws when the user cancels', async () => {
    (InAppBrowser.isAvailable as jest.Mock).mockResolvedValue(true);
    (InAppBrowser.openAuth as jest.Mock).mockResolvedValue({ type: 'cancel' });
    await expect(browser.authorize('https://auth.example.com', 'x')).rejects.toThrow(/cancelled/i);
  });
});

describe('storage', () => {
  it('getItem returns the stored password, or null when absent', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({ password: 'tok' });
    await expect(storage.getItem('svc')).resolves.toBe('tok');
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
    await expect(storage.getItem('svc')).resolves.toBeNull();
  });

  it('setItem and removeItem delegate to Keychain with the key as service', async () => {
    await storage.setItem('svc', 'value');
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('mcp-oauth', 'value', { service: 'svc' });
    await storage.removeItem('svc');
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'svc' });
  });
});

describe('crypto', () => {
  it('randomBytes returns the requested length', async () => {
    expect(await cryptoAdapter.randomBytes(16)).toHaveLength(16);
  });
  it('sha256 returns a 32-byte digest', async () => {
    expect(await cryptoAdapter.sha256('hello')).toHaveLength(32);
  });
});
