/**
 * CompletedDownloadCard — repair-vision progress (BUG OD2)
 *
 * When a vision repair is in flight, the card must render the SAME determinate
 * progress bar the normal download shows (reading the live download-store row
 * keyed on the model's modelKey), not just the indeterminate "Repairing"
 * spinner. Drives the REAL useDownloadStore and asserts the observable UI:
 * the progress row appears and its byte text advances as the store advances.
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';
import {
  CompletedDownloadCard,
  DownloadItem,
} from '../../../src/screens/DownloadManagerScreen/items';
import { useDownloadStore } from '../../../src/stores/downloadStore';

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

function seedRepairEntry(bytes: number, progress: number) {
  act(() => {
    useDownloadStore.setState({
      repairingVisionIds: { [MODEL_KEY]: true },
      downloads: {
        [MODEL_KEY]: {
          modelKey: MODEL_KEY,
          downloadId: 'repair-1',
          modelId: 'test/model',
          fileName: 'mmproj-model-f16.gguf',
          quantization: 'Q4_K_M',
          modelType: 'text',
          status: 'running',
          bytesDownloaded: bytes,
          totalBytes: MMPROJ_TOTAL,
          combinedTotalBytes: MMPROJ_TOTAL,
          progress,
          createdAt: Date.now(),
        },
      },
      downloadIdIndex: { 'repair-1': MODEL_KEY },
    } as any);
  });
}

describe('CompletedDownloadCard — repair-vision determinate progress', () => {
  beforeEach(() => {
    useDownloadStore.setState({
      downloads: {},
      downloadIdIndex: {},
      repairingVisionIds: {},
    });
  });

  it('renders the determinate progress bar (not just a spinner) while a repair download is in flight', () => {
    seedRepairEntry(MMPROJ_TOTAL / 2, 0.5);

    const { getByTestId, queryByText } = render(
      <CompletedDownloadCard
        item={completedItem}
        onDelete={jest.fn()}
        isRepairingVision
      />,
    );

    // The shared progress row is present with mid-download byte text.
    expect(getByTestId('repair-vision-progress')).toBeTruthy();
    expect(queryByText(/429 MB \/ 858 MB/)).toBeTruthy();
  });

  it('advances the rendered bytes as the store advances (incremental, not terminal-only)', () => {
    seedRepairEntry(MMPROJ_TOTAL / 2, 0.5);
    const { queryByText, rerender } = render(
      <CompletedDownloadCard
        item={completedItem}
        onDelete={jest.fn()}
        isRepairingVision
      />,
    );
    expect(queryByText(/429 MB \/ 858 MB/)).toBeTruthy();

    seedRepairEntry(MMPROJ_TOTAL * 0.9, 0.9);
    rerender(
      <CompletedDownloadCard
        item={completedItem}
        onDelete={jest.fn()}
        isRepairingVision
      />,
    );
    expect(queryByText(/772 MB \/ 858 MB/)).toBeTruthy();
    expect(queryByText(/429 MB \/ 858 MB/)).toBeNull();
  });

  it('shows only the indeterminate spinner (no progress row) when repairing but no store row exists yet', () => {
    // Repairing flag set, but the download row not yet seeded (pre-start window).
    act(() => {
      useDownloadStore.setState({
        repairingVisionIds: { [MODEL_KEY]: true },
        downloads: {},
        downloadIdIndex: {},
      } as any);
    });
    const { getByTestId, queryByTestId } = render(
      <CompletedDownloadCard
        item={completedItem}
        onDelete={jest.fn()}
        isRepairingVision
      />,
    );
    expect(queryByTestId('repair-vision-progress')).toBeNull();
    expect(getByTestId('repairing-vision-badge')).toBeTruthy();
  });
});
