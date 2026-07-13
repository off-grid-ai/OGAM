/**
 * Network Discovery Unit Tests
 *
 * Tests for LAN LLM server discovery (Ollama, LM Studio).
 */

jest.mock('react-native-device-info', () =>
  require('../../helpers/mockNetworkDeps').deviceInfoMock,
);
jest.mock('../../../src/utils/logger', () =>
  require('../../helpers/mockNetworkDeps').loggerMock,
);

import { getIpAddress } from 'react-native-device-info';
import { discoverLANServers } from '../../../src/services/networkDiscovery';

const mockGetIpAddress = getIpAddress as jest.Mock;

describe('discoverLANServers', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = jest.fn();
    (global as any).fetch = mockFetch;
    // Default: no servers respond
    mockFetch.mockResolvedValue(new Response(null, { status: 503 }));
  });

  // ==========================================================================
  // Happy path
  // ==========================================================================
  it('returns empty array when getIpAddress returns empty string', async () => {
    mockGetIpAddress.mockResolvedValue('');
    const result = await discoverLANServers();
    expect(result).toEqual([]);
  });

  it('returns empty array when getIpAddress returns null', async () => {
    mockGetIpAddress.mockResolvedValue(null);
    const result = await discoverLANServers();
    expect(result).toEqual([]);
  });

  it('returns empty array when IP has wrong format', async () => {
    mockGetIpAddress.mockResolvedValue('not-an-ip');
    const result = await discoverLANServers();
    expect(result).toEqual([]);
  });

  it('returns empty array when IP is 0.0.0.0 (simulator/unspecified)', async () => {
    mockGetIpAddress.mockResolvedValue('0.0.0.0'); // NOSONAR
    const result = await discoverLANServers();
    expect(result).toEqual([]);
  });

  it('returns empty array when no servers are discovered', async () => {
    mockGetIpAddress.mockResolvedValue('192.168.1.42'); // NOSONAR
    // All probes return error/503
    mockFetch.mockResolvedValue({ status: 503 });
    const result = await discoverLANServers();
    expect(result).toEqual([]);
  });

  it.each([
    ['ollama',   '192.168.1.10', 11434, 'Ollama (192.168.1.10)',    '/api/tags'     ],   // NOSONAR
    ['lmstudio', '192.168.1.20', 1234,  'LM Studio (192.168.1.20)', '/v1/models'],   // NOSONAR
    ['gateway',  '192.168.1.30', 7878,  'Off Grid AI Gateway (192.168.1.30)', '/v1/models'], // NOSONAR
  ])('discovers a %s server', async (type, ip, port, name, probePath) => {
    mockGetIpAddress.mockResolvedValue('192.168.1.42'); // NOSONAR
    const probeUrl = `http://${ip}:${port}${probePath}`; // NOSONAR
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve({ status: url === probeUrl ? 200 : 503 }),
    );

    const result = await discoverLANServers();
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe(type);
    expect(result[0].endpoint).toBe(`http://${ip}:${port}`); // NOSONAR
    expect(result[0].name).toBe(name);
  });

  it('discovers multiple servers across different providers', async () => {
    mockGetIpAddress.mockResolvedValue('192.168.1.42'); // NOSONAR

    mockFetch.mockImplementation((url: string) => {
      if (
        url === 'http://192.168.1.10:11434/api/tags' || // NOSONAR
        url === 'http://192.168.1.20:1234/v1/models' // NOSONAR
      ) {
        return Promise.resolve({ status: 200 });
      }
      return Promise.resolve({ status: 503 });
    });

    const result = await discoverLANServers();
    expect(result).toHaveLength(2);
    const types = result.map(s => s.type).sort((a, b) => a.localeCompare(b));
    expect(types).toEqual(['lmstudio', 'ollama']);
  });

  it('only accepts HTTP 200 as a valid server response', async () => {
    mockGetIpAddress.mockResolvedValue('192.168.1.1'); // NOSONAR

    mockFetch.mockImplementation((url: string) => {
      if (url === 'http://192.168.1.5:11434/api/tags') { // NOSONAR
        return Promise.resolve({ status: 200 }); // Explicit 200 required
      }
      return Promise.resolve({ status: 401 }); // 4xx (e.g. router admin page) should not match
    });

    const result = await discoverLANServers();
    expect(result).toHaveLength(1);
    expect(result[0].endpoint).toBe('http://192.168.1.5:11434'); // NOSONAR
  });

  it('does not include servers with status >= 500', async () => {
    mockGetIpAddress.mockResolvedValue('192.168.1.1'); // NOSONAR

    mockFetch.mockResolvedValue({ status: 500 });

    const result = await discoverLANServers();
    expect(result).toHaveLength(0);
  });

  it('handles fetch rejection (timeout/abort) gracefully', async () => {
    mockGetIpAddress.mockResolvedValue('192.168.1.1'); // NOSONAR
    mockFetch.mockRejectedValue(new Error('AbortError'));

    const result = await discoverLANServers();
    expect(result).toEqual([]);
  });

  it('handles getIpAddress throwing an error', async () => {
    mockGetIpAddress.mockRejectedValue(new Error('Network unavailable'));

    const result = await discoverLANServers();
    expect(result).toEqual([]);
  });

  it('uses the correct subnet base from device IP', async () => {
    mockGetIpAddress.mockResolvedValue('10.0.0.15'); // NOSONAR

    const probed: string[] = [];
    mockFetch.mockImplementation((url: string) => {
      probed.push(url);
      return Promise.resolve({ status: 503 });
    });

    await discoverLANServers();

    // Should probe 10.0.0.x addresses, not 192.168.x.x
    expect(probed.some(u => u.startsWith('http://10.0.0.'))).toBe(true); // NOSONAR
    expect(probed.some(u => u.startsWith('http://192.168.'))).toBe(false); // NOSONAR
  });

  it('probes all 254 addresses for each provider', async () => {
    mockGetIpAddress.mockResolvedValue('192.168.1.42'); // NOSONAR

    const ollamaProbes: string[] = [];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes(':11434')) ollamaProbes.push(url);
      return Promise.resolve({ status: 503 });
    });

    await discoverLANServers();

    // Should probe .1 through .254 (254 addresses)
    expect(ollamaProbes).toHaveLength(254);
    expect(ollamaProbes.some(u => u.includes('192.168.1.1:'))).toBe(true);
    expect(ollamaProbes.some(u => u.includes('192.168.1.254:'))).toBe(true);
    expect(ollamaProbes.some(u => u.includes('192.168.1.0:'))).toBe(false);
    expect(ollamaProbes.some(u => u.includes('192.168.1.255:'))).toBe(false);
  });

  it('probes port 7878 across the subnet for the Off Grid AI Gateway', async () => {
    mockGetIpAddress.mockResolvedValue('192.168.1.42'); // NOSONAR

    const gatewayProbes: string[] = [];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes(':7878')) gatewayProbes.push(url);
      return Promise.resolve({ status: 503 });
    });

    await discoverLANServers();

    expect(gatewayProbes).toHaveLength(254);
    expect(gatewayProbes.every(u => u.endsWith('/v1/models'))).toBe(true);
  });
});
