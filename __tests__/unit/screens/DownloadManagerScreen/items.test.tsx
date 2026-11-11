import { formatBytes, getStatusText } from '../../../../src/screens/DownloadManagerScreen/items';
import { isRetryable } from '../../../../src/utils/downloadErrors';

describe('DownloadManagerScreen/items helpers', () => {
  it('formats bytes for human-readable display', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('maps active download statuses to display text', () => {
    expect(getStatusText('running')).toBe('Downloading...');
    expect(getStatusText('retrying')).toBe('Retrying connection...');
    expect(getStatusText('waiting_for_network')).toBe('Waiting for network');
    expect(getStatusText('failed')).toBe('Needs attention');
  });
});

describe('isRetryable branches', () => {
  it('returns true when no reasonCode is provided', () => {
    expect(isRetryable()).toBe(true);
  });

  it('returns true for retryable error codes', () => {
    expect(isRetryable('network_lost')).toBe(true);
    expect(isRetryable('network_timeout')).toBe(true);
    expect(isRetryable('download_interrupted')).toBe(true);
    expect(isRetryable('http_416')).toBe(true);
    expect(isRetryable('http_429')).toBe(true);
    expect(isRetryable('unknown_error')).toBe(true);
  });

  it('returns false for non-retryable error codes', () => {
    expect(isRetryable('http_404')).toBe(false);
    expect(isRetryable('http_403')).toBe(false);
    expect(isRetryable('http_401')).toBe(false);
    expect(isRetryable('disk_full')).toBe(false);
    expect(isRetryable('user_cancelled')).toBe(false);
  });
});
