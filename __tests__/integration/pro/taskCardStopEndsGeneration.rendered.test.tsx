import type { SyncedTaskRun } from '@offgrid/sync';
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

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

describe('Desktop task card Stop', () => {
  let stopSync: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stopSync?.();
    stopSync = undefined;
  });

  it('ends the Mobile generation that is waiting for the Desktop task', async () => {
    const h = await setupChatScreen({ engine: 'litert', pro: true });
    const { syncService } = require('../../../pro/sync/syncService');
    const { chatStreamService } = require('../../../pro/sync/chatStreamService');
    stopSync = async () => {
      await chatStreamService.stop();
      await syncService.stop();
    };
    const { TASK_RUN_ENTITY } = require('@offgrid/sync');
    const {
      MobileStateMaterializer,
    } = require('../../../pro/sync/mobileStateMaterializer');
    const { TaskChatCard } = require('../../../pro/ui/TaskChatCard');
    h.render();
    h.boundary.litert.scriptPartialThenHang('Waiting for the Desktop task');
    await h.tapSend('Use my Mac');
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Waiting for the Desktop task/)).not.toBeNull();
      expect(h.view!.queryByTestId('stop-button')).not.toBeNull();
    });

    const conversationId = h.conversationId!;
    const run: SyncedTaskRun = {
      version: 1,
      launchId: 'launch-task-card-stop',
      requestingDeviceId: 'mobile-task-card-stop',
      taskId: 'task-card-stop',
      conversationId,
      kind: 'computer_use',
      executionDevice: { id: 'desktop-task-card-stop', name: 'Office Mac' },
      title: 'Use my Mac',
      status: 'running',
      phase: 'acting',
      currentAction: 'Working on the task',
      progress: [],
      startedAt: 10,
      updatedAt: 20,
    };
    const materializer = new MobileStateMaterializer();
    materializer.put(
      TASK_RUN_ENTITY,
      run.taskId,
      run as unknown as Record<string, unknown>,
      {
        originDeviceId: run.executionDevice.id,
        originDeviceName: run.executionDevice.name,
      },
    );
    const taskCard = h.rtl.render(
      h.React.createElement(TaskChatCard, {
        message: {
          toolName: 'computer_use',
          toolCallId: 'call-task-card-stop',
          content: `Task started. Task reference: ${run.taskId}.`,
        },
      }),
    );

    h.rtl.fireEvent.press(taskCard.getByTestId('task-control-stop'));

    await h.rtl.waitFor(() => {
      expect(h.boundary.litert.module.stopGeneration).toHaveBeenCalled();
      expect(h.view!.queryByTestId('stop-button')).toBeNull();
    });
    expect(h.view!.queryByText(/Waiting for the Desktop task/)).not.toBeNull();

    materializer.remove(TASK_RUN_ENTITY, run.taskId);
  });
});
