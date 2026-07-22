/** P1 — free and Pro tools stay separated in the real App tool journey. */
import { Switch } from 'react-native';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';
import { installPro } from '../../harness/proHarness';

const TOOL_MODEL: DownloadedModel = {
  id: 'test/llama-3-pro-tools/llama-3-pro-tools-Q4_K_M.gguf',
  name: 'Llama 3 Pro Tools',
  author: 'test',
  fileName: 'llama-3-pro-tools-Q4_K_M.gguf',
  filePath: '/docs/models/llama-3-pro-tools-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-20T00:00:00.000Z',
  engine: 'llama',
};

const PRO_TOOLS = [
  { id: 'send_email', label: 'Send Email' },
  { id: 'create_calendar_event', label: 'Create Calendar Event' },
  { id: 'read_calendar_events', label: 'Read Calendar Events' },
] as const;

describe('full-App free and Pro tool split', () => {
  it('keeps Pro tools out of the free picker and exposes each real Pro tool once on its destination', async () => {
    jest.unmock('@react-navigation/native');
    const app = await renderMainApp({
      boundary: { llama: true },
      downloadedModels: [TOOL_MODEL],
      beforeRender: async ({ boundary, asyncStorage }) => {
        await asyncStorage.removeItem('mcp_servers_v1');
        await installPro();
        boundary.fs!.seedFile(
          `${boundary.fs!.DocumentDirectoryPath}/all-MiniLM-L6-v2-Q8_0.gguf`,
          25 * 1024 * 1024,
        );
      },
    });

    await openChatWithJourneyModel(app.rtl, app.view);
    app.rtl.fireEvent.press(app.view.getByTestId('quick-settings-button'));
    const tools = await app.rtl.waitFor(() =>
      app.view.getByTestId('quick-tools'),
    );
    await app.rtl.waitFor(
      () => expect(app.rtl.within(tools).queryByText('N/A')).toBeNull(),
      { timeout: 8000 },
    );
    app.rtl.fireEvent.press(tools);

    await app.rtl.waitFor(() =>
      expect(app.view.getByTestId('tool-picker-row-calculator')).toBeTruthy(),
    );
    for (const tool of PRO_TOOLS) {
      expect(app.view.queryByText(tool.label)).toBeNull();
    }

    app.rtl.fireEvent.press(app.view.getByTestId('tools-pro-tools'));
    await app.rtl.waitFor(() =>
      expect(app.view.getByText('Pro tools')).toBeTruthy(),
    );

    for (const tool of PRO_TOOLS) {
      expect(app.view.getAllByText(tool.label)).toHaveLength(1);
      expect(app.view.getByTestId(`pro-tool-row-${tool.id}`)).toBeTruthy();
    }
    expect(app.view.getByText('MCP servers')).toBeTruthy();
    expect(app.view.getByText('No servers configured')).toBeTruthy();

    const emailRow = app.view.getByTestId('pro-tool-row-send_email');
    const emailToggle = () => app.rtl.within(emailRow).UNSAFE_getByType(Switch);
    expect(emailToggle().props.value).toBe(false);
    app.rtl.fireEvent(emailToggle(), 'valueChange', true);
    await app.rtl.waitFor(() => expect(emailToggle().props.value).toBe(true));

    app.view.unmount();
  }, 30000);
});
