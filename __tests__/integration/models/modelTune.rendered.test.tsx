/**
 * "Find the best settings" on a model's test page: it loads the model a few ways, times a short reply each way,
 * shows every result and keeps the fastest. Fakes only the device boundary (llama.rn text engine, files, RAM).
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { modelId: 'llm' } }),
}));

it('tries each option, lists the speeds and applies the fastest', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../../src/stores');
  const { hardwareService } = require('../../../src/services/hardware');
  const { ModelTestScreen } = require('../../../src/screens/ModelTestScreen');
  const { useTuned } = require('../../../src/atlasTools/speed');

  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu', nThreads: 7, backendUserChosen: false });
  boundary.llama!.scriptCompletion({ text: 'Rivers run to the sea and carry water across the land.' });

  // The fake model answers instantly, which a phone never does (speed = tokens / time, and no time reads as no speed).
  // The clock is the device boundary here: every reading moves it on by 5 ms, so each reply takes a measurable time.
  let clock = 1_700_000_000_000;
  const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 5));

  const screen = rtl.render(React.createElement(ModelTestScreen));
  rtl.fireEvent.press(screen.getByTestId('model-tune-start'));
  const result = await screen.findByTestId('model-tune-result', {}, { timeout: 20000 });
  expect(result).toBeTruthy();
  // Every option has a line, whether it measured or not.
  expect(screen.getAllByText(/tok\/s|failed/).length).toBeGreaterThanOrEqual(3);
  const settings = useAppStore.getState().settings;
  expect(String(result.props.children)).toMatch(/^Using .* tok\/s\)/);
  // The winner is kept as the person's choice, and the tuned model stops getting the slow-reply tip.
  expect(settings.backendUserChosen).toBe(true);
  expect(settings.nThreads).not.toBe(7);
  expect(useTuned.getState().at.llm).toBeGreaterThan(0);
  now.mockRestore();
}, 40000);

it('suggests finding faster settings when replies are slow, opens the test, and can be dismissed', () => {
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../../src/stores');
  const { useSpeedStats, useTuned, useSlowHint } = require('../../../src/atlasTools/speed');
  const { SlowReplyHint } = require('../../../src/components/SlowReplyHint');

  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama' })], activeModelId: 'llm' });
  useTuned.setState({ at: {} });
  useSlowHint.setState({ off: {} });
  useSpeedStats.setState({ byModel: { llm: { decode: 2.1, prefill: 0, outLen: 100, samples: 3 } } });
  const hint = rtl.render(React.createElement(SlowReplyHint));
  expect(hint.getByText(/Replies are slow here \(2\.1 tok\/s\)/)).toBeTruthy();
  rtl.fireEvent.press(hint.getByLabelText('Find faster settings for this model'));
  expect(mockNavigate).toHaveBeenCalledWith('ModelTest', { modelId: 'llm' });
  rtl.fireEvent.press(hint.getByTestId('slow-reply-hint-dismiss'));
  expect(hint.queryByTestId('slow-reply-hint')).toBeNull();
});

it('says why replies are slow when the threads are set too high, and fixes it with one tap', async () => {
  const rtl = requireRTL();
  const React = require('react');
  const { useAppStore } = require('../../../src/stores');
  const { useSpeedStats, useTuned, useSlowHint } = require('../../../src/atlasTools/speed');
  const { SlowReplyHint } = require('../../../src/components/SlowReplyHint');

  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama' })], activeModelId: 'llm' });
  useAppStore.getState().updateSettings({ nThreads: 8 });
  useTuned.setState({ at: {} });
  useSlowHint.setState({ off: {} });
  useSpeedStats.setState({ byModel: { llm: { decode: 2.1, prefill: 0, outLen: 100, samples: 3 } } });
  const hint = rtl.render(React.createElement(SlowReplyHint));
  expect(await hint.findByText(/8 threads but only 4 cores are fast/)).toBeTruthy();
  rtl.fireEvent.press(hint.getByTestId('slow-reply-hint-fix'));
  expect(useAppStore.getState().settings.nThreads).toBe(0);
});
