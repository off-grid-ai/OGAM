/**
 * Report a problem sends a debug log with no chat content (docs/ANALYTICS.md, Report a problem).
 *
 * SPEC (OGAM user's view): after chatting, Settings → Report a problem shows the debug log, and
 * "Send to support" hands it to the share sheet. Neither the log the person sees nor what is shared
 * holds their prompt or the model's reply. It works with analytics off.
 *
 * The real App runs as a store build: the debug log is on in every build, so this is the log a
 * person actually sends. The share sheet is the OS boundary: it is replaced by a recorder of what
 * the app handed it.
 */
import {
  launchApp,
  openNewChat,
  openSettings,
  passOnboarding,
  restoreBuildFlavor,
  sendMessage,
  type AnalyticsApp,
} from '../../harness/analyticsApp';

jest.unmock('@react-navigation/native');

const PROMPT = 'my passport number is in the drawer by the window';
const REPLY = 'Keep the passport drawer locked when guests visit.';

let app: AnalyticsApp | undefined;

afterEach(async () => {
  await require('../../../src/services/generationService').generationService.stopGeneration();
  app?.view.unmount();
  // Let the client's last flush land on the fake endpoint before the endpoint goes away.
  await new Promise(resolve => setTimeout(resolve, 50));
  app?.endpoint.restore();
  app = undefined;
  restoreBuildFlavor();
});

it('the shared debug log holds the chat trace but none of the prompt or reply', async () => {
  app = await launchApp({ release: true });
  const shared: Array<{ message?: string; url?: string }> = [];
  require('react-native').Share.share = async (content: { message?: string; url?: string }) => {
    shared.push(content);
    return { action: 'sharedAction' };
  };
  const { view, rtl } = app;
  await passOnboarding(app, false);
  await openNewChat(app);
  await sendMessage(app, PROMPT, REPLY);

  await openSettings(app);
  rtl.fireEvent.press(view.getByTestId('settings-report-problem'));
  const send = await view.findByTestId('debug-logs-send-report');
  // The person sees the log first, and it is not empty.
  expect(view.queryByText('No logs yet')).toBeNull();
  expect(view.queryByText(/passport/)).toBeNull();

  expect(shared).toHaveLength(0);
  rtl.fireEvent.press(send);
  await rtl.waitFor(() => expect(shared).toHaveLength(1));

  const message = shared[0].message ?? '';
  expect(message).toContain('support@getoffgridai.co');
  // The trace of the chat is there: the generation ran and was logged.
  expect(message).toMatch(/\[(GEN|LLM|ToolLoop|GenService)/);
  expect(message).not.toMatch(/passport|drawer|window|guests/i);
});

it('on iOS the log goes as an attached file, and closing the viewer sends nothing', async () => {
  app = await launchApp({ release: true, platform: 'ios' });
  const shared: Array<{ message?: string; url?: string }> = [];
  require('react-native').Share.share = async (content: { message?: string; url?: string }) => {
    shared.push(content);
    return { action: 'sharedAction' };
  };
  const { view, rtl } = app;
  await passOnboarding(app, false);
  await openSettings(app);
  rtl.fireEvent.press(view.getByTestId('settings-report-problem'));
  rtl.fireEvent.press(await view.findByTestId('debug-logs-close'));
  await rtl.waitFor(() => expect(view.queryByTestId('debug-logs-send-report')).toBeNull());
  expect(shared).toHaveLength(0);

  rtl.fireEvent.press(view.getByTestId('settings-report-problem'));
  rtl.fireEvent.press(await view.findByTestId('debug-logs-send-report'));
  await rtl.waitFor(() => expect(shared).toHaveLength(1));
  expect(shared[0].url).toMatch(/^file:\/\/.*offgrid-debug\.log$/);
  expect(shared[0].message).toContain('support@getoffgridai.co');
  expect(shared[0].message).not.toContain('---');
});

it('an unreadable log still opens the share sheet with the support address', async () => {
  app = await launchApp({ release: true });
  const shared: Array<{ message?: string; url?: string }> = [];
  require('react-native').Share.share = async (content: { message?: string; url?: string }) => {
    shared.push(content);
    throw new Error('share sheet dismissed');
  };
  const fs = require('react-native-fs');
  fs.readFile = async () => {
    throw new Error('EACCES');
  };
  const { view, rtl } = app;
  await passOnboarding(app, false);
  await openSettings(app);
  rtl.fireEvent.press(view.getByTestId('settings-report-problem'));
  rtl.fireEvent.press(await view.findByTestId('debug-logs-send-report'));
  await rtl.waitFor(() => expect(shared).toHaveLength(1));
  expect(shared[0].url).toBeUndefined();
  expect(shared[0].message).toContain('support@getoffgridai.co');
});

it('with no log on disk yet, the share sheet still gets the support address', async () => {
  app = await launchApp({ release: true });
  const shared: Array<{ message?: string; url?: string }> = [];
  require('react-native').Share.share = async (content: { message?: string; url?: string }) => {
    shared.push(content);
    return { action: 'sharedAction' };
  };
  require('react-native-fs').exists = async () => false;
  const { view, rtl } = app;
  await passOnboarding(app, false);
  await openSettings(app);
  rtl.fireEvent.press(view.getByTestId('settings-report-problem'));
  rtl.fireEvent.press(await view.findByTestId('debug-logs-send-report'));
  await rtl.waitFor(() => expect(shared).toHaveLength(1));
  expect(shared[0].message).toContain('support@getoffgridai.co');
  expect(shared[0].message).not.toContain('---');
});
