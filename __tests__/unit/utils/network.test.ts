jest.mock('react-native-device-info', () =>
  require('../../helpers/mockNetworkDeps').deviceInfoMock,
);

import { getIpAddress } from 'react-native-device-info';
import {
  isPrivateIPv4,
  isIPv6,
  isOnLocalNetwork,
} from '../../../src/utils/network';

const mockGetIpAddress = getIpAddress as jest.Mock;

describe('network utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isPrivateIPv4', () => {
    test.each<[string, boolean]>([
      // 10.x.x.x (Class A private)
      ['10.0.0.1', true],
      ['10.255.255.255', true],
      ['10.1.2.3', true],
      // 172.16-31.x.x (Class B private)
      ['172.16.0.1', true],
      ['172.31.255.255', true],
      ['172.20.10.1', true],
      // 172.x outside 16-31
      ['172.15.0.1', false],
      ['172.32.0.1', false],
      ['172.0.0.1', false],
      // 192.168.x.x (Class C private)
      ['192.168.0.1', true],
      ['192.168.1.100', true],
      ['192.168.255.255', true],
      // Public IPs
      ['8.8.8.8', false],
      ['1.1.1.1', false],
      ['203.0.113.5', false],
      ['192.169.0.1', false],
      // Malformed
      ['10.0.0', false],
      ['10.0.0.1.5', false],
      ['not-an-ip', false],
      ['...', false],
      // Empty
      ['', false],
    ])('isPrivateIPv4(%j) → %s', (ip, expected) => {
      expect(isPrivateIPv4(ip)).toBe(expected);
    });
  });

  describe('isIPv6', () => {
    test.each<[string, boolean]>([
      ['::1', true],
      ['fe80::1', true],
      ['2001:0db8:85a3:0000:0000:8a2e:0370:7334', true],
      ['192.168.1.1', false],
      ['10.0.0.1', false],
    ])('isIPv6(%j) → %s', (ip, expected) => {
      expect(isIPv6(ip)).toBe(expected);
    });
  });

  describe('isOnLocalNetwork', () => {
    test.each<[string, string | null, boolean]>([
      ['private WiFi', '192.168.1.100', true],
      ['public IP', '8.8.8.8', false],
      ['IPv6 address', 'fe80::1', false],
      ['null IP', null, false],
      ['0.0.0.0', '0.0.0.0', false],
      ['127.0.0.1', '127.0.0.1', false],
    ])('returns %s for %s', async (_desc, ip, expected) => {
      mockGetIpAddress.mockResolvedValue(ip);
      expect(await isOnLocalNetwork()).toBe(expected);
    });

    it('returns false when getIpAddress throws', async () => {
      mockGetIpAddress.mockRejectedValue(new Error('No network'));
      expect(await isOnLocalNetwork()).toBe(false);
    });
  });
});
