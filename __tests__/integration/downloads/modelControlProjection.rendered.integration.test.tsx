import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import {
  ActiveDownloadCard,
  type DownloadItem,
} from '../../../src/screens/DownloadManagerScreen/items';

const item = (status: string, overrides: Partial<DownloadItem> = {}): DownloadItem => ({
  type: 'active',
  modelType: 'text',
  downloadId: 'download-1',
  modelKey: 'offgrid/demo/demo-q4.gguf',
  modelId: 'offgrid/demo',
  fileName: 'demo-q4.gguf',
  author: 'offgrid',
  quantization: 'Q4_K_M',
  fileSize: 100,
  bytesDownloaded: 40,
  progress: 0.4,
  bytesPerSecond: 10,
  status,
  ...overrides,
});

function renderRow(status: string, overrides: Partial<DownloadItem> = {}) {
  const actions = {
    onRemove: jest.fn(),
    onRetry: jest.fn(),
    onPause: jest.fn(),
    onResume: jest.fn(),
  };
  return {
    actions,
    view: render(<ActiveDownloadCard item={item(status, overrides)} {...actions} />),
  };
}

describe('Mobile consumes the Shared model-download projection', () => {
  it('shows preflight and queued states without inventing transfer progress', () => {
    const preparing = renderRow('preparing', {
      fileSize: 0,
      bytesDownloaded: 0,
      progress: 0,
      bytesPerSecond: undefined,
    }).view;
    expect(preparing.getByText('Preparing...')).toBeTruthy();
    expect(preparing.queryByTestId('pause-download-button')).toBeNull();
    expect(preparing.getByTestId('remove-download-button')).toBeTruthy();
    preparing.unmount();

    const queued = renderRow('queued', {
      bytesDownloaded: 0,
      progress: 0,
      bytesPerSecond: undefined,
    }).view;
    expect(queued.getByLabelText('Queued')).toBeTruthy();
    expect(queued.queryByTestId('pause-download-button')).toBeNull();
    expect(queued.getByTestId('remove-download-button')).toBeTruthy();
  });

  it('shows measured progress and sends pause and cancel gestures to its callbacks', () => {
    const { actions, view } = renderRow('downloading');

    expect(view.getByTestId('download-progress-detail').props.children).toBe('40% · 40 B / 100 B · 10 B/s');
    fireEvent.press(view.getByTestId('pause-download-button'));
    fireEvent.press(view.getByTestId('remove-download-button'));

    expect(actions.onPause).toHaveBeenCalledWith(expect.objectContaining({ downloadId: 'download-1' }));
    expect(actions.onRemove).toHaveBeenCalledWith(expect.objectContaining({ downloadId: 'download-1' }));
  });

  it('shows resume for a paused transfer and retry for a failed transfer', () => {
    const paused = renderRow('paused');
    expect(paused.view.getByText('Paused')).toBeTruthy();
    fireEvent.press(paused.view.getByTestId('resume-download-button'));
    expect(paused.actions.onResume).toHaveBeenCalledWith(expect.objectContaining({ downloadId: 'download-1' }));
    paused.view.unmount();

    const failed = renderRow('failed');
    expect(failed.view.getByLabelText('Needs attention')).toBeTruthy();
    fireEvent.press(failed.view.getByTestId('failed-retry-button'));
    expect(failed.actions.onRetry).toHaveBeenCalledWith(expect.objectContaining({ downloadId: 'download-1' }));
  });
});
