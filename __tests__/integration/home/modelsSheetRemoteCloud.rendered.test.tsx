/**
 * DEVICE 2026-07-14 (IMG report) — the Models manager sheet's TEXT row showed a remote model
 * (Qwen3.5-2B on the Off Grid AI Gateway) with NO remote marker: indistinguishable from a local
 * model. SPEC (OGAM user's view): a remote selection carries the cloud marker hugging the right
 * of the model name (matching the chat header's remote indicator), so a remote model is never
 * mistaken for local. A LOCAL/absent selection shows no cloud (falsified both ways).
 *
 * ARRIVAL IS REAL (same journey as homeRemoteModelTextCount): connect a server through the REAL
 * RemoteServersScreen Add-Server UI over a faked LAN fetch → mount the REAL HomeScreen → tap the
 * real "Select Model" → tap the discovered remote model (real setActiveRemoteTextModel) → tap the
 * real Models summary card ('models-summary') to open the REAL ModelsManagerSheet. No setState of
 * the state under test. Boundary fakes: global.fetch (LAN) + installNativeBoundary leaves only.
 *
 * Terminal artifact: the cloud marker ('models-row-text-remote') inside the sheet's TEXT row.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('Models manager sheet — remote TEXT selection carries the cloud marker (rendered)', () => {
  const setup = () => {
    installNativeBoundary();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const rtl = requireRTL();
    const { RemoteServersScreen } = require('../../../src/screens/RemoteServersScreen');
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    const { useRemoteServerStore, useAppStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    useRemoteServerStore.setState({ servers: [], serverHealth: {}, discoveredModels: {}, activeServerId: null, activeRemoteTextModelId: null, activeRemoteImageModelId: null });
    useAppStore.setState({ downloadedModels: [], activeModelId: null, downloadedImageModels: [], activeImageModelId: null });

    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
      if (String(url).includes('/v1/models')) {
        return { ok: true, status: 200, json: async () => ({ object: 'list', data: [{ id: 'llama-3-8b', object: 'model', owned_by: 'local' }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const nav = { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} };
    return { React, rtl, RemoteServersScreen, HomeScreen, useRemoteServerStore, nav };
  };

  /** Connect a server through the REAL Add-Server UI (the T046/T097 gesture chain). */
  const connectServerViaUI = async (env: ReturnType<typeof setup>) => {
    const { React, rtl, RemoteServersScreen, nav } = env;
    const srv = rtl.render(React.createElement(RemoteServersScreen, { navigation: nav }));
    rtl.fireEvent.press(srv.getByText('Add Server'));
    rtl.fireEvent.changeText(await rtl.waitFor(() => srv.getByPlaceholderText('e.g., Off Grid AI Desktop')), 'My LM Studio');
    rtl.fireEvent.changeText(srv.getByPlaceholderText('http://192.168.1.50:7878'), 'http://localhost:1234');
    rtl.fireEvent.press(srv.getByText('Test Connection'));
    await rtl.waitFor(() => { expect(srv.queryByText(/Connected \(/)).not.toBeNull(); }, { timeout: 4000 });
    const addButtons = srv.getAllByText('Add Server');
    rtl.fireEvent.press(addButtons[addButtons.length - 1]);
    await rtl.waitFor(() => { expect(srv.queryByText('My LM Studio')).not.toBeNull(); }, { timeout: 4000 });
    srv.unmount();
  };

  it('remote model selected → the sheet TEXT row shows the cloud marker next to the name', async () => {
    const env = setup();
    const { React, rtl, HomeScreen, useRemoteServerStore, nav } = env;
    await connectServerViaUI(env);

    const home = rtl.render(React.createElement(HomeScreen, { navigation: nav }));
    // Select the remote model the way a user does: browse → tap the discovered remote model.
    rtl.fireEvent.press(await rtl.waitFor(() => home.getByTestId('browse-models-button'), { timeout: 4000 }));
    rtl.fireEvent.press(await rtl.waitFor(() => home.getByTestId('remote-model-item'), { timeout: 4000 }));
    await rtl.waitFor(() => { expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBe('llama-3-8b'); }, { timeout: 4000 });

    // Real gesture: open the Models manager sheet from the Home summary card.
    rtl.fireEvent.press(await rtl.waitFor(() => home.getByTestId('models-summary'), { timeout: 4000 }));

    // Terminal artifact: the TEXT row renders the remote cloud marker (hugging the model name).
    await rtl.waitFor(() => { expect(home.queryByTestId('models-row-text-remote')).not.toBeNull(); }, { timeout: 4000 });
    home.unmount();
  });

  it('falsifier — no remote model selected → the sheet TEXT row shows NO cloud marker', async () => {
    const env = setup();
    const { React, rtl, HomeScreen, nav } = env;
    await connectServerViaUI(env); // server connected, but its model is NEVER selected

    const home = rtl.render(React.createElement(HomeScreen, { navigation: nav }));
    rtl.fireEvent.press(await rtl.waitFor(() => home.getByTestId('models-summary'), { timeout: 4000 }));

    // The sheet is open (its TEXT row renders)…
    await rtl.waitFor(() => { expect(home.queryByTestId('models-row-text')).not.toBeNull(); }, { timeout: 4000 });
    // …but with no remote selection there is no cloud marker.
    expect(home.queryByTestId('models-row-text-remote')).toBeNull();
    home.unmount();
  });
});
