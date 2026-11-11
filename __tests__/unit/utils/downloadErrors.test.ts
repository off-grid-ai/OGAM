import { getDownloadStatusLabel, getUserFacingDownloadMessage, isRetryable } from '../../../src/utils/downloadErrors';

describe('downloadErrors', () => {
  it('maps network failures to friendlier copy', () => {
    expect(getUserFacingDownloadMessage('Software caused connection abort')).toBe(
      'The connection dropped while downloading. Please try again.',
    );
  });

  it('maps timeout failures to friendlier copy', () => {
    expect(getUserFacingDownloadMessage('timeout')).toBe(
      'The download took too long to respond. Please try again.',
    );
  });

  it('maps failed status labels through the helper', () => {
    expect(getDownloadStatusLabel('failed', 'HTTP 416')).toBe(
      'The server could not resume this download. Please retry it.',
    );
  });

  it('maps pending network labels through the helper', () => {
    expect(getDownloadStatusLabel('pending', 'Network connection lost. Waiting to resume.')).toBe(
      'Network connection lost - waiting to resume...',
    );
  });

  it('maps pending without reason to Queued', () => {
    expect(getDownloadStatusLabel('pending')).toBe('Queued');
  });

  it('maps running and downloading statuses', () => {
    expect(getDownloadStatusLabel('running')).toBe('Downloading...');
    expect(getDownloadStatusLabel('downloading')).toBe('Downloading...');
  });

  it('falls through to toUserMessage for unhandled statuses like processing', () => {
    expect(getDownloadStatusLabel('processing')).toBe('The download stopped before it finished. Try again.');
    expect(getDownloadStatusLabel('completed')).toBe('The download stopped before it finished. Try again.');
  });

  describe('getUserFacingDownloadMessage', () => {
    it('maps 5xx server errors', () => {
      expect(getUserFacingDownloadMessage('HTTP 500')).toBe(
        'The download server is temporarily unavailable. Please try again later.',
      );
      expect(getUserFacingDownloadMessage('HTTP 502')).toBe(
        'The download server is temporarily unavailable. Please try again later.',
      );
    });

    it('truncates excessively long error strings', () => {
      const longError = 'a'.repeat(200);
      expect(getUserFacingDownloadMessage(longError)).toBe(
        'The download stopped before it finished. Try again.',
      );
    });

    it('preserves legitimate disk space errors', () => {
      const diskError = 'Not enough disk space (need 2GB, have 1GB)';
      expect(getUserFacingDownloadMessage(diskError)).toBe(diskError);
    });

    it('returns unknown error when reason and code are empty', () => {
      expect(getUserFacingDownloadMessage(undefined, undefined)).toBe(
        'The download stopped before it finished. Try again.',
      );
    });
  });

  describe('isRetryable', () => {
    it('returns true when reasonCode is empty', () => {
      expect(isRetryable()).toBe(true);
      expect(isRetryable(undefined)).toBe(true);
    });

    it('returns true for retryable codes', () => {
      expect(isRetryable('network_lost')).toBe(true);
      expect(isRetryable('server_unavailable')).toBe(true);
    });

    it('returns false for non-retryable codes', () => {
      expect(isRetryable('http_404')).toBe(false);
      expect(isRetryable('user_cancelled')).toBe(false);
    });

    it('keeps Retry for the app fallback codes a retry can recover', () => {
      for (const code of ['extract_failed', 'multifile_failed', 'download_failed', 'resume_failed', 'files_missing', 'retry_failed']) {
        expect(isRetryable(code)).toBe(true);
      }
    });

    it('offers no Retry when a retry has nothing to start from', () => {
      expect(isRetryable('no_source_url')).toBe(false);
      expect(isRetryable('metadata_missing')).toBe(false);
    });
  });
});
