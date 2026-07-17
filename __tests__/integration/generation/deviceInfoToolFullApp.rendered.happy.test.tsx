/** P2 #125 — Device Info executes against the native device boundary in a full-App chat. */
import { Switch, Text } from 'react-native';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const PROMPT = 'How much memory does this device have available?';
const ANSWER = 'This device has 6.0 GB of available memory.';
const TOOL_MODEL: DownloadedModel = {
  id: 'test/llama-3-device-info/llama-3-device-info-Q4_K_M.gguf',
  name: 'Llama 3 Device Info',
  author: 'test',
  fileName: 'llama-3-device-info-Q4_K_M.gguf',
  filePath: '/docs/models/llama-3-device-info-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (value && typeof value === 'object' && 'props' in value) {
    return textContent(
      (value as { props?: { children?: unknown } }).props?.children,
    );
  }
  return '';
}

describe('P2 full-App Device Info tool journey', () => {
  it('renders truthful native memory details before one clean final answer', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: {
          platform: 'android',
          totalBytes: 10 * GB,
          availBytes: 6 * GB,
        },
      },
      downloadedModels: [TOOL_MODEL],
    });
    await openChatWithJourneyModel(rtl, view);

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    const tools = await rtl.waitFor(() => view.getByTestId('quick-tools'));
    await rtl.waitFor(
      () => expect(rtl.within(tools).queryByText('N/A')).toBeNull(),
      { timeout: 8000 },
    );
    rtl.fireEvent.press(tools);
    const deviceInfo = await rtl.waitFor(() =>
      view.getByTestId('tool-picker-row-get_device_info'),
    );
    const deviceInfoToggle = rtl.within(deviceInfo).UNSAFE_getByType(Switch);
    expect(deviceInfoToggle.props.value).toBe(false);
    rtl.fireEvent(deviceInfoToggle, 'valueChange', true);
    await rtl.waitFor(() =>
      expect(rtl.within(deviceInfo).UNSAFE_getByType(Switch).props.value).toBe(
        true,
      ),
    );
    rtl.fireEvent.press(view.getByTestId('tools-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    boundary.llama!.scriptCompletions([
      {
        toolCalls: [
          {
            name: 'get_device_info',
            arguments: { info_type: 'memory' },
          },
        ],
      },
      { text: ANSWER },
    ]);
    sendChatMessage(rtl, view, PROMPT);

    await rtl.waitFor(
      () => {
        const toolResults = view.getAllByTestId(
          'tool-result-label-get_device_info',
        );
        expect(toolResults).toHaveLength(1);
        expect(toolResults[0]).toHaveTextContent(/Retrieved device info/);
        expect(view.getAllByText(ANSWER)).toHaveLength(1);
        expect(view.queryByText(/<tool_call>|tool_calls/)).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('send-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('tool-result-label-get_device_info'));
    await rtl.waitFor(() => {
      expect(view.getByText('Total: 10.0 GB')).toBeTruthy();
      expect(view.getByText('Used: 4.0 GB')).toBeTruthy();
      expect(view.getByText('Available: 6.0 GB')).toBeTruthy();
    });

    const renderedText = rtl
      .within(view.getByTestId('chat-screen'))
      .UNSAFE_getAllByType(Text)
      .map(node => textContent(node.props.children));
    const toolResultIndex = renderedText.findIndex(text =>
      text.includes('Available: 6.0 GB'),
    );
    const answerIndex = renderedText.findIndex(text => text === ANSWER);
    expect(toolResultIndex).toBeGreaterThanOrEqual(0);
    expect(answerIndex).toBeGreaterThan(toolResultIndex);

    view.unmount();
  }, 30000);
});
