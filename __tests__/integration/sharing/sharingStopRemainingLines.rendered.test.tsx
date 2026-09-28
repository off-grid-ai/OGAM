/**
 * Journey M2 - Stop sharing part way through a transfer: the lines not already covered.
 *
 * The eight lines already proved live in __tests__/integration/sync/sharingStopJourney.rendered.test.tsx
 * are untouched. This file covers the remaining eleven, one test per line, named after the line.
 *
 * The REAL projection rules turn transfer facts into what the list shows, and the REAL list draws
 * them. The only stand-in is the transfer feed itself, which is the device boundary. Reopening the
 * app is modelled the way it really happens: the live feed is empty and only the durable rows remain.
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

/**
 * `live` is what the running transfer feed reports right now. `durable` is what was written down.
 * A reopened app has an empty feed and its durable rows only.
 */
const projectionFor = (
  durable: ReturnType<typeof sending>[],
  live: ReturnType<typeof sending>[] = durable.filter(t => t.status === 'transferring'),
) =>
  projectMobileSyncActivity({
    transfers: live,
    completedTransfers: durable.map(queueRow) as never,
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

const paint = (
  durable: ReturnType<typeof sending>[],
  live?: ReturnType<typeof sending>[],
) =>
  render(
    <TransferActivitySection
      projection={projectionFor(durable, live)}
      onOpen={() => {}}
      emptyMessage="Nothing is being shared."
    />,
  );

const repaint = (
  view: ReturnType<typeof render>,
  durable: ReturnType<typeof sending>[],
  live?: ReturnType<typeof sending>[],
) =>
  view.rerender(
    <TransferActivitySection
      projection={projectionFor(durable, live)}
      onOpen={() => {}}
      emptyMessage="Nothing is being shared."
    />,
  );

/** Reopening the app: the live feed is gone, only what was written down remains. */
const reopen = (durable: ReturnType<typeof sending>[]) => paint(durable, []);

const stopped = sending({ status: 'cancelled' });
const finished = sending({ status: 'completed', bytesTransferred: 1_000_000 });

describe('Journey M2 - the sharing stop lines still uncovered', () => {
  beforeEach(() => {
    cancelled.length = 0;
  });

  it('M2.6 - after Stop the figure never climbs again and no new progress appears', async () => {
    const view = paint([sending()]);
    fireEvent.press(screen.getByTestId('sync-activity-cancel-transfer-1'));
    await waitFor(() => expect(cancelled).toEqual(['transfer-1']));
    repaint(view, [stopped]);
    expect(screen.getByText('Cancelled')).toBeTruthy();

    // A late report from the feed must not restart the figure on a stopped entry.
    repaint(view, [stopped], [sending({ bytesTransferred: 900_000 })]);
    expect(screen.queryByText(/90\s*%/)).toBeNull();
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });

  it('M2.8 - leaving the sharing screen and reopening it still says stopped, at the same figure', () => {
    const first = paint([stopped]);
    expect(screen.getByText('Cancelled')).toBeTruthy();
    first.unmount();

    reopen([stopped]);
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.getByText('notes.pdf')).toBeTruthy();
  });

  it('M2.9 - closing the app, reopening it and opening sharing still says stopped', () => {
    reopen([stopped]);

    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByTestId('sync-activity-cancel-transfer-1')).toBeNull();
  });

  it('M2.10 - starting the same share again starts fresh and climbs, with no old stopped figure', () => {
    const view = paint([stopped]);
    expect(screen.getByText('Cancelled')).toBeTruthy();

    // The same file is shared again: a new attempt, from the beginning.
    const restarted = sending({ requestId: 'transfer-2', bytesTransferred: 100_000 });
    repaint(view, [restarted]);

    expect(screen.getByText(/10\s*%/)).toBeTruthy();
    expect(screen.queryByText('Cancelled')).toBeNull();
  });

  it('M2.13 - closing the app right after a share finishes and reopening still says finished', () => {
    reopen([finished]);

    expect(screen.getByText(/Sent|Complete|Finished/i)).toBeTruthy();
    expect(screen.queryByText('Cancelled')).toBeNull();
  });

  it('M2.14 - the receiving device shows the whole file after that finished share', () => {
    reopen([
      sending({
        requestId: 'transfer-in',
        direction: 'receive',
        status: 'completed',
        bytesTransferred: 1_000_000,
      }),
    ]);

    expect(screen.getByText('notes.pdf')).toBeTruthy();
    expect(screen.getByText(/Received|Sent|Complete|Finished/i)).toBeTruthy();
  });

  it('M2.15 - turning sync off while a share runs ends the entry on its real last state', () => {
    const view = paint([sending()]);
    expect(screen.getByText(/40\s*%/)).toBeTruthy();

    // Sync goes off: the feed stops and the durable row keeps the last real figure.
    repaint(view, [sending({ status: 'cancelled', bytesTransferred: 400_000 })], []);

    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText(/100\s*%/)).toBeNull();
  });

  it('M2.16 - reopening sharing after turning sync back on reads the same as before', () => {
    const before = paint([sending({ status: 'cancelled', bytesTransferred: 400_000 })], []);
    const wording = screen.getByText('Cancelled').props.children;
    before.unmount();

    reopen([sending({ status: 'cancelled', bytesTransferred: 400_000 })]);
    expect(screen.getByText('Cancelled').props.children).toEqual(wording);
    expect(screen.getByText('notes.pdf')).toBeTruthy();
  });

  it('M2.17 - waking the phone during a share shows the figure that matches the real progress', () => {
    const view = paint([sending()]);
    expect(screen.getByText(/40\s*%/)).toBeTruthy();

    // Asleep, the feed sent nothing. On waking it reports where the transfer really is.
    repaint(view, [sending({ bytesTransferred: 850_000 })]);

    expect(screen.getByText(/85\s*%/)).toBeTruthy();
    expect(screen.queryByText(/40\s*%/)).toBeNull();
  });

  it('M2.18 - force quitting during a share and reopening shows a real state, never sending forever', () => {
    // The durable row still reads sending, but no transfer is running after the quit.
    reopen([sending()]);

    expect(screen.queryByTestId('sync-activity-cancel-transfer-1')).toBeNull();
    expect(screen.queryByText(/Sending|Transferring/i)).toBeNull();
  });

  it('M2.19 FLAG - the final write after Stop is never shown to a person', async () => {
    const view = paint([sending()]);
    fireEvent.press(screen.getByTestId('sync-activity-cancel-transfer-1'));
    await waitFor(() => expect(cancelled).toEqual(['transfer-1']));
    repaint(view, [stopped]);

    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText(/saving|writing|flush/i)).toBeNull();
  });
});
