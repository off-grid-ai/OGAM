import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  TASK_RUN_ENTITY,
  TASK_VISUAL_STEP_ENTITY,
  taskVisualStepId,
} from '@offgrid/sync';
import { TaskChatCard } from '../../../pro/ui/TaskChatCard';
import { MobileStateMaterializer } from '../../../pro/sync/mobileStateMaterializer';
import { projectNotificationCenter } from '../../../pro/sync/notificationCenter';
import { useTaskRunStore } from '../../../pro/tasks/taskRunStore';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { useChatStore } from '../../../src/stores/chatStore';

jest.mock('react-native-tcp-socket', () => {
  const {
    createNativeTcpBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const origin = {
  originDeviceId: 'desktop-1',
  originDeviceName: 'Office Mac',
};

const runningComputerTask = {
  version: 1 as const,
  launchId: 'launch-task-computer-1',
  requestingDeviceId: 'phone-1',
  taskId: 'task-computer-1',
  conversationId: 'chat-mobile-1',
  kind: 'computer_use' as const,
  executionDevice: { id: 'desktop-1', name: 'Office Mac' },
  title: 'Send the project update in Slack',
  status: 'running' as const,
  phase: 'acting' as const,
  currentStep: 4,
  currentAction: 'Typing the message',
  plan: {
    phases: [
      { id: 'open', title: 'Open Slack' },
      { id: 'find', title: 'Find Ali' },
      { id: 'send', title: 'Send the update' },
    ],
    activePhaseIndex: 2,
  },
  progress: [
    { sequence: 1, label: 'Opened Slack', at: 10 },
    { sequence: 2, label: 'Found Ali', at: 20 },
  ],
  frame: {
    sequence: 2,
    mimeType: 'image/jpeg' as const,
    payloadBase64: 'aGVsbG8=',
    width: 300,
    height: 200,
    capturedAt: 20,
  },
  cursor: { x: 150, y: 100 },
  startedAt: 10,
  updatedAt: 20,
};

function putConversation(materializer: MobileStateMaterializer): void {
  materializer.put(
    'conversation',
    runningComputerTask.conversationId,
    {
      title: runningComputerTask.title,
      created_at: new Date(10).toISOString(),
      updated_at: new Date(20).toISOString(),
      project_id: null,
    },
    origin,
  );
  useChatStore
    .getState()
    .setActiveConversation(runningComputerTask.conversationId);
}

describe('synced Web Use and Computer Use task in chat', () => {
  const materializer = new MobileStateMaterializer();

  beforeEach(() => {
    useChatStore.getState().clearAllConversations();
    materializer.remove(TASK_RUN_ENTITY, runningComputerTask.taskId);
    materializer.remove(TASK_RUN_ENTITY, 'task-web-1');
    materializer.remove(
      TASK_VISUAL_STEP_ENTITY,
      taskVisualStepId('task-web-1', 1),
    );
    materializer.remove(
      TASK_VISUAL_STEP_ENTITY,
      taskVisualStepId('task-web-1', 2),
    );
    useSyncStore.getState().setThisDevice({
      id: 'phone-1',
      name: 'Ali phone',
      platform: 'ios',
      version: '1',
      host: '',
      port: 0,
    });
    useSyncStore.getState().setConnectedDeviceIds(['desktop-1']);
    putConversation(materializer);
  });

  it('shows the live Computer Use screen, cursor, and working controls in its chat', async () => {
    materializer.put(
      TASK_RUN_ENTITY,
      runningComputerTask.taskId,
      runningComputerTask,
      origin,
    );
    const screen = render(
      <TaskChatCard
        message={{
          toolName: 'computer_use',
          toolCallId: 'computer-call-1',
          content: `Task started. Task reference: ${runningComputerTask.taskId}.`,
        }}
      />,
    );

    expect(screen.getByText('COMPUTER USE')).toBeTruthy();
    expect(screen.getByText(runningComputerTask.title)).toBeTruthy();
    expect(screen.getByText('PLAN')).toBeTruthy();
    expect(screen.getByText('Open Slack')).toBeTruthy();
    expect(screen.getByText('Find Ali')).toBeTruthy();
    expect(screen.getByText('Send the update')).toBeTruthy();
    expect(screen.getAllByText('DONE')).toHaveLength(2);
    expect(screen.getByText('NOW')).toBeTruthy();
    expect(screen.getByText('Typing the message')).toBeTruthy();
    fireEvent.press(screen.getByTestId('task-activity-disclosure'));
    expect(screen.getByText('Opened Slack')).toBeTruthy();
    expect(screen.getAllByText('Found Ali')).toHaveLength(2);
    act(() =>
      fireEvent(screen.getByTestId('task-session-frame'), 'layout', {
        nativeEvent: { layout: { width: 300, height: 200, x: 0, y: 0 } },
      }),
    );
    expect(screen.getByLabelText('Live view from Office Mac')).toBeTruthy();
    expect(screen.getByTestId('task-session-cursor')).toBeTruthy();
    expect(screen.getByText('LIVE VIEW')).toBeTruthy();
    expect(screen.queryByTestId('task-live-frame')).toBeNull();
    expect(screen.getAllByTestId('task-session-frame')).toHaveLength(1);
    expect(screen.getByText('Pause')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.queryByText('Take Over')).toBeNull();
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Decline')).toBeNull();

    act(() => useSyncStore.getState().setConnectedDeviceIds([]));
    expect(
      screen.getByText(
        'Office Mac is offline. Progress and controls resume when it reconnects.',
      ),
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId('task-control-pause'));
    await waitFor(() =>
      expect(screen.getByText('Pause requested')).toBeTruthy(),
    );
    const request =
      useTaskRunStore.getState().requestedControlByTaskId[
        runningComputerTask.taskId
      ];

    act(() =>
      materializer.put(
        TASK_RUN_ENTITY,
        runningComputerTask.taskId,
        {
          ...runningComputerTask,
          status: 'paused',
          phase: 'paused',
          updatedAt: 30,
          latestControlResult: {
            controlId: request!.controlId,
            kind: 'pause',
            outcome: 'applied',
            respondedAt: 30,
          },
        },
        origin,
      ),
    );
    expect(screen.getByText('Resume')).toBeTruthy();
    expect(screen.queryByText('Pause requested')).toBeNull();
    expect(projectNotificationCenter([], 'all').badgeCount).toBe(0);
  });

  it('shows a failed Web Use task with a clear recovery and no live controls', () => {
    materializer.put(
      TASK_RUN_ENTITY,
      'task-web-1',
      {
        ...runningComputerTask,
        taskId: 'task-web-1',
        kind: 'web_use',
        title: 'Find a flight to Pune',
        status: 'failed',
        phase: 'failed',
        summary: 'No booking was made.',
        failure: {
          code: 'desktop_offline',
          message: 'Office Mac disconnected before the task finished.',
          recoverable: true,
          recoveryAction: 'reconnect',
        },
        finishedAt: 30,
        updatedAt: 30,
      },
      origin,
    );
    for (const sequence of [1, 2]) {
      const visualStepId = taskVisualStepId('task-web-1', sequence);
      materializer.put(
        TASK_VISUAL_STEP_ENTITY,
        visualStepId,
        {
          version: 1,
          visualStepId,
          taskId: 'task-web-1',
          conversationId: runningComputerTask.conversationId,
          sequence,
          executionDevice: runningComputerTask.executionDevice,
          actionLabel: sequence === 1 ? 'Opened search' : 'Checked results',
          frame: {
            ...runningComputerTask.frame,
            sequence,
            capturedAt: sequence * 1_000,
          },
        },
        origin,
      );
    }

    const screen = render(
      <TaskChatCard
        message={{
          toolName: 'web_use',
          toolCallId: 'web-call-1',
          content: 'Task failed. Task reference: task-web-1.',
        }}
      />,
    );
    expect(screen.getByText('WEB USE')).toBeTruthy();
    expect(screen.getByText('Find a flight to Pune')).toBeTruthy();
    expect(screen.getByText('No booking was made.')).toBeTruthy();
    expect(
      screen.getByText('Office Mac disconnected before the task finished.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Reconnect Office Mac and try again.'),
    ).toBeTruthy();
    expect(screen.queryByText('Stop')).toBeNull();
    expect(screen.queryByText('Take Over')).toBeNull();
    expect(screen.getByText('SESSION REPLAY')).toBeTruthy();
    expect(screen.getByText('Step 1 of 2 · 0:00 / 0:01')).toBeTruthy();
    expect(screen.getByText('Play')).toBeTruthy();
    expect(screen.getByTestId('task-session-scrubber')).toBeTruthy();
    expect(screen.getAllByTestId('task-session-frame')).toHaveLength(1);
    expect(screen.queryByTestId('task-live-frame')).toBeNull();
    const notifications = projectNotificationCenter([], 'all');
    expect(notifications.badgeCount).toBe(0);
    expect(notifications.items).not.toContainEqual(
      expect.objectContaining({ type: 'task-run' }),
    );
  });
});
