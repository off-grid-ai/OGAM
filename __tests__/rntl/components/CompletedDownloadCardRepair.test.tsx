/**
 * CompletedDownloadCard — repair-vision progress (BUG OD2)
 *
 * When a vision repair is in flight, the card must render the SAME determinate
 * progress bar the normal download shows (using the Shared download projection
 * keyed on the model's modelKey), not just the indeterminate "Repairing"
 * spinner. The progress row appears and its byte text advances as the
 * projection advances.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import {
  CompletedDownloadCard,
  DownloadItem,
} from '../../../src/screens/DownloadManagerScreen/items';

const MODEL_KEY = 'test/model/vision-Q4_K_M.gguf';
const MMPROJ_TOTAL = 900_000_000;

const completedItem: DownloadItem = {
  type: 'completed',
  modelType: 'text',
  modelId: MODEL_KEY,
  fileName: 'vision-Q4_K_M.gguf',
  author: 'test',
  quantization: 'Q4_K_M',
  fileSize: 4_900_000_000,
  bytesDownloaded: 4_900_000_000,
  progress: 1,
  status: 'completed',
  isVisionModel: true,
};

function repairDownload(bytes: number, progress: number): DownloadItem {
  return {
    type: 'active',
    modelType: 'text',
    downloadId: 'repair-1',
    modelKey: MODEL_KEY,
    modelId: 'test/model',
    fileName: 'Vision support',
    author: 'test',
    quantization: '',
    fileSize: MMPROJ_TOTAL,
    bytesDownloaded: bytes,
    progress,
    status: 'running',
  };
}

describe('CompletedDownloadCard — repair-vision determinate progress', () => {
  it('renders the determinate progress bar (not just a spinner) while a repair download is in flight', () => {
    const { getByTestId, queryByText } = render(
      <CompletedDownloadCard
        item={completedItem}
        onDelete={() => {}}
        isRepairingVision
        repairDownload={repairDownload(MMPROJ_TOTAL / 2, 0.5)}
      />,
    );

    // The shared progress row is present with mid-download byte text.
    expect(getByTestId('repair-vision-progress')).toBeTruthy();
    expect(queryByText(/429 MB \/ 858 MB/)).toBeTruthy();
  });

  it('advances the rendered bytes as the projection advances (incremental, not terminal-only)', () => {
    const { queryByText, rerender } = render(
      <CompletedDownloadCard
        item={completedItem}
        onDelete={() => {}}
        isRepairingVision
        repairDownload={repairDownload(MMPROJ_TOTAL / 2, 0.5)}
      />,
    );
    expect(queryByText(/429 MB \/ 858 MB/)).toBeTruthy();

    rerender(
      <CompletedDownloadCard
        item={completedItem}
        onDelete={() => {}}
        isRepairingVision
        repairDownload={repairDownload(MMPROJ_TOTAL * 0.9, 0.9)}
      />,
    );
    expect(queryByText(/772 MB \/ 858 MB/)).toBeTruthy();
    expect(queryByText(/429 MB \/ 858 MB/)).toBeNull();
  });

  it('shows only the indeterminate spinner (no progress row) when repairing but no store row exists yet', () => {
    // Repairing flag set, but Shared has not projected the transfer yet (pre-start window).
    const { getByTestId, queryByTestId } = render(
      <CompletedDownloadCard
        item={completedItem}
        onDelete={() => {}}
        isRepairingVision
      />,
    );
    expect(queryByTestId('repair-vision-progress')).toBeNull();
    expect(getByTestId('repairing-vision-badge')).toBeTruthy();
  });
});
