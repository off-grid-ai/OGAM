import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  TASK_RUN_ENTITY,
  TASK_VISUAL_STEP_ENTITY,
  taskVisualStepId,
  type SyncedTaskRun,
  type SyncedTaskVisualStep,
} from '@offgrid/sync';
import { MobileStateMaterializer } from '../../../pro/sync/mobileStateMaterializer';
import { isRequiredSyncEntity } from '../../../pro/sync/requiredSyncEntity';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { TaskChatCard } from '../../../pro/ui/TaskChatCard';
import {
  SLOTS,
  _clearSlotsForTesting,
  registerSlot,
} from '../../../src/bootstrap/slotRegistry';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { useAccordionStore } from '../../../src/stores/accordionStore';
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

jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) =>
    require('react').createElement(require('react-native').View, props),
}));

const materializer = new MobileStateMaterializer();
const origin = {
  originDeviceId: 'desktop-session-owner',
  originDeviceName: 'Studio Mac',
};
const FRAME_PAYLOAD = '/9j/2Q==';

const taskToolName = (kind: SyncedTaskRun['kind']): string =>
  kind === 'computer_use' ? 'computer_use' : kind;

function taskRun(
  kind: SyncedTaskRun['kind'],
  status: SyncedTaskRun['status'],
): SyncedTaskRun {
  const taskId = `release-107-session-${kind}-${status}`;
  return {
    version: 1,
    launchId: `launch-${taskId}`,
    requestingDeviceId: 'mobile-device',
    taskId,
    conversationId: `${taskId}-chat`,
    kind,
    executionDevice: { id: origin.originDeviceId, name: 'Studio Mac' },
    title: kind === 'web_use' ? 'Review the site' : 'Review the desktop app',
    status,
    phase:
      status === 'running'
        ? 'acting'
        : status === 'done'
          ? 'complete'
          : status === 'reconnecting'
            ? 'waiting'
          : status,
    progress: [],
    startedAt: 1_000,
    updatedAt: 4_000,
    finishedAt: status === 'running' ? undefined : 4_000,
    ...(status === 'running'
      ? {
          frame: {
            sequence: 3,
            mimeType: 'image/jpeg' as const,
            payloadBase64: FRAME_PAYLOAD,
            width: 100,
            height: 50,
            capturedAt: 4_000,
          },
        }
      : {}),
  };
}

function visualStep(
  run: SyncedTaskRun,
  sequence: number,
): SyncedTaskVisualStep {
  return {
    version: 1,
    visualStepId: taskVisualStepId(run.taskId, sequence),
    taskId: run.taskId,
    conversationId: run.conversationId,
    sequence,
    executionDevice: run.executionDevice,
    phase: sequence === 1 ? 'observing' : 'acting',
    actionLabel: sequence === 1 ? 'Opened the target' : 'Selected Continue',
    cursor: sequence === 2 ? { x: 75, y: 25 } : undefined,
    frame: {
      sequence,
      mimeType: 'image/jpeg',
      payloadBase64: FRAME_PAYLOAD,
      width: 100,
      height: 50,
      capturedAt: sequence === 1 ? 2_000 : 5_500,
    },
    ...(sequence === 2 ? { result: { status: 'complete' as const } } : {}),
  };
}

function renderSyncedTask(run: SyncedTaskRun): ReturnType<typeof render> {
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
  // Admitted sync puts the authenticated run owner before its evidence.
  for (const sequence of [2, 1]) {
    const step = visualStep(run, sequence);
    materializer.put(
      TASK_VISUAL_STEP_ENTITY,
      step.visualStepId,
      step as unknown as Record<string, unknown>,
      origin,
    );
  }
  return render(
    <ChatMessage
      message={{
        id: `result-${run.taskId}`,
        role: 'tool',
        timestamp: run.updatedAt,
        toolName: taskToolName(run.kind),
        toolCallId: `call-${run.taskId}`,
        content: `Raw task plan must stay hidden. Task reference: ${run.taskId}.`,
      }}
      showActions={false}
    />,
  );
}

function removeSyncedTask(run: SyncedTaskRun): void {
  materializer.remove(TASK_RUN_ENTITY, run.taskId);
  for (const sequence of [1, 2]) {
    materializer.remove(
      TASK_VISUAL_STEP_ENTITY,
      taskVisualStepId(run.taskId, sequence),
    );
  }
}

function measureTaskSessionFrame(screen: ReturnType<typeof render>): void {
  fireEvent(screen.getByTestId('task-session-frame'), 'layout', {
    nativeEvent: { layout: { width: 300 } },
  });
}

describe('Release 107 task session playback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    registerSlot(SLOTS.taskToolDetail, TaskChatCard);
    useAccordionStore.setState({ expanded: {} });
    useChatStore.getState().clearAllConversations();
    useSyncStore.getState().setConnectedDeviceIds([origin.originDeviceId]);
  });

  afterEach(() => {
    for (const kind of ['web_use', 'computer_use'] as const) {
      for (const status of ['running', 'done', 'stopped'] as const) {
        removeSyncedTask(taskRun(kind, status));
      }
    }
    _clearSlotsForTesting();
    jest.useRealTimers();
  });

  it('keeps saved task frames in required state sync', () => {
    expect(isRequiredSyncEntity(TASK_VISUAL_STEP_ENTITY)).toBe(true);
  });

  it.each([
    ['web_use', 'done'],
    ['computer_use', 'stopped'],
  ] as const)(
    'plays and scrubs the preserved %s session after it is %s',
    (kind, status) => {
      const screen = renderSyncedTask(taskRun(kind, status));

      expect(screen.queryByTestId('task-chat-card')).toBeNull();
      expect(screen.queryByText('Raw task plan must stay hidden.')).toBeNull();
      fireEvent.press(
        screen.getByTestId(`tool-result-accordion-${taskToolName(kind)}`),
      );
      expect(screen.getByTestId('task-session-playback')).toBeTruthy();
      expect(screen.getByText('Step 1 of 2 · 0:00 / 0:03')).toBeTruthy();
      expect(screen.getByText('Opened the target')).toBeTruthy();
      expect(screen.queryByTestId('task-control-stop')).toBeNull();
      expect(screen.queryByText('The task screen is syncing.')).toBeNull();

      fireEvent(
        screen.getByTestId('task-session-frame'),
        'layout',
        { nativeEvent: { layout: { width: 300 } } },
      );
      expect(screen.getByLabelText('Saved task screen 1 of 2')).toBeTruthy();
      expect(screen.queryByTestId('task-live-frame')).toBeNull();

      fireEvent(
        screen.getByTestId('task-session-scrubber'),
        'valueChange',
        1,
      );
      expect(screen.getByText('Step 2 of 2 · 0:03 / 0:03')).toBeTruthy();
      expect(screen.getByText('Selected Continue')).toBeTruthy();
      expect(screen.getByTestId('task-session-cursor')).toBeTruthy();

      fireEvent.press(screen.getByTestId('task-session-toggle'));
      expect(screen.getByText('Pause')).toBeTruthy();
      act(() => jest.advanceTimersByTime(1_199));
      expect(screen.getByText('Step 1 of 2 · 0:00 / 0:03')).toBeTruthy();
      act(() => jest.advanceTimersByTime(1));
      expect(screen.getByText('Step 2 of 2 · 0:03 / 0:03')).toBeTruthy();
      expect(screen.getByText('Play')).toBeTruthy();

      fireEvent.press(
        screen.getByTestId(`tool-result-accordion-${taskToolName(kind)}`),
      );
      expect(screen.queryByTestId('task-session-playback')).toBeNull();
    },
  );

  it('opens a replay with a visible close action and returns to the chat', () => {
    const screen = renderSyncedTask(taskRun('computer_use', 'done'));

    fireEvent.press(
      screen.getByTestId('tool-result-accordion-computer_use'),
    );
    fireEvent.press(screen.getByTestId('task-session-open-fullscreen'));

    expect(screen.getByText('Done')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Close full screen'));
    expect(screen.queryByTestId('task-session-fullscreen')).toBeNull();
    expect(screen.getByTestId('task-session-playback')).toBeTruthy();
  });

  it.each(['web_use', 'computer_use'] as const)(
    'keeps the live %s frame while saved steps remain reviewable',
    kind => {
      const screen = renderSyncedTask(taskRun(kind, 'running'));

      expect(screen.queryByTestId('task-live-frame')).toBeNull();
      fireEvent.press(
        screen.getByTestId(`tool-result-accordion-${taskToolName(kind)}`),
      );
      expect(screen.getByTestId('task-session-playback')).toBeTruthy();
      expect(screen.getByText('LIVE VIEW')).toBeTruthy();
      expect(screen.getByTestId('task-session-frame')).toBeTruthy();
      measureTaskSessionFrame(screen);
      expect(screen.getByLabelText('Live view from Studio Mac')).toBeTruthy();
      expect(screen.queryByTestId('task-live-frame')).toBeNull();
      expect(screen.getByTestId('task-control-stop')).toBeTruthy();
    },
  );

  it('shows the live Computer Use session from the active tool call', () => {
    const run = taskRun('computer_use', 'running');
    const olderRun = {
      ...taskRun('computer_use', 'stopped'),
      conversationId: run.conversationId,
    };
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
      olderRun.taskId,
      olderRun as unknown as Record<string, unknown>,
      origin,
    );
    materializer.put(
      TASK_RUN_ENTITY,
      run.taskId,
      run as unknown as Record<string, unknown>,
      origin,
    );

    const screen = render(
      <ChatMessage
        message={{
          id: `call-${run.taskId}`,
          role: 'assistant',
          timestamp: run.updatedAt,
          content: '',
          toolCalls: [{
            id: run.launchId,
            name: 'computer_use',
            arguments: JSON.stringify({ goal: run.title }),
          }],
        }}
        showActions={false}
      />,
    );

    expect(screen.getByText('Using computer_use: Review the desktop app')).toBeTruthy();
    expect(screen.queryByTestId('task-chat-card')).toBeNull();
    fireEvent.press(screen.getByTestId('tool-result-accordion-computer_use'));
    expect(screen.getByTestId('task-chat-card')).toBeTruthy();
    expect(screen.getByText('LIVE VIEW')).toBeTruthy();
    measureTaskSessionFrame(screen);
    expect(screen.getByLabelText('Live view from Studio Mac')).toBeTruthy();
    expect(screen.getByTestId('task-control-stop')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tool-result-accordion-computer_use'));
    expect(screen.queryByTestId('task-chat-card')).toBeNull();
    fireEvent.press(screen.getByTestId('tool-result-accordion-computer_use'));

    act(() => {
      materializer.put(
        TASK_RUN_ENTITY,
        run.taskId,
        {
          ...run,
          status: 'done',
          phase: 'complete',
          finishedAt: run.updatedAt + 1,
          updatedAt: run.updatedAt + 1,
        },
        origin,
      );
    });
    expect(screen.queryByTestId('task-chat-card')).toBeNull();
  });

  it.each(['web_use', 'computer_use'] as const)(
    'uses saved %s evidence while an active live frame is unavailable',
    kind => {
      const { frame: _liveFrame, ...run } = taskRun(kind, 'running');
      const screen = renderSyncedTask(run);

      fireEvent.press(
        screen.getByTestId(`tool-result-accordion-${taskToolName(kind)}`),
      );
      expect(screen.queryByText('The task screen is syncing.')).toBeNull();
      expect(screen.getByTestId('task-session-frame')).toBeTruthy();
      measureTaskSessionFrame(screen);
      expect(screen.getByLabelText('Live view from Studio Mac')).toBeTruthy();
      expect(screen.queryByTestId('task-live-frame')).toBeNull();
    },
  );

  it('replaces the sync placeholder as soon as saved evidence materializes', () => {
    const { frame: _liveFrame, ...run } = taskRun('web_use', 'running');
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
    const screen = render(
      <ChatMessage
        message={{
          id: `result-${run.taskId}`,
          role: 'tool',
          timestamp: run.updatedAt,
          toolName: 'web_use',
          toolCallId: `call-${run.taskId}`,
          content: `Task started. Task reference: ${run.taskId}.`,
        }}
        showActions={false}
      />,
    );

    fireEvent.press(screen.getByTestId('tool-result-accordion-web_use'));
    expect(screen.getByText('The task screen is syncing.')).toBeTruthy();
    expect(screen.getByTestId('task-frame-loading')).toBeTruthy();

    const step = visualStep(run, 1);
    act(() => {
      materializer.put(
        TASK_VISUAL_STEP_ENTITY,
        step.visualStepId,
        step as unknown as Record<string, unknown>,
        origin,
      );
    });
    expect(screen.queryByText('The task screen is syncing.')).toBeNull();
    expect(screen.queryByTestId('task-frame-loading')).toBeNull();
    expect(screen.getByTestId('task-session-playback')).toBeTruthy();
    expect(screen.getByTestId('task-session-frame')).toBeTruthy();
    measureTaskSessionFrame(screen);
    expect(screen.getByLabelText('Live view from Studio Mac')).toBeTruthy();
    expect(screen.queryByTestId('task-live-frame')).toBeNull();
  });

  it('shows an active task inside its synced live-tool accordion', () => {
    const run = taskRun('web_use', 'running');
    renderSyncedTask(run).unmount();
    const screen = render(
      <ChatMessage
        message={{
          id: `preview-${run.taskId}`,
          role: 'assistant',
          timestamp: run.updatedAt,
          content: '',
          toolArtifacts: [
            {
              id: `call-${run.taskId}`,
              name: 'web_use',
              result: '',
              status: 'running',
            },
          ],
        }}
        showActions={false}
      />,
    );

    expect(screen.queryByTestId('task-chat-card')).toBeNull();
    expect(screen.getByText('Using Web Use...')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tool-result-accordion-web_use'));
    expect(screen.getByTestId('task-session-frame')).toBeTruthy();
    measureTaskSessionFrame(screen);
    expect(screen.getByLabelText('Live view from Studio Mac')).toBeTruthy();
    expect(screen.queryByTestId('task-live-frame')).toBeNull();
    expect(screen.getByTestId('task-control-stop')).toBeTruthy();
  });
});
