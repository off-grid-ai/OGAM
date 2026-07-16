/**
 * T097 (checklist Area 14, rendered) — Home with a remote model active: the "Text" count must reflect
 * LOCAL reality (the literal local-download count) WITHOUT reading as a broken desync.
 *
 * DEVICE FINDING (DEVICE_TEST_FINDINGS.md, UX FINDINGS): "'Text says 0' on home while a remote model is
 * active + selected. Likely '0 local text models' (correct literal) but reads as a desync next to an active
 * remote model. Confirm the chat works despite the 0." Also B18: a remote model can be active with no local
 * models present.
 *
 * PRODUCT-CORRECT OUTCOME (OGAM user's view): with a remote text model active and ZERO local text models,
 * the Home "Text" summary must show BOTH truths at once so it is not a misleading desync —
 *   (a) the count numeral is the LITERAL local count (0), not the remote model (it is a LOCAL-download count);
 *   (b) the "Text" type still reads ACTIVE (a text model IS represented / usable — the remote one), i.e. it is
 *       NOT the dimmed "no model" state. That active-but-0 pair is what makes the 0 correct rather than broken.
 * Verdict: GREEN / verify (checklist marks it ✅ happy/verify). If the Text type instead read as INACTIVE
 * (dimmed, "—") while a remote model was active, THAT would be the misleading desync — so the assertion below
 * pins active===true, and the falsification proves it flips.
 *
 * ARRIVAL IS REAL (not seeded state-under-test): a remote model becomes active the way a user reaches it —
 *   1. On the REAL RemoteServersScreen: tap "Add Server", type name + endpoint, tap "Test Connection". The
 *      real addServer + testConnection run over a faked global.fetch answering /v1/models (the LAN boundary,
 *      exactly as T046). testConnection populates the REAL useRemoteServerStore.discoveredModels.
 *   2. Tap the modal's "Add Server" to persist the connected server.
 *   3. Mount the REAL HomeScreen (shares the same real store). Its setup card now offers "Select Model"
 *      (remoteTextModels > 0). Tap it → the real ModelPickerSheet renders the discovered "remote-model-item".
 *   4. Tap the remote model → the real handleSelectRemoteTextModel → remoteServerManager.setActiveRemoteTextModel
 *      sets activeServerId + activeRemoteTextModelId in the real store. NO store.setState of the tested state.
 *
 * Boundary faked: ONLY global.fetch (the network/LAN transport) + the native leaves via installNativeBoundary.
 * Everything we own — both screens, useHomeScreen, useActiveTextModel, remoteServerStore/manager, the picker —
 * runs for real. Assertion is on the rendered ModelsSummaryRow (the Home "Text" surface the finding names).
 *
 * Falsify (shown in the transcript): drop the remote-model-select gesture → no remote model active → the
 * "Text" type renders INACTIVE (active===false) → the pinned assertion fails. That inactive-while-0 IS the
 * misleading-desync state the finding warns about, so the failing case is the device-wrong value.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('T097 (rendered) — Home Text count with a remote model active is not a misleading desync', () => {
  const setup = (opts: { selectRemoteModel: boolean }) => {
    installNativeBoundary();

    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const rtl = requireRTL();
    const { RemoteServersScreen } = require('../../../src/screens/RemoteServersScreen');
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    const { useRemoteServerStore, useAppStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // Fresh remote store (no servers) + ZERO local text models — the exact device precondition (0 local).
    useRemoteServerStore.setState({ servers: [], serverHealth: {}, discoveredModels: {}, activeServerId: null, activeRemoteTextModelId: null, activeRemoteImageModelId: null });
    useAppStore.setState({ downloadedModels: [], activeModelId: null, downloadedImageModels: [], activeImageModelId: null });

    // LAN boundary: a reachable OpenAI-compatible server answering /v1/models with one text model (as T046).
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
      if (String(url).includes('/v1/models')) {
        return { ok: true, status: 200, json: async () => ({ object: 'list', data: [{ id: 'llama-3-8b', object: 'model', owned_by: 'local' }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const nav = { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} };
    return { React, rtl, RemoteServersScreen, HomeScreen, useRemoteServerStore, useAppStore, nav, opts };
  };

  // Arrive at "a remote server is connected + its models discovered" through the REAL Add-Server UI (T046 flow).
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

  it('shows Text count = 0 (literal local count) while the Text type reads ACTIVE (remote model represented)', async () => {
    const env = setup({ selectRemoteModel: true });
    const { React, rtl, HomeScreen, useRemoteServerStore, nav } = env;

    await connectServerViaUI(env);

    // Mount the REAL Home screen (shares the real remote store — the connected server's models are discovered).
    const home = rtl.render(React.createElement(HomeScreen, { navigation: nav }));

    // The setup card offers "Select Model" once remoteTextModels > 0 — tap it to open the real picker.
    rtl.fireEvent.press(await rtl.waitFor(() => home.getByTestId('browse-models-button'), { timeout: 4000 }));

    // Tap the discovered remote model → real handleSelectRemoteTextModel → setActiveRemoteTextModel.
    rtl.fireEvent.press(await rtl.waitFor(() => home.getByTestId('remote-model-item'), { timeout: 4000 }));

    // The real store now reports a remote model active (EMERGENT from the gesture, not setState).
    await rtl.waitFor(() => { expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBe('llama-3-8b'); }, { timeout: 4000 });

    // ── Assert the rendered Home "Text" surface (ModelsSummaryRow) — the finding's exact surface ──
    // (a) The count numeral is the LITERAL local count: 0. It is a LOCAL-download count, not the remote model.
    const textCount = await rtl.waitFor(() => home.getByTestId('model-summary-count-text'), { timeout: 4000 });
    expect(textCount.props.children).toBe(0);

    // (b) The "Text" type reads ACTIVE (a remote text model IS represented/usable) — NOT the dimmed "no model"
    // state. This is what makes the 0 correct rather than a misleading desync.
    await rtl.waitFor(() => {
      expect(home.getByTestId('model-summary-text').props.accessibilityState.selected).toBe(true);
    }, { timeout: 4000 });

    home.unmount();
  });
});
