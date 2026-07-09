import { formatBytes } from '../../../src/utils/formatBytes';

const KB = 1024;
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

describe('formatBytes (canonical)', () => {
  it('formats each magnitude with the standardized precision', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2 * KB)).toBe('2 KB');
    expect(formatBytes(142 * MB)).toBe('142 MB'); // MB → 0 decimals
    expect(formatBytes(1.5 * GB)).toBe('1.5 GB'); // GB → 1 decimal
  });

  it('renders 0 / negative / non-finite as "0 B" (queued rows show "0 B / …")', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(Infinity)).toBe('0 B');
  });

  it('is a single implementation — the ModelsScreen + DownloadManager re-exports match it', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modelsUtils = require('../../../src/screens/ModelsScreen/utils');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dmItems = require('../../../src/screens/DownloadManagerScreen/items');
    expect(modelsUtils.formatBytes).toBe(formatBytes);
    expect(dmItems.formatBytes).toBe(formatBytes);
  });
});
