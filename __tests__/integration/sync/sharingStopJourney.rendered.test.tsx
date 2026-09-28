/**
 * Journey M2 - Stop sharing part way through a transfer (shared/docs/FLOW_CONTRACT_MOBILE.md).
 *
 * One test per contract line a person can see on the sharing activity list. The REAL projection
 * rules turn transfer facts into what the list shows, and the REAL list draws them. Cancelling
 * happens by pressing the real Stop control. Nothing sets screen state directly; the only stand-in
 * is the transfer feed itself, which is the device boundary.
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { projectMobileSyncActivity } from '../../../pro/sync/syncControlCenterData';
import { TransferActivitySection } from '../../../pro/ui/SyncScreen/TransferActivitySection';

const sending = (overrides: Record<string, unknown> = {}) => ({
  requestId: 'transfer-1',
  deviceId: 'phone-2',
  direction: 'send' as const,
  fileName: 'notes.pdf',
  bytesTransferred: 400_000,
  totalBytes: 1_000_000,
  bytesPerSecond: 100_000,
  status: 'transferring' as const,
  kind: 'file',
  ...overrides,
});

/** The durable queue row every share has, written when the share starts. */
const queueRow = (transfer: ReturnType<typeof sending>) => ({
  requestId: transfer.requestId,
  deviceId: transfer.deviceId,
  direction: transfer.direction,
  deviceName: 'Field Phone',
  fileName: transfer.fileName,
  bytesTransferred: transfer.bytesTransferred,
  totalBytes: transfer.totalBytes,
  status: transfer.status,
  updatedAt: 1_725_000_000_000,
  ...(transfer.status === 'transferring' ? {} : { completedAt: 1_725_000_000_000 }),
});

const cancelled: string[] = [];

const projectionFor = (transfers: ReturnType<typeof sending>[]) =>
  projectMobileSyncActivity({
    transfers: transfers.filter(transfer => transfer.status === 'transferring'),
    completedTransfers: transfers.map(queueRow) as never,
    modelJobs: [],
    ambientActivity: [],
    files: [],
    completedDeliveries: [],
    devices: [
      { id: 'phone-2', name: 'Field Phone', paired: true, connected: true } as never,
    ],
    filter: 'all' as never,
    view: 'list' as never,
    localDeviceId: 'this-phone',
    localDeviceName: 'This Phone',
    cancelTransfer: (transfer) => {
      cancelled.push(transfer.requestId);
    },
    dismissLiveTransfer: () => {},
    dismissCompletedTransfer: async () => {},
    retryAmbient: async () => {},
    cancelAmbient: async () => {},
    dismissAmbient: async () => {},
    retryModel: async () => {},
    cancelModel: () => {},
    dismissModel: () => {},
  });

const paint = (transfers: ReturnType<typeof sending>[]) =>
  render(
    <TransferActivitySection
      projection={projectionFor(transfers)}
      onOpen={() => {}}
      emptyMessage="Nothing is being shared."
    />,
  );

describe('Journey M2 - stop sharing part way through a transfer', () => {
  beforeEach(() => {
    cancelled.length = 0;
  });

  it('M2.1 - with nothing shared, the list says so instead of showing a leftover entry', () => {
    paint([]);

    expect(screen.getByText('Nothing is being shared.')).toBeTruthy();
  });

  it('M2.2 - a started share appears with a progress figure', () => {
    paint([sending()]);

    expect(screen.getByText('notes.pdf')).toBeTruthy();
    expect(screen.getByText(/40\s*%/)).toBeTruthy();
  });

  it('M2.3 - the figure only rises as more of the file is sent', () => {
    const view = paint([sending()]);
    expect(screen.getByText(/40\s*%/)).toBeTruthy();

    view.rerender(
      <TransferActivitySection
        projection={projectionFor([sending({ bytesTransferred: 700_000 })])}
        onOpen={() => {}}
        emptyMessage="Nothing is being shared."
      />,
    );

    expect(screen.getByText(/70\s*%/)).toBeTruthy();
  });

  it('M2.4 - a Stop control sits on the entry while it is sending', () => {
    paint([sending()]);

    expect(screen.getByTestId('sync-activity-cancel-transfer-1')).toBeTruthy();
  });

  it('M2.5 - pressing Stop marks the entry stopped', async () => {
    const view = paint([sending()]);

    fireEvent.press(screen.getByTestId('sync-activity-cancel-transfer-1'));
    await waitFor(() => expect(cancelled).toEqual(['transfer-1']));
    view.rerender(
      <TransferActivitySection
        projection={projectionFor([sending({ status: 'cancelled' })])}
        onOpen={() => {}}
        emptyMessage="Nothing is being shared."
      />,
    );

    expect(screen.getByText('Cancelled')).toBeTruthy();
  });

  it('M2.7 - a stopped entry no longer offers Stop', () => {
    paint([sending({ status: 'cancelled' })]);

    expect(screen.queryByTestId('sync-activity-cancel-transfer-1')).toBeNull();
  });

  it('M2.11 - a finished share says finished', () => {
    paint([sending({ status: 'completed', bytesTransferred: 1_000_000 })]);

    expect(screen.getByText(/Sent|Complete|Finished/i)).toBeTruthy();
  });

  it('M2.12 - a finished share offers no Stop, so it cannot fall back', () => {
    paint([sending({ status: 'completed', bytesTransferred: 1_000_000 })]);

    expect(screen.queryByTestId('sync-activity-cancel-transfer-1')).toBeNull();
  });
});
