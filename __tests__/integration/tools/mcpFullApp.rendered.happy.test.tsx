/** P1 #133-135 — add, connect, list, enable, and execute MCP through the real App. */
import Icon from 'react-native-vector-icons/Feather';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { installPro } from '../../harness/proHarness';

const SERVER_NAME = 'Weather Lab';
const SERVER_URL = 'https://weather.example.test/mcp';
const TOOL_NAME = 'lookup_weather';
const TOOL_RESULT = 'Weather station reports 21 C and clear skies.';
const FINAL_ANSWER = 'It is 21 C with clear skies.';
const TOOL_MODEL: DownloadedModel = {
  id: 'test/llama-3-mcp/llama-3-mcp-Q4_K_M.gguf',
  name: 'Llama 3 MCP',
  author: 'test',
  fileName: 'llama-3-mcp-Q4_K_M.gguf',
  filePath: '/docs/models/llama-3-mcp-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

function installMcpTransportBoundary(): void {
  class McpXHR {
    status = 200;
    responseText = '';
    timeout = 0;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;

    open(): void {}
    setRequestHeader(): void {}
    getResponseHeader(name: string): string | null {
      return name.toLowerCase() === 'content-type'
        ? 'application/json'
        : null;
    }
    send(payload: string): void {
      const request = JSON.parse(payload) as {
        id: number;
        method: string;
      };
      let result: Record<string, unknown> = {};
      if (request.method === 'tools/list') {
        result = {
          tools: [
            {
              name: TOOL_NAME,
              description: 'Look up current weather for a city.',
              inputSchema: {
                type: 'object',
                properties: { city: { type: 'string' } },
                required: ['city'],
              },
            },
          ],
        };
      } else if (request.method === 'tools/call') {
        result = {
          content: [{ type: 'text', text: TOOL_RESULT }],
        };
      }
      this.responseText = JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result,
      });
      setTimeout(() => this.onload?.(), 0);
    }
  }
  (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = McpXHR;
}

function pressBackIcon(
  app: Awaited<ReturnType<typeof renderMainApp>>,
): void {
  const back = app.view
    .UNSAFE_getAllByType(Icon)
    .find(icon => icon.props.name === 'arrow-left');
  if (!back) throw new Error('Back control not found');
  app.rtl.fireEvent.press(back.parent!);
}

describe('P1 full-App MCP server and tool journey', () => {
  it('adds and connects a server, lists its tool, and renders the executed result', async () => {
    installMcpTransportBoundary();
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
    const quickTools = await app.rtl.waitFor(() =>
      app.view.getByTestId('quick-tools'),
    );
    await app.rtl.waitFor(() =>
      expect(app.rtl.within(quickTools).queryByText('N/A')).toBeNull(),
    );
    app.rtl.fireEvent.press(quickTools);
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByTestId('tools-pro-tools')),
    );
    await app.rtl.waitFor(() =>
      expect(app.view.getByText('No servers configured')).toBeTruthy(),
    );

    app.rtl.fireEvent.press(app.view.getByText('Add Server'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByTestId('add-custom-server')),
    );
    app.rtl.fireEvent.changeText(
      await app.rtl.waitFor(() => app.view.getByPlaceholderText('e.g. Slack')),
      SERVER_NAME,
    );
    app.rtl.fireEvent.changeText(
      app.view.getByPlaceholderText('https://api.example.com/mcp'),
      SERVER_URL,
    );
    app.rtl.fireEvent.press(app.view.getByText('Add'));

    await app.rtl.waitFor(
      () => {
        expect(app.view.getByText(SERVER_NAME)).toBeTruthy();
        expect(app.view.getByText('Active')).toBeTruthy();
        expect(app.view.getByText('1/1 tools')).toBeTruthy();
      },
      { timeout: 8000 },
    );
    pressBackIcon(app);
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByTestId('tools-back-button')),
    );
    await app.rtl.waitFor(() =>
      expect(app.view.getByTestId('chat-screen')).toBeTruthy(),
    );

    app.boundary.llama!.scriptCompletions([
      {
        text:
          '<mcp_tool_call>{"name":"lookup_weather","arguments":{"city":"Pune"}}</mcp_tool_call>',
      },
      { text: FINAL_ANSWER },
    ]);
    sendChatMessage(app.rtl, app.view, 'What is the weather in Pune?');
    await app.rtl.waitFor(
      () => {
        expect(app.view.getByText(FINAL_ANSWER)).toBeTruthy();
        expect(
          app.view.getByTestId(`tool-result-label-${TOOL_NAME}`),
        ).toBeTruthy();
      },
      { timeout: 10000 },
    );
    let resultLabel = app.view.getByTestId(`tool-result-label-${TOOL_NAME}`);
    while (resultLabel.parent && resultLabel.props.accessible !== true) {
      resultLabel = resultLabel.parent;
    }
    app.rtl.fireEvent.press(resultLabel);
    await app.rtl.waitFor(() =>
      expect(app.view.getByText(TOOL_RESULT)).toBeTruthy(),
    );
    app.view.unmount();
  }, 30000);
});
