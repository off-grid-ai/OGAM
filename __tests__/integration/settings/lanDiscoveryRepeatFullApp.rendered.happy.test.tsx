/** APP-P2-009 — repeated LAN scans keep one row per endpoint and retain every discovered server. */
import { renderMainApp } from '../../harness/appJourney';

const OLLAMA_ENDPOINT = 'http://192.168.77.10:11434';
const STUDIO_ENDPOINT = 'http://192.168.77.20:1234';

function installLanBoundary(): void {
  global.fetch = jest.fn(async input => {
    const url = String(input);
    if (url === `${OLLAMA_ENDPOINT}/api/tags`) {
      return new Response(JSON.stringify({ models: [{ name: 'llama3' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === `${STUDIO_ENDPOINT}/v1/models`) {
      return new Response(
        JSON.stringify({ object: 'list', data: [{ id: 'qwen3' }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return new Response('', { status: 503 });
  });
}

describe('full-App repeated LAN discovery', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('adds two discovered servers once and reports them as already added on the next scan', async () => {
    installLanBoundary();
    const app = await renderMainApp({
      beforeRender: () => {
        const deviceInfo = require('react-native-device-info');
        deviceInfo.isEmulator.mockResolvedValue(false);
        deviceInfo.getIpAddress = jest.fn().mockResolvedValue('192.168.77.42');
      },
    });

    app.rtl.fireEvent.press(app.view.getByTestId('settings-tab'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByText('Remote Servers')),
    );
    app.rtl.fireEvent.press(app.view.getByText('Scan Network'));

    await app.rtl.waitFor(
      () => {
        expect(app.view.getByText('Discovery Complete')).toBeTruthy();
        expect(app.view.getByText('Added 2 servers.')).toBeTruthy();
        expect(app.view.getAllByText('Ollama (192.168.77.10)')).toHaveLength(1);
        expect(app.view.getAllByText('LM Studio (192.168.77.20)')).toHaveLength(
          1,
        );
      },
      { timeout: 10000 },
    );

    app.rtl.fireEvent.press(app.view.getByText('OK'));
    app.rtl.fireEvent.press(app.view.getByText('Scan Network'));
    await app.rtl.waitFor(
      () => {
        expect(app.view.getByText('Already Added')).toBeTruthy();
        expect(app.view.getAllByText('Ollama (192.168.77.10)')).toHaveLength(1);
        expect(app.view.getAllByText('LM Studio (192.168.77.20)')).toHaveLength(
          1,
        );
      },
      { timeout: 10000 },
    );
    app.view.unmount();
  }, 30000);
});
