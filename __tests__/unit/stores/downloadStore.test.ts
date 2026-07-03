import { useDownloadStore, isActiveStatus, isQueuedStatus, isDownloadingStatus, DownloadEntry, DownloadStatus } from '../../../src/stores/downloadStore';

const makeEntry = (overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
  modelKey: 'author/model/model.gguf',
  downloadId: 'dl-1',
  modelId: 'author/model',
  fileName: 'model.gguf',
  quantization: 'Q4_K_M',
  modelType: 'text',
  status: 'pending',
  bytesDownloaded: 0,
  totalBytes: 1000,
  combinedTotalBytes: 1000,
  progress: 0,
  createdAt: 1000,
  ...overrides,
});

beforeEach(() => {
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} });
});

describe('isActiveStatus', () => {
  it('returns true for active statuses', () => {
    expect(isActiveStatus('pending')).toBe(true);
    expect(isActiveStatus('running')).toBe(true);
    expect(isActiveStatus('retrying')).toBe(true);
    expect(isActiveStatus('waiting_for_network')).toBe(true);
    expect(isActiveStatus('processing')).toBe(true);
  });

  it('returns false for terminal statuses', () => {
    expect(isActiveStatus('completed')).toBe(false);
    expect(isActiveStatus('failed')).toBe(false);
    expect(isActiveStatus('cancelled')).toBe(false);
  });

  // Cross-surface contract: every screen that decides "is this download in progress?"
  // (Download Manager active list, Models→Image tab, Models→Text tab) MUST use this one
  // predicate. The regressed image bug came from a hand-rolled `status !== 'completed'
  // && status !== 'cancelled'`, which classified a FAILED row as downloading — so the
  // Image tab showed a fake "downloading 0%" while the Download Manager showed it failed.
  // Pinning failed/cancelled as NOT active guards both surfaces against drifting apart.
  it('classifies a failed/interrupted download as NOT in progress (no fake "downloading")', () => {
    const handRolled = (s: string) => s !== 'completed' && s !== 'cancelled';
    expect(isActiveStatus('failed')).toBe(false);   // the correct, shared answer
    expect(handRolled('failed')).toBe(true);         // the old per-screen bug it replaces
  });
});

// The queued-vs-downloading split is the SINGLE source every surface (Text/Image/STT
// tabs, the ModelCard, the Download Manager count) now uses. These pin the classification
// so a queued item renders the clock everywhere and an "active" count can't call a queued
// row "downloading" (the "Active Downloads: 5" bug when only 3 were transferring).
describe('isQueuedStatus / isDownloadingStatus', () => {
  const ALL: DownloadStatus[] = ['pending', 'running', 'retrying', 'waiting_for_network', 'processing', 'completed', 'failed', 'cancelled'];

  it('queued is exactly the pending status', () => {
    expect(isQueuedStatus('pending')).toBe(true);
    for (const s of ALL.filter(x => x !== 'pending')) expect(isQueuedStatus(s)).toBe(false);
  });

  it('downloading is active-but-not-queued', () => {
    expect(isDownloadingStatus('running')).toBe(true);
    expect(isDownloadingStatus('retrying')).toBe(true);
    expect(isDownloadingStatus('waiting_for_network')).toBe(true);
    expect(isDownloadingStatus('processing')).toBe(true);
    // pending is queued, not downloading — this is the whole point of the split
    expect(isDownloadingStatus('pending')).toBe(false);
    // terminal statuses are neither
    expect(isDownloadingStatus('completed')).toBe(false);
    expect(isDownloadingStatus('failed')).toBe(false);
    expect(isDownloadingStatus('cancelled')).toBe(false);
  });

  it('partitions active exactly into queued + downloading (no overlap, no gap)', () => {
    for (const s of ALL) {
      // active === queued OR downloading, and queued/downloading never both true
      expect(isActiveStatus(s)).toBe(isQueuedStatus(s) || isDownloadingStatus(s));
      expect(isQueuedStatus(s) && isDownloadingStatus(s)).toBe(false);
    }
  });

  it('a mixed active list splits into the correct downloading/queued counts (the "5 active" bug)', () => {
    const statuses: DownloadStatus[] = ['running', 'running', 'processing', 'pending', 'pending'];
    const queued = statuses.filter(isQueuedStatus).length;
    const downloading = statuses.filter(isDownloadingStatus).length;
    expect(queued).toBe(2);        // was mislabeled "active"
    expect(downloading).toBe(3);   // the genuinely-transferring count
    expect(queued + downloading).toBe(statuses.filter(isActiveStatus).length); // 5 total active
  });
});

describe('add', () => {
  it('adds a new entry and indexes downloadId', () => {
    const entry = makeEntry();
    useDownloadStore.getState().add(entry);
    const state = useDownloadStore.getState();
    expect(state.downloads['author/model/model.gguf']).toBeDefined();
    expect(state.downloadIdIndex['dl-1']).toBe('author/model/model.gguf');
  });

  it('ignores duplicate modelKey', () => {
    const entry = makeEntry();
    useDownloadStore.getState().add(entry);
    useDownloadStore.getState().add({ ...entry, downloadId: 'dl-2' });
    expect(useDownloadStore.getState().downloadIdIndex['dl-2']).toBeUndefined();
  });

  it('indexes mmProjDownloadId when present', () => {
    const entry = makeEntry({ mmProjDownloadId: 'dl-mm-1' });
    useDownloadStore.getState().add(entry);
    expect(useDownloadStore.getState().downloadIdIndex['dl-mm-1']).toBe('author/model/model.gguf');
  });
});

describe('setAll', () => {
  it('replaces all entries', () => {
    useDownloadStore.getState().add(makeEntry({ modelKey: 'old/model/old.gguf', downloadId: 'old-dl' }));
    const newEntry = makeEntry({ modelKey: 'new/model/new.gguf', downloadId: 'new-dl' });
    useDownloadStore.getState().setAll([newEntry]);
    const state = useDownloadStore.getState();
    expect(state.downloads['old/model/old.gguf']).toBeUndefined();
    expect(state.downloads['new/model/new.gguf']).toBeDefined();
  });
});

describe('hydrate', () => {
  it('adds new entries', () => {
    const entry = makeEntry({ bytesDownloaded: 300 });
    useDownloadStore.getState().hydrate([entry]);
    expect(useDownloadStore.getState().downloads['author/model/model.gguf']).toBeDefined();
  });

  it('keeps existing entry when local progress is ahead', () => {
    const existing = makeEntry({ bytesDownloaded: 600, status: 'running' });
    useDownloadStore.getState().add(existing);
    const incoming = makeEntry({ bytesDownloaded: 400, totalBytes: 2000 });
    useDownloadStore.getState().hydrate([incoming]);
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.bytesDownloaded).toBe(600);
    expect(entry.totalBytes).toBe(2000);
  });

  it('replaces existing entry when native is ahead', () => {
    const existing = makeEntry({ bytesDownloaded: 200 });
    useDownloadStore.getState().add(existing);
    const incoming = makeEntry({ bytesDownloaded: 500 });
    useDownloadStore.getState().hydrate([incoming]);
    expect(useDownloadStore.getState().downloads['author/model/model.gguf'].bytesDownloaded).toBe(500);
  });
});

describe('updateProgress', () => {
  it('updates bytes and progress', () => {
    useDownloadStore.getState().add(makeEntry());
    useDownloadStore.getState().updateProgress('dl-1', 500, 1000);
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.bytesDownloaded).toBe(500);
    expect(entry.progress).toBe(0.5);
    expect(entry.status).toBe('running');
  });

  it('is a no-op for unknown downloadId', () => {
    const before = useDownloadStore.getState().downloads;
    useDownloadStore.getState().updateProgress('unknown', 100, 1000);
    expect(useDownloadStore.getState().downloads).toBe(before);
  });

  it('clamps combined progress to <= 1 (no combinedTotal → main-only denominator + mmproj bytes)', () => {
    useDownloadStore.getState().add(makeEntry({ combinedTotalBytes: undefined, mmProjBytesDownloaded: 400 }));
    useDownloadStore.getState().updateProgress('dl-1', 1000, 1000); // (1000+400)/1000 = 1.4 → clamp
    expect(useDownloadStore.getState().downloads['author/model/model.gguf'].progress).toBe(1);
  });
});

describe('updateMmProjProgress', () => {
  it('updates mmproj bytes and combined progress', () => {
    const entry = makeEntry({ combinedTotalBytes: 2000, mmProjDownloadId: 'dl-mm' });
    useDownloadStore.getState().add(entry);
    useDownloadStore.getState().updateMmProjProgress('dl-mm', 400);
    const updated = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(updated.mmProjBytesDownloaded).toBe(400);
    expect(updated.progress).toBe(0.2);
  });

  it('is a no-op for unknown downloadId', () => {
    const before = useDownloadStore.getState().downloads;
    useDownloadStore.getState().updateMmProjProgress('unknown', 100);
    expect(useDownloadStore.getState().downloads).toBe(before);
  });

  it('clamps mmproj combined progress to <= 1', () => {
    useDownloadStore.getState().add(makeEntry({ combinedTotalBytes: undefined, bytesDownloaded: 900, mmProjDownloadId: 'dl-mm' }));
    useDownloadStore.getState().updateMmProjProgress('dl-mm', 500); // (900+500)/1000 = 1.4 → clamp
    expect(useDownloadStore.getState().downloads['author/model/model.gguf'].progress).toBe(1);
  });
});

describe('setStatus', () => {
  it('updates main entry status', () => {
    useDownloadStore.getState().add(makeEntry());
    useDownloadStore.getState().setStatus('dl-1', 'failed', { message: 'err', code: 'http_404' });
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.status).toBe('failed');
    expect(entry.errorMessage).toBe('err');
  });

  it('updates mmproj status independently', () => {
    const entry = makeEntry({ mmProjDownloadId: 'dl-mm' });
    useDownloadStore.getState().add(entry);
    useDownloadStore.getState().setStatus('dl-mm', 'failed', { message: 'mmproj err' });
    const updated = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(updated.status).toBe('pending');
    expect(updated.mmProjStatus).toBe('failed');
  });

  it('is a no-op for unknown downloadId', () => {
    const before = useDownloadStore.getState().downloads;
    useDownloadStore.getState().setStatus('unknown', 'failed');
    expect(useDownloadStore.getState().downloads).toBe(before);
  });
});

describe('setProcessing / setCompleted', () => {
  it('setProcessing sets status to processing', () => {
    useDownloadStore.getState().add(makeEntry({ status: 'running' }));
    useDownloadStore.getState().setProcessing('dl-1');
    expect(useDownloadStore.getState().downloads['author/model/model.gguf'].status).toBe('processing');
  });

  it('setCompleted sets status to completed and progress to 1', () => {
    useDownloadStore.getState().add(makeEntry({ status: 'running' }));
    useDownloadStore.getState().setCompleted('dl-1');
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.status).toBe('completed');
    expect(entry.progress).toBe(1);
  });
});

describe('setMmProjCompleted', () => {
  it('marks mmproj as completed', () => {
    useDownloadStore.getState().add(makeEntry({ mmProjDownloadId: 'dl-mm' }));
    useDownloadStore.getState().setMmProjCompleted('dl-mm', 500);
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.mmProjStatus).toBe('completed');
    expect(entry.mmProjBytesDownloaded).toBe(500);
  });

  it('is a no-op for unknown mmProjDownloadId', () => {
    const before = useDownloadStore.getState().downloads;
    useDownloadStore.getState().setMmProjCompleted('unknown', 100);
    expect(useDownloadStore.getState().downloads).toBe(before);
  });
});

describe('retryEntry', () => {
  it('resets entry with new downloadId', () => {
    useDownloadStore.getState().add(makeEntry({ status: 'failed', bytesDownloaded: 500 }));
    useDownloadStore.getState().retryEntry('author/model/model.gguf', 'dl-retry');
    const state = useDownloadStore.getState();
    const entry = state.downloads['author/model/model.gguf'];
    expect(entry.downloadId).toBe('dl-retry');
    expect(entry.status).toBe('pending');
    expect(entry.bytesDownloaded).toBe(0);
    expect(state.downloadIdIndex['dl-retry']).toBe('author/model/model.gguf');
    expect(state.downloadIdIndex['dl-1']).toBeUndefined();
  });
});

describe('remove', () => {
  it('removes entry and cleans up index', () => {
    useDownloadStore.getState().add(makeEntry({ mmProjDownloadId: 'dl-mm' }));
    useDownloadStore.getState().remove('author/model/model.gguf');
    const state = useDownloadStore.getState();
    expect(state.downloads['author/model/model.gguf']).toBeUndefined();
    expect(state.downloadIdIndex['dl-1']).toBeUndefined();
    expect(state.downloadIdIndex['dl-mm']).toBeUndefined();
  });

  it('is a no-op for unknown modelKey', () => {
    const before = useDownloadStore.getState().downloads;
    useDownloadStore.getState().remove('nonexistent/key');
    expect(useDownloadStore.getState().downloads).toBe(before);
  });
});
