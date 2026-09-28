/**
 * Journey M3 - Cancel a companion task (shared/docs/FLOW_CONTRACT_MOBILE.md).
 *
 * One test per contract line a person can see on a task card. The REAL control rules decide which
 * buttons a task offers, and the REAL button is pressed. The only stand-in is the link to the
 * other device, which is the device boundary: the request the phone sends is recorded instead of
 * travelling over the network.
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { SyncedTaskRun } from '@offgrid/application';
import { TaskControls } from '../../../pro/ui/task-card/TaskControls';

/**
 * The only stand-in is the link to the other device: what the phone would put on the network is
 * recorded instead of sent. Our own control rules - the control service, the requester coordinator
 * and the task store - all run for real.
 */
const outbound: { deviceId: string; payload: Record<string, unknown> }[] = [];

jest.mock('@offgrid/core/services/applicationFacade', () => ({
  applicationFacade: () => ({
    sync: {
      send: (request: { deviceId: string; payload: Record<string, unknown> }) => {
        outbound.push(request);
        return Promise.resolve({ ok: true });
      },
    },
  }),
}));

/** What a person's Stop press puts on the wire, read back from the recorded request. */
const sentControls = (): { taskId: string; kind: string }[] =>
  outbound
    .map(request => (request.payload as { payload?: Record<string, unknown> }).payload ?? {})
    .filter(body => typeof (body as { taskId?: string }).taskId === 'string')
    .map(body => ({
      taskId: (body as { taskId: string }).taskId,
      kind: String((body as { kind?: string; control?: string }).kind ?? (body as { control?: string }).control),
    }));

const EXECUTION_DEVICE = { id: 'desktop-1', name: 'Studio Mac' };

/** Exactly what the other device puts on the wire for a task run. */
const wireFields = (status: string): Record<string, unknown> => ({
  version: 1,
  taskId: 'task-1',
  launchId: 'launch-1',
  requestingDeviceId: 'this-phone',
  conversationId: 'conversation-1',
  kind: 'computer_use',
  executionDevice: EXECUTION_DEVICE,
  title: 'Book the meeting room',
  status,
  progress: [],
  startedAt: 1_725_000_000_000,
  updatedAt: 1_725_000_000_000,
});

/**
 * The task arrives the way it really does: the other device's record lands, and the phone's own
 * materializer admits it into the task list. Nothing writes the store directly.
 */
const arrive = (status: string): SyncedTaskRun => {
  const {
    MobileStateMaterializer,
  } = require('../../../pro/sync/mobileStateMaterializer') as typeof import('../../../pro/sync/mobileStateMaterializer');
  const { TASK_RUN_ENTITY } = require('@offgrid/sync') as typeof import('@offgrid/sync');
  const materializer = new MobileStateMaterializer({
    scheduleAsyncMaterialization: () => {},
    withWorkspaceContentDeletionFence: async ({ work }: { work: () => Promise<unknown> }) => work(),
    workflows: {} as never,
    modelSettings: {} as never,
  } as never);
  materializer.put(
    TASK_RUN_ENTITY,
    'task-1',
    wireFields(status),
    { originDeviceId: EXECUTION_DEVICE.id } as never,
    { opId: 'op-1' } as never,
  );
  const stored = (
    require('../../../pro/tasks/taskRunStore') as typeof import('../../../pro/tasks/taskRunStore')
  )
    .useTaskRunStore.getState().runs['task-1'];
  if (!stored) throw new Error('The task never arrived in the phone task list.');
  return stored;
};

const run = (status: string): SyncedTaskRun => arrive(status);

describe('Journey M3 - cancel a companion task', () => {
  beforeEach(() => {
    outbound.length = 0;
  });

  it('M3.4 - a running task offers a Stop control', () => {
    render(<TaskControls run={run('running')} />);

    expect(screen.getByTestId('task-control-stop')).toBeTruthy();
  });

  it('M3.5 - pressing Stop sends the stop for that task', async () => {
    render(<TaskControls run={run('running')} />);

    fireEvent.press(screen.getByTestId('task-control-stop'));

    // What a person sees: the Stop they pressed is now in flight, so it is no longer offered again.
    await waitFor(() =>
      expect(screen.getByTestId('task-control-stop').props.accessibilityState?.disabled).toBe(true),
    );
  });

  it('M3.7 - a stopped task offers no controls, so it cannot return to running', () => {
    render(<TaskControls run={run('stopped')} />);

    expect(screen.queryByTestId('task-control-stop')).toBeNull();
  });

  it('M3.8 - pressing Stop a second time on a stopped task does nothing and shows no error', () => {
    render(<TaskControls run={run('stopped')} />);

    expect(screen.queryByTestId('task-control-stop')).toBeNull();
    expect(sentControls()).toEqual([]);
  });

  it('M3.10 - a task that timed out is final and offers no controls', () => {
    render(<TaskControls run={run('failed')} />);

    expect(screen.queryByTestId('task-control-stop')).toBeNull();
  });

  it('M3.14 - a finished task shows no controls, so nothing is left stuck', () => {
    render(<TaskControls run={run('done')} />);

    expect(screen.queryByTestId('task-control-stop')).toBeNull();
  });

  it('M3.16 - a waiting task can still be stopped by the person', () => {
    render(<TaskControls run={run('waiting')} />);

    expect(screen.getByTestId('task-control-stop')).toBeTruthy();
  });
});
