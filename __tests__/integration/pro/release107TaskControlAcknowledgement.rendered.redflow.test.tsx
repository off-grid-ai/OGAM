import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { TASK_RUN_ENTITY, type SyncedTaskRun } from '@offgrid/sync';
import { TaskChatCard } from '../../../pro/ui/TaskChatCard';
import { requestActiveTaskStop } from '../../../pro/tasks/taskControlService';
import { MobileStateMaterializer } from '../../../pro/sync/mobileStateMaterializer';
import {
  TASK_CONTROL_ACK_TIMEOUT_MS,
  useTaskRunStore,
} from '../../../pro/tasks/taskRunStore';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { ChatInput } from '../../../src/components/ChatInput';
import { handleStopFn } from '../../../src/screens/ChatScreen/useChatGenerationActions';
import {
  HOOKS,
  _clearHooksForTesting,
  registerHook,
} from '../../../src/bootstrap/hookRegistry';

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

const materializer = new MobileStateMaterializer();
const origin = {
  originDeviceId: 'desktop-release-107',
  originDeviceName: 'Office Mac',
};

function runningTask(kind: SyncedTaskRun['kind']): SyncedTaskRun {
  return {
    version: 1,
    launchId: `launch-release-107-${kind}`,
    requestingDeviceId: 'mobile-device',
    taskId: `release-107-${kind}`,
    conversationId: `release-107-chat-${kind}`,
    kind,
    executionDevice: {
      id: origin.originDeviceId,
      name: origin.originDeviceName,
    },
    title:
      kind === 'web_use'
        ? 'Check the release status'
        : 'Open the release build',
    status: 'running',
    phase: 'acting',
    currentAction: 'Working on the task',
    progress: [],
    startedAt: 10,
    updatedAt: 20,
  };
}

function renderTask(
  run: SyncedTaskRun,
  includeChatStop = false,
): ReturnType<typeof render> {
  materializer.put(
    'conversation',
    run.conversationId,
    {
      title: run.title,
      created_at: new Date(run.startedAt).toISOString(),
      updated_at: new Date(run.updatedAt).toISOString(),
      project_id: null,
    },
    origin,
  );
  useChatStore.getState().setActiveConversation(run.conversationId);
  materializer.put(
    TASK_RUN_ENTITY,
    run.taskId,
    run as unknown as Record<string, unknown>,
    origin,
  );
  return render(
    <>
      <TaskChatCard
        message={{
          toolName: run.kind,
          toolCallId: `call-${run.taskId}`,
          content: `Task started. Task reference: ${run.taskId}.`,
        }}
      />
      {includeChatStop ? (
        <ChatInput
          onSend={async () => undefined}
          onStop={() => handleStopFn({ isGeneratingImage: false })}
          isGenerating
        />
      ) : null}
    </>,
  );
}

describe('Release 107 rendered task-control acknowledgement', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    registerHook(HOOKS.taskStopActive, requestActiveTaskStop);
    useChatStore.getState().clearAllConversations();
    useSyncStore.getState().setThisDevice({
      id: 'mobile-release-107',
      name: 'Release phone',
      platform: 'ios',
      version: '107',
      host: '',
      port: 0,
    });
    useSyncStore.getState().setConnectedDeviceIds([origin.originDeviceId]);
  });

  afterEach(() => {
    for (const kind of ['web_use', 'computer_use'] as const) {
      materializer.remove(TASK_RUN_ENTITY, runningTask(kind).taskId);
    }
    _clearHooksForTesting();
    jest.useRealTimers();
  });

  it('stops the active Desktop task from the chat Stop button', async () => {
    const run = {
      ...runningTask('computer_use'),
      requestingDeviceId: 'mobile-release-107',
    };
    const screen = renderTask(run, true);

    await act(async () => {
      fireEvent.press(screen.getByTestId('stop-button'));
    });

    expect(screen.getByText('Stop requested')).toBeTruthy();
  });

  it.each(['web_use', 'computer_use'] as const)(
    'keeps a %s request pending through unrelated updates, clears it on a matching acknowledgement, and bounds the next wait',
    async kind => {
      const run = runningTask(kind);
      const screen = renderTask(run);

      await act(async () => {
        fireEvent.press(screen.getByTestId('task-control-pause'));
      });
      const pauseRequest =
        useTaskRunStore.getState().requestedControlByTaskId[run.taskId];
      expect(pauseRequest?.controlId).toBeTruthy();
      expect(screen.getByText('Pause requested')).toBeTruthy();
      expect(
        screen.getByTestId('task-control-stop').props.accessibilityState,
      ).toMatchObject({
        disabled: true,
      });

      act(() => {
        materializer.put(
          TASK_RUN_ENTITY,
          run.taskId,
          {
            ...run,
            currentAction: 'Opened another page',
            updatedAt: 30,
            latestControlResult: {
              controlId: 'another-control',
              kind: 'pause',
              outcome: 'applied',
              respondedAt: 30,
            },
          },
          origin,
        );
      });
      expect(screen.getByText('Pause requested')).toBeTruthy();

      act(() => {
        materializer.put(
          TASK_RUN_ENTITY,
          run.taskId,
          {
            ...run,
            status: 'paused',
            phase: 'paused',
            updatedAt: 40,
            latestControlResult: {
              controlId: pauseRequest!.controlId,
              kind: 'pause',
              outcome: 'applied',
              respondedAt: 40,
            },
          },
          origin,
        );
      });
      expect(screen.queryByText('Pause requested')).toBeNull();
      expect(screen.getByText('Resume')).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByTestId('task-control-stop'));
      });
      const rejectedRequest =
        useTaskRunStore.getState().requestedControlByTaskId[run.taskId];
      expect(screen.getByText('Stop requested')).toBeTruthy();

      act(() => {
        materializer.put(
          TASK_RUN_ENTITY,
          run.taskId,
          {
            ...run,
            status: 'paused',
            phase: 'paused',
            updatedAt: 50,
            latestControlResult: {
              controlId: rejectedRequest!.controlId,
              kind: 'stop',
              outcome: 'rejected',
              message:
                'The task owner rejected Stop because the run already changed.',
              respondedAt: 50,
            },
          },
          origin,
        );
      });
      expect(
        screen.getByText(
          'The task owner rejected Stop because the run already changed.',
        ),
      ).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByTestId('task-control-stop'));
      });
      expect(screen.getByText('Stop requested')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(TASK_CONTROL_ACK_TIMEOUT_MS);
      });
      expect(
        screen.getByText(
          'Off Grid AI Desktop did not confirm the stop request on Office Mac within 15 seconds. Try again.',
        ),
      ).toBeTruthy();
      expect(
        screen.getByTestId('task-control-stop').props.accessibilityState,
      ).toMatchObject({
        disabled: false,
      });
    },
  );

  it.each(['web_use', 'computer_use'] as const)(
    'continues a waiting %s task after the user completes the step on its Mac',
    async kind => {
      const waiting: SyncedTaskRun = {
        ...runningTask(kind),
        status: 'waiting',
        phase: 'waiting',
        currentAction: 'Sign in on Office Mac',
      };
      const screen = renderTask(waiting);

      expect(screen.getByText('Continue')).toBeTruthy();
      expect(screen.getByText(/Complete the requested step on Office Mac/)).toBeTruthy();
      expect(screen.getByText(/Your phone does not take control of the Mac/)).toBeTruthy();
      expect(screen.queryByText('Take Over')).toBeNull();

      await act(async () => {
        fireEvent.press(screen.getByTestId('task-control-continue'));
      });
      const request = useTaskRunStore.getState().requestedControlByTaskId[waiting.taskId];
      expect(request).toMatchObject({ kind: 'resume', label: 'Continue', state: 'pending' });
      expect(screen.getByText('Continue requested')).toBeTruthy();

      act(() => {
        materializer.put(
          TASK_RUN_ENTITY,
          waiting.taskId,
          {
            ...waiting,
            status: 'running',
            phase: 'acting',
            currentAction: 'Continuing after sign-in',
            updatedAt: 30,
            latestControlResult: {
              controlId: request!.controlId,
              kind: 'resume',
              outcome: 'applied',
              respondedAt: 30,
            },
          },
          origin,
        );
      });

      expect(screen.queryByText('Continue requested')).toBeNull();
      expect(screen.getByText('Continuing after sign-in')).toBeTruthy();
      expect(screen.queryByTestId('task-handoff-guidance')).toBeNull();
    },
  );
});
