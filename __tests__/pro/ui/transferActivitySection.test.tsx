/**
 * The Activity list: what a transfer says about itself, and whether its buttons do anything.
 *
 * Every row here advertises what it can do (`capabilities`) and the projection separately registers what
 * actually does it (`dispatchAction`). Those are two halves of one thing, and nothing in the type system pairs
 * them - a row can render Retry, Cancel and Dismiss and have every press reach nothing. The comment in
 * syncControlCenterData.ts says as much: "the buttons render and pressing them reaches nothing".
 *
 * So the central test is a SWEEP: build a real projection over a realistic set of transfers, render the real
 * section, and for every button that is visible and enabled, press it and require that the matching handler was
 * called. A dead button fails this test by construction, whichever row grows one next.
 *
 * The projection is the production one, so the phase words, the progress and the capability flags are computed
 * the way the app computes them. Only the icon font is shimmed.
 */

import React from 'react';
import { render, fireEvent, within } from '@testing-library/react-native';
import { proIsPresent, requirePro } from '../helpers/requirePro';

// Skipped rather than silently passed when the private submodule is absent - see proIsPresent.
const describePro = proIsPresent() ? describe : describe.skip;

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: { name: string }) => <Text>{name}</Text>;
});

type DataModule = typeof import('@offgrid/pro/sync/syncControlCenterData');
type SectionModule =
  typeof import('@offgrid/pro/ui/SyncScreen/TransferActivitySection');

let projectMobileSyncActivity: DataModule['projectMobileSyncActivity'];
let TransferActivitySection: SectionModule['TransferActivitySection'];
let available = true;

beforeAll(() => {
  const data = requirePro<DataModule>(
    '@offgrid/pro/sync/syncControlCenterData',
  );
  const section = requirePro<SectionModule>(
    '@offgrid/pro/ui/SyncScreen/TransferActivitySection',
  );
  if (!data || !section) {
    available = false;
    return;
  }
  projectMobileSyncActivity = data.projectMobileSyncActivity;
  TransferActivitySection = section.TransferActivitySection;
});

const THE_MAC = 'the-mac';
const NOW = 1_700_000_000_000;

/** Every action the projection can dispatch, recorded so a press can be traced to one of them. */
const handlers = () => ({
  cancelTransfer: jest.fn(),
  dismissLiveTransfer: jest.fn(),
  dismissCompletedTransfer: jest.fn(async () => undefined),
  retryAmbient: jest.fn(async () => undefined),
  cancelAmbient: jest.fn(async () => undefined),
  dismissAmbient: jest.fn(async () => undefined),
  retryModel: jest.fn(async () => undefined),
  cancelModel: jest.fn(),
  dismissModel: jest.fn(),
});

type Handlers = ReturnType<typeof handlers>;

const project = (
  acts: Handlers,
  over: Partial<Parameters<DataModule['projectMobileSyncActivity']>[0]> = {},
) =>
  projectMobileSyncActivity({
    transfers: [],
    completedTransfers: [],
    modelJobs: [],
    ambientActivity: [],
    files: [],
    completedDeliveries: [],
    knownDevices: [{ id: THE_MAC, name: 'The Mac' }] as never,
    filter: 'all' as never,
    view: 'list' as never,
    localDeviceId: 'this-phone',
    localDeviceName: 'This Phone',
    ...acts,
    ...over,
  });

const AMBIENT_SYNC_ID = '11111111-1111-4111-8111-111111111111';

/** A file this phone tried to send and could not. The row a user is most likely to touch. */
const failedAmbientSend = {
  syncId: AMBIENT_SYNC_ID,
  destinationId: THE_MAC,
  status: 'granted',
  createdAt: NOW,
  transferStatus: 'failed',
  error: 'The other device went away',
  file: {
    syncId: AMBIENT_SYNC_ID,
    kind: 'screenshot',
    name: 'Screenshot.png',
    mimeType: 'image/png',
    fileSize: 2048,
    createdAt: new Date(NOW).toISOString(),
  },
} as never;

/** One this phone is sending right now. */
const liveSend = {
  requestId: 'transfer-live',
  deviceId: THE_MAC,
  fileName: 'Report.pdf',
  direction: 'send',
  status: 'transferring',
  bytesTransferred: 512,
  totalBytes: 1024,
} as never;

/** One that arrived. */
const completedReceive = {
  requestId: 'transfer-done',
  deviceId: THE_MAC,
  fileName: 'Notes.txt',
  direction: 'receive',
  status: 'completed',
  bytesTransferred: 64,
  totalBytes: 64,
} as never;

const guard = (): boolean => available;

describePro('the Activity list', () => {
  it('says what happened to a transfer, in words and numbers the user reads', () => {
    if (!guard()) return;
    const acts = handlers();
    const projection = project(acts, { transfers: [liveSend] });

    const ui = render(
      <TransferActivitySection projection={projection} onOpen={jest.fn()} />,
    );

    // The row is the whole story of one transfer: what it is, which way it is going, who with, and how far.
    expect(ui.getByText('Report.pdf')).toBeTruthy();
    expect(ui.getByText(/Sending/)).toBeTruthy();
    expect(ui.getByText(/To The Mac/)).toBeTruthy();
  });

  it('shows a failure with its reason, not just a red row', () => {
    if (!guard()) return;
    const acts = handlers();
    const projection = project(acts, { ambientActivity: [failedAmbientSend] });

    const ui = render(
      <TransferActivitySection projection={projection} onOpen={jest.fn()} />,
    );

    // A reason is what makes a failure actionable - "could not send" alone leaves the user guessing whether to
    // retry, move closer, or give up. The alert role is how a screen reader gets it too.
    expect(ui.getByText('Screenshot.png')).toBeTruthy();
    expect(ui.getByText(/Could not send/)).toBeTruthy();
    expect(ui.getByText('The other device went away')).toBeTruthy();
  });

  it('reads a received file as received, from the device it came from', () => {
    if (!guard()) return;
    const acts = handlers();
    const projection = project(acts, { transfers: [completedReceive] });

    const ui = render(
      <TransferActivitySection projection={projection} onOpen={jest.fn()} />,
    );

    // Direction is not cosmetic: "Sent" on a file that arrived tells the user their phone leaked something.
    expect(ui.getByText(/Received/)).toBeTruthy();
    expect(ui.getByText(/From The Mac/)).toBeTruthy();
  });

  it('shows the saved event time for a completed transfer', () => {
    if (!guard()) return;
    const projection = project(handlers(), {
      completedTransfers: [{
        requestId: 'transfer-done',
        deviceId: THE_MAC,
        deviceName: 'The Mac',
        fileName: 'Notes.txt',
        direction: 'receive',
        status: 'completed',
        bytesTransferred: 64,
        totalBytes: 64,
        updatedAt: NOW,
      }] as never,
    });

    const ui = render(
      <TransferActivitySection projection={projection} onOpen={jest.fn()} />,
    );

    expect(ui.getByText(new Date(NOW).toLocaleString())).toBeTruthy();
  });

  it('keeps the saved event time while a transfer reports live progress', () => {
    if (!guard()) return;
    const projection = project(handlers(), {
      completedTransfers: [{
        requestId: 'transfer-live',
        deviceId: THE_MAC,
        deviceName: 'The Mac',
        fileName: 'Report.pdf',
        direction: 'send',
        status: 'queued',
        bytesTransferred: 0,
        totalBytes: 1024,
        updatedAt: NOW,
      }] as never,
      transfers: [liveSend],
    });

    const ui = render(
      <TransferActivitySection projection={projection} onOpen={jest.fn()} />,
    );

    expect(ui.getByText(new Date(NOW).toLocaleString())).toBeTruthy();
    expect(ui.getByText(/Sending/)).toBeTruthy();
  });

  it('lists nothing when nothing has moved', () => {
    if (!guard()) return;
    const acts = handlers();

    const ui = render(
      <TransferActivitySection projection={project(acts)} onOpen={jest.fn()} />,
    );

    expect(ui.toJSON()).toBeNull();
  });

  it('has the right word for every state a transfer can be in, both directions', () => {
    if (!guard()) return;
    const acts = handlers();
    const rows = [
      {
        requestId: 't-q',
        status: 'queued',
        direction: 'send',
        fileName: 'Queued.png',
      },
      {
        requestId: 't-s',
        status: 'transferring',
        direction: 'send',
        fileName: 'Sending.png',
      },
      {
        requestId: 't-r',
        status: 'transferring',
        direction: 'receive',
        fileName: 'Receiving.png',
      },
      {
        requestId: 't-fs',
        status: 'failed',
        direction: 'send',
        fileName: 'FailedSend.png',
      },
      {
        requestId: 't-fr',
        status: 'failed',
        direction: 'receive',
        fileName: 'FailedReceive.png',
      },
      {
        requestId: 't-cs',
        status: 'completed',
        direction: 'send',
        fileName: 'SentOk.png',
      },
      {
        requestId: 't-cr',
        status: 'completed',
        direction: 'receive',
        fileName: 'GotIt.png',
      },
      {
        requestId: 't-x',
        status: 'cancelled',
        direction: 'send',
        fileName: 'Stopped.png',
      },
    ].map(row => ({
      ...row,
      deviceId: THE_MAC,
      bytesTransferred: 1,
      totalBytes: 2,
    }));

    const projection = project(acts, { transfers: rows as never });
    const ui = render(
      <TransferActivitySection projection={projection} onOpen={jest.fn()} />,
    );

    // Scoped to each row, because the point is that THIS file says THIS word. An unscoped search would pass on
    // any row anywhere carrying the word, which is most of what could go wrong here.
    const expected: Record<string, RegExp> = {
      'Queued.png': /^Pending/,
      'Sending.png': /^Sending/,
      'Receiving.png': /^Receiving/,
      'FailedSend.png': /^Could not send/,
      'FailedReceive.png': /^Could not receive/,
      'SentOk.png': /^Sent/,
      'GotIt.png': /^Received/,
      'Stopped.png': /^Cancelled/,
    };
    let checked = 0;
    for (const item of projection.items) {
      const word = expected[item.name];
      if (!word) continue;
      const row = within(ui.getByTestId(`sync-activity-${item.id}`));
      // Direction changes the word, not just the icon: "Sent" on something that arrived would tell the user
      // their phone sent a file it did not, and "Could not receive" on a failed send hides which device to fix.
      expect(row.getAllByText(word).length).toBeGreaterThan(0);
      checked += 1;
    }
    expect(checked).toBe(Object.keys(expected).length);
  });

  it('shows how far a live transfer has got, in bytes as well as percent', () => {
    if (!guard()) return;
    const acts = handlers();

    const ui = render(
      <TransferActivitySection
        projection={project(acts, {
          transfers: [
            {
              requestId: 't-live',
              deviceId: THE_MAC,
              fileName: 'Big.zip',
              direction: 'send',
              status: 'transferring',
              bytesTransferred: 5 * 1024 * 1024,
              totalBytes: 20 * 1024 * 1024,
            },
          ] as never,
        })}
        onOpen={jest.fn()}
      />,
    );

    // A percentage alone is uninformative on a large file - "25%" of what matters when the user is deciding
    // whether to keep the phone awake. Both are on the row.
    expect(ui.getByText(/25%/)).toBeTruthy();
    expect(ui.getByText(/MB \/ /)).toBeTruthy();
    expect(ui.queryByText(/MB\/s/)).toBeNull();
    expect(ui.queryByText(/Rate unavailable/)).toBeNull();
  });

  it('shows the live rate for an ordinary file transfer', () => {
    if (!guard()) return;
    const acts = handlers();
    const ui = render(
      <TransferActivitySection
        projection={project(acts, {
          transfers: [{
            requestId: 'rate-live',
            deviceId: THE_MAC,
            fileName: 'Archive.zip',
            direction: 'receive',
            status: 'transferring',
            bytesTransferred: 4 * 1024 * 1024,
            totalBytes: 8 * 1024 * 1024,
            bytesPerSecond: 1.5 * 1024 * 1024,
          }] as never,
        })}
        onOpen={jest.fn()}
      />,
    );

    expect(ui.getByText('4 MB / 8 MB · 1.5 MB/s')).toBeTruthy();
  });

  it('shows one model job instead of one raw row for every file in a vision package', async () => {
    if (!guard()) return;
    const acts = handlers();
    const modelJob = {
      id: 'vision-job',
      direction: 'send',
      peerDeviceId: THE_MAC,
      peerName: 'The Mac',
      modelId: 'google/gemma-vision',
      modelName: 'Gemma Vision',
      fileCount: 2,
      bytesTotal: 8 * 1024 * 1024,
      bytesTransferred: 4 * 1024 * 1024,
      phase: 'transferring',
      startedAt: NOW - 10_000,
      transferStartedAt: NOW - 3_000,
      transferStartedBytes: 1 * 1024 * 1024,
      updatedAt: NOW,
      packageId: 'vision-package',
      requestIds: ['model-primary', 'model-projector'],
    } as const;
    const projection = project(acts, {
      modelJobs: [modelJob] as never,
      transfers: [
        {
          requestId: 'model-projector',
          deviceId: THE_MAC,
          fileName: 'gemma-mmproj-F16.gguf',
          direction: 'send',
          status: 'transferring',
          bytesTransferred: 500,
          totalBytes: 1_000,
          mimeType: 'application/vnd.offgrid.model',
          kind: 'model',
        },
        {
          requestId: 'ordinary-file',
          deviceId: THE_MAC,
          fileName: 'Notes.txt',
          direction: 'send',
          status: 'transferring',
          bytesTransferred: 50,
          totalBytes: 100,
          mimeType: 'text/plain',
          kind: 'files',
        },
      ] as never,
      completedTransfers: [
        {
          requestId: 'model-primary',
          deviceId: THE_MAC,
          deviceName: 'The Mac',
          fileName: 'gemma-Q4_K_M.gguf',
          direction: 'send',
          status: 'completed',
          bytesTransferred: 2_000,
          totalBytes: 2_000,
          updatedAt: NOW - 1,
          mimeType: 'application/vnd.offgrid.model',
          kind: 'model',
        },
      ] as never,
    });

    const ui = render(
      <TransferActivitySection projection={projection} onOpen={jest.fn()} />,
    );

    expect(ui.getAllByText('Gemma Vision')).toHaveLength(1);
    expect(ui.queryByText('gemma-Q4_K_M.gguf')).toBeNull();
    expect(ui.queryByText('gemma-mmproj-F16.gguf')).toBeNull();
    expect(ui.getByText('Notes.txt')).toBeTruthy();
    expect(ui.getByText('4 MB / 8 MB · 1.0 MB/s')).toBeTruthy();

    fireEvent.press(
      ui.getByTestId(`sync-activity-cancel-model:${modelJob.id}`),
    );
    await Promise.resolve();
    expect(acts.cancelModel).toHaveBeenCalledWith(modelJob.id);
    expect(acts.cancelTransfer).not.toHaveBeenCalled();
  });

  /**
   * The sweep. This is the test that makes a dead button impossible.
   */
  it('every button it offers actually does something', async () => {
    if (!guard()) return;
    const acts = handlers();
    const projection = project(acts, {
      transfers: [liveSend, completedReceive],
      ambientActivity: [failedAmbientSend],
      modelJobs: [
        {
          id: 'job-1',
          direction: 'send',
          peerDeviceId: THE_MAC,
          peerName: 'The Mac',
          modelId: 'a-model',
          modelName: 'A model',
          fileCount: 1,
          bytesTotal: 1024,
          bytesTransferred: 0,
          phase: 'failed',
          error: 'ran out of space',
          startedAt: NOW,
          updatedAt: NOW,
        },
      ] as never,
    });

    const onOpen = jest.fn();
    const ui = render(
      <TransferActivitySection projection={projection} onOpen={onOpen} />,
    );

    // Handlers grouped by the verb they implement. Pressing Retry has to reach a RETRY handler and no other -
    // summing every handler's calls, as this did, would pass a Retry button wired to a dismiss handler, which is
    // precisely the dead-button class this test exists to rule out. Grouped by verb rather than mapped per row so
    // the test does not re-encode the projection's routing table.
    const byVerb: Record<
      'retry' | 'cancel' | 'dismiss',
      Array<keyof Handlers>
    > = {
      retry: ['retryAmbient', 'retryModel'],
      cancel: ['cancelTransfer', 'cancelAmbient', 'cancelModel'],
      dismiss: [
        'dismissLiveTransfer',
        'dismissCompletedTransfer',
        'dismissAmbient',
        'dismissModel',
      ],
    };
    const callsIn = (verb: 'retry' | 'cancel' | 'dismiss') =>
      byVerb[verb].reduce(
        (total, name) => total + acts[name].mock.calls.length,
        0,
      );

    const pressed: string[] = [];
    // Open is the fourth button and it is the caller's job rather than the projection's, so it is checked the
    // same way: if the row offers it, pressing it has to reach the handler that knows how to open a file.
    for (const item of projection.items) {
      if (item.file.open.visible && item.file.open.enabled) {
        const before = onOpen.mock.calls.length;
        fireEvent.press(ui.getByTestId(`sync-activity-open-${item.id}`));
        expect(onOpen.mock.calls.length).toBeGreaterThan(before);
        pressed.push(`${item.id}:open`);
      }
      for (const action of ['retry', 'cancel', 'dismiss'] as const) {
        const state = item.actions[action];
        if (!state.visible || !state.enabled) continue;
        const button = ui.getByTestId(`sync-activity-${action}-${item.id}`);
        const before = {
          retry: callsIn('retry'),
          cancel: callsIn('cancel'),
          dismiss: callsIn('dismiss'),
        };

        fireEvent.press(button);
        await Promise.resolve();

        // Reached a handler for THIS verb, and none belonging to a different one. A Retry wired to a dismiss
        // handler satisfies the first and fails the second, which is why they are separate checks.
        //
        // Wrapped so a failure names the row and the verb: jest's expect takes no message, and "expected 1 to be
        // greater than 1" on its own does not say which of five rows was mis-wired.
        try {
          expect(callsIn(action)).toBeGreaterThan(before[action]);
          for (const other of ['retry', 'cancel', 'dismiss'] as const) {
            if (other === action) continue;
            expect(callsIn(other)).toBe(before[other]);
          }
        } catch {
          throw new Error(
            `${action} on "${item.id}" did not reach exactly a ${action} handler. ` +
              `retry:${callsIn('retry')} cancel:${callsIn(
                'cancel',
              )} dismiss:${callsIn('dismiss')} ` +
              `(before retry:${before.retry} cancel:${before.cancel} dismiss:${before.dismiss})`,
          );
        }
        pressed.push(`${item.id}:${action}`);
      }
    }

    // And the sweep has to have swept a real spread, or it would pass on one button and prove almost nothing.
    // Four rows are in play here - a live send, a completed receive, a failed ambient share, and a failed model
    // job - and between them they offer more than a couple of controls.
    expect(pressed.length).toBeGreaterThanOrEqual(4);
  });

  it('never enables a button it is not showing', () => {
    if (!guard()) return;
    const acts = handlers();
    const projection = project(acts, {
      transfers: [liveSend, completedReceive],
      ambientActivity: [failedAmbientSend],
    });

    render(
      <TransferActivitySection projection={projection} onOpen={jest.fn()} />,
    );

    for (const item of projection.items) {
      for (const action of ['retry', 'cancel', 'dismiss'] as const) {
        if (item.actions[action].enabled) {
          // Enabled-but-hidden is a contradiction that hides a real decision: something decided this action is
          // possible and something else decided not to offer it.
          expect(item.actions[action].visible).toBe(true);
        }
      }
    }
  });
});
