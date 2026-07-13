import { downloadProgressFor } from '../../../src/screens/ModelDownloadScreen';

// Guards that the onboarding cards feed the shared ModelCard the SAME data the
// Text/Image/STT tabs do — including bytes (the fix: onboarding showed % only).
describe('downloadProgressFor (onboarding → ModelCard props)', () => {
  it('returns null when there is no entry or it is not active', () => {
    expect(downloadProgressFor(undefined)).toBeNull();
    expect(downloadProgressFor({ status: 'completed', progress: 1 })).toBeNull();
    expect(downloadProgressFor({ status: 'failed', progress: 0.5 })).toBeNull();
  });

  it('surfaces bytes for a live download (combined main + mmproj over combinedTotalBytes)', () => {
    const r = downloadProgressFor({
      status: 'running',
      progress: 0.6,
      bytesDownloaded: 600,
      mmProjBytesDownloaded: 50,
      totalBytes: 1000,
      combinedTotalBytes: 1100,
    });
    expect(r).toEqual({ progress: 0.6, queued: false, bytes: { downloaded: 650, total: 1100 } });
  });

  it('falls back to totalBytes when there is no combined total', () => {
    const r = downloadProgressFor({ status: 'running', progress: 0.2, bytesDownloaded: 200, totalBytes: 1000 });
    expect(r?.bytes).toEqual({ downloaded: 200, total: 1000 });
  });

  it('marks a pending entry queued and still reports bytes ("0 B / size")', () => {
    const r = downloadProgressFor({ status: 'pending', progress: 0, bytesDownloaded: 0, combinedTotalBytes: 1000 });
    expect(r).toEqual({ progress: 0, queued: true, bytes: { downloaded: 0, total: 1000 } });
  });

  it('omits bytes only when the total is unknown (0) — never renders "/ 0 B"', () => {
    const r = downloadProgressFor({ status: 'running', progress: 0.1, bytesDownloaded: 10, totalBytes: 0 });
    expect(r?.bytes).toBeUndefined();
  });
});
