/**
 * Scheduled tasks: make a task on the screen, run what is due, and the AI's answer waits as a chat with a row on Home.
 * Fakes only the device boundary (llama.rn engine, files, RAM).
 */
import { installNativeBoundary, GB, requireRTL } from '../harness/nativeBoundary';
import { createDownloadedModel } from '../utils/factories';

const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
}));

it('creates a task, runs it when due, and shows the answer on Home until it is read', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore, useChatStore } = require('../../src/stores');
  const { hardwareService } = require('../../src/services/hardware');
  const { ScheduleScreen } = require('../../src/schedule/ScheduleScreen');
  const { useSchedule } = require('../../src/schedule/store');
  const { runDueTasks } = require('../../src/schedule/runner');
  const { ContinueCard } = require('../../src/screens/HomeScreen/components/ContinueCard');

  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
  useSchedule.setState({ tasks: [] });

  const screen = rtl.render(React.createElement(ScheduleScreen));
  rtl.fireEvent.press(screen.getByTestId('task-new'));
  rtl.fireEvent.changeText(screen.getByTestId('task-name'), 'Word of the day');
  rtl.fireEvent.changeText(screen.getByTestId('task-prompt'), 'Give me one interesting word.');
  rtl.fireEvent.press(screen.getByTestId('task-save'));
  expect(useSchedule.getState().tasks).toHaveLength(1);
  expect(screen.getByText(/Every day at 08:00/)).toBeTruthy();

  // It is not due before it was made; a day later it is.
  boundary.llama!.scriptCompletion({ text: 'Petrichor: the smell of rain on dry earth.' });
  await runDueTasks(Date.now());
  expect(useSchedule.getState().tasks[0].lastChatId).toBeUndefined();
  await runDueTasks(Date.now() + 25 * 3600e3);
  const task = useSchedule.getState().tasks[0];
  expect(task.lastChatId).toBeTruthy();
  expect(task.lastError).toBeUndefined();
  const chat = useChatStore.getState().conversations.find((c: any) => c.id === task.lastChatId);
  expect(chat.messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
  expect(chat.messages[1].content).toContain('Petrichor');

  // Home says it is ready, and reading it clears the row.
  const home = rtl.render(React.createElement(ContinueCard, { navigation: mockNav }));
  rtl.fireEvent.press(home.getByTestId(`home-scheduled-${task.id}`));
  expect(mockNav.navigate).toHaveBeenCalledWith('Chat', { conversationId: task.lastChatId });
  expect(useSchedule.getState().tasks[0].resultSeen).toBe(true);
}, 40000);

it('keeps a failed run to try again later, with the reason on the task', async () => {
  installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const { useAppStore } = require('../../src/stores');
  const { useSchedule } = require('../../src/schedule/store');
  const { runDueTasks } = require('../../src/schedule/runner');
  useAppStore.setState({ downloadedModels: [], activeModelId: null });
  useSchedule.setState({ tasks: [] });
  const id = useSchedule.getState().add({ name: 'x', kind: 'prompt', prompt: 'hello', repeat: 'daily', hour: 8, minute: 0 });
  const now = Date.now() + 25 * 3600e3;
  await runDueTasks(now);
  const task = useSchedule.getState().tasks.find((t: any) => t.id === id);
  expect(task.lastError).toMatch(/model/i);
  expect(task.lastRunAt).toBeUndefined();
  // Not retried straight away, but after a while.
  const tried = task.lastTriedAt;
  await runDueTasks(now + 60_000);
  expect(useSchedule.getState().tasks[0].lastTriedAt).toBe(tried);
}, 40000);
