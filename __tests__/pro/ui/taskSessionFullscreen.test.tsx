import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { SyncedTaskRun, SyncedTaskVisualStep } from '@offgrid/sync';
import { TaskSessionPlayback } from '../../../pro/ui/task-card/TaskSessionPlayback';

jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) =>
    require('react').createElement(require('react-native').View, props),
}));

const frame = {
  sequence: 2,
  mimeType: 'image/jpeg' as const,
  payloadBase64: '/9j/2Q==',
  width: 300,
  height: 200,
  capturedAt: 2_000,
};

function run(status: SyncedTaskRun['status']): SyncedTaskRun {
  return {
    version: 1,
    launchId: 'launch-fullscreen',
    requestingDeviceId: 'phone-1',
    taskId: 'task-fullscreen',
    conversationId: 'chat-fullscreen',
    kind: 'computer_use',
    executionDevice: { id: 'desktop-1', name: 'Studio Mac' },
    title: 'Review the desktop app',
    status,
    phase: status === 'running' ? 'acting' : 'complete',
    currentStep: 2,
    progress: [],
    frame: status === 'running' ? frame : undefined,
    cursor: status === 'running' ? { x: 150, y: 100 } : undefined,
    startedAt: 1_000,
    updatedAt: 2_000,
    finishedAt: status === 'running' ? undefined : 2_000,
  };
}

const steps: SyncedTaskVisualStep[] = [
  {
    version: 1,
    visualStepId: 'task-fullscreen:1',
    taskId: 'task-fullscreen',
    conversationId: 'chat-fullscreen',
    sequence: 1,
    executionDevice: { id: 'desktop-1', name: 'Studio Mac' },
    actionLabel: 'Opened the app',
    frame: { ...frame, sequence: 1, capturedAt: 1_000 },
  },
  {
    version: 1,
    visualStepId: 'task-fullscreen:2',
    taskId: 'task-fullscreen',
    conversationId: 'chat-fullscreen',
    sequence: 2,
    executionDevice: { id: 'desktop-1', name: 'Studio Mac' },
    actionLabel: 'Selected Continue',
    frame,
    cursor: { x: 150, y: 100 },
  },
];

describe('TaskSessionPlayback full screen', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens the current live frame and cursor, then returns to the card', () => {
    const screen = render(
      <TaskSessionPlayback run={run('running')} steps={steps} />,
    );

    fireEvent(screen.getByTestId('task-session-frame'), 'layout', {
      nativeEvent: { layout: { width: 300, height: 200 } },
    });
    expect(screen.getByTestId('task-session-cursor')).toBeTruthy();

    fireEvent.press(screen.getByTestId('task-session-open-fullscreen'));
    expect(screen.getByTestId('task-session-fullscreen')).toBeTruthy();
    expect(screen.queryByTestId('task-session-frame')).toBeNull();
    fireEvent(screen.getByTestId('task-session-fullscreen-frame'), 'layout', {
      nativeEvent: { layout: { width: 390, height: 700 } },
    });
    expect(screen.getByLabelText('Live view from Studio Mac')).toBeTruthy();
    expect(screen.getByTestId('task-session-fullscreen-cursor')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Close full screen'));
    expect(screen.queryByTestId('task-session-fullscreen')).toBeNull();
    expect(screen.getByTestId('task-session-frame')).toBeTruthy();
  });

  it('keeps replay position and play state across the full-screen transition', () => {
    const screen = render(
      <TaskSessionPlayback run={run('done')} steps={steps} />,
    );

    fireEvent(screen.getByTestId('task-session-scrubber'), 'valueChange', 1);
    expect(screen.getByText('Step 2 of 2 · 0:01 / 0:01')).toBeTruthy();
    expect(screen.getByText('Selected Continue')).toBeTruthy();

    fireEvent.press(screen.getByTestId('task-session-open-fullscreen'));
    expect(screen.getByText('Step 2 of 2 · 0:01 / 0:01')).toBeTruthy();
    expect(screen.getByText('Selected Continue')).toBeTruthy();
    expect(screen.getByText('Play')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close full screen' })).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();

    fireEvent.press(screen.getByTestId('task-session-fullscreen-toggle'));
    expect(screen.getByText('Step 1 of 2 · 0:00 / 0:01')).toBeTruthy();
    expect(screen.getByText('Pause')).toBeTruthy();

    fireEvent.press(screen.getByTestId('task-session-close-fullscreen'));
    expect(screen.getByText('Step 1 of 2 · 0:00 / 0:01')).toBeTruthy();
    expect(screen.getByText('Pause')).toBeTruthy();

    act(() => screen.unmount());
  });

  it('turns a legacy raw action into readable replay copy', () => {
    const rawSteps = [
      steps[0]!,
      { ...steps[1]!, actionLabel: '{"action":"click","index":5}' },
    ];
    const screen = render(
      <TaskSessionPlayback run={run('done')} steps={rawSteps} />,
    );

    fireEvent(screen.getByTestId('task-session-scrubber'), 'valueChange', 1);

    expect(screen.getByText('Clicked control 5')).toBeTruthy();
    expect(screen.queryByText('{"action":"click","index":5}')).toBeNull();
  });
});
