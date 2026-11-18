import { isNetworkFailure } from '../../../src/utils/networkFailure';

describe('isNetworkFailure', () => {
  it.each([
    'Network error',
    'Request timeout',
    'Network request failed',
    'connect ECONNREFUSED 192.168.1.20:1234',
    'EHOSTUNREACH',
  ])('%s is a network failure', message =>
    expect(isNetworkFailure(new Error(message))).toBe(true),
  );

  it('a server that answered with an error is not', () => {
    expect(isNetworkFailure(new Error('Model unavailable'))).toBe(false);
  });

  it('a value that is not an Error is not', () => {
    expect(isNetworkFailure('Network error')).toBe(false);
  });
});
