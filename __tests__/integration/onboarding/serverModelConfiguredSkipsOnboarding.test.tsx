/**
 * T095 (checklist Area 14) — Configure a server + model during onboarding, tap Continue, and the app
 * routes STRAIGHT into the main app, skipping the remaining onboarding step.
 *
 * Device finding (docs/DEVICE_TEST_FINDINGS.md, CONFIRMED-WORKING): "Onboarding skipped when a server +
 * model are already configured ('hit continue, it skipped onboarding — good UX')." This locks that happy
 * path as a regression guard.
 *
 * Product-correct outcome (OGAM user's view): while on the ModelDownload onboarding step (the "remaining
 * onboarding"), if the user connects to a network server that has a model, tapping "Continue" on the
 * "Connected!" sheet drops them into the main app (the tab bar / Home) and does NOT leave them on — or
 * bounce them back to — the ModelDownload onboarding step.
 *
 * Entry point + gestures (real, arrive-via-UI):
 *  - Mount the REAL AppNavigator inside a REAL NavigationContainer. With onboarding already completed but
 *    NO downloaded on-device model, the initial route is 'ModelDownload' — i.e. the remaining onboarding
 *    step the user still sees.
 *  - Add a server the real way: tap "Add Server", type a name + endpoint into the real modal, tap "Test
 *    Connection" (the real probe runs over the faked /v1/models), then tap the modal's "Add Server" save.
 *  - Back on the onboarding screen the real health check marks the server reachable and renders its
 *    "Connect" button. Tap Connect → the real handleConnectServer runs testConnection + sets the active
 *    remote text model, then shows the "Connected!" sheet with a "Continue" button.
 *  - Tap "Continue".
 *
 * Boundary fake (ONLY the device boundary): global.fetch — the LAN/network transport. It answers a
 * reachable OpenAI-compatible server on /v1/models with one text model (device-shaped OpenAI list JSON);
 * every other URL (HF model files, capability probes) is a graceful !ok, exactly as a minimal
 * openai-compatible server behaves. Everything above it — the screens, the real navigation stack, the
 * real remoteServerStore + remoteServerManager, the health check, the alert — runs for real.
 *
 * Terminal artifact asserted (UI layer only): after Continue, the main app surface renders (the Home tab
 * button 'home-tab') AND the remaining onboarding step is gone (no 'model-download-screen').
 *
 * Falsified both ways (see the transcript in the task report): with a server+model configured → Continue
 * lands on Home (green). With NO reachable server (fetch !ok for /v1/models) → no Connect button appears,
 * so onboarding is NOT skipped — the ModelDownload step stays and Home never renders (red).
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';

// Safe-area infra (jsdom has no native safe-area). Presentation-only shim, not app logic — the same
// shim the existing AppNavigator render test uses.
jest.mock('react-native-safe-area-context', () => {
  const mockReact = require('react');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaInsetsContext: mockReact.createContext(insets),
    SafeAreaFrameContext: mockReact.createContext({ x: 0, y: 0, width: 390, height: 844 }),
    useSafeAreaInsets: () => insets,
    initialWindowMetrics: { frame: { x: 0, y: 0, width: 390, height: 844 }, insets },
  };
});

import { AppNavigator } from '../../../src/navigation/AppNavigator';
import { useAppStore } from '../../../src/stores/appStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { resetStores } from '../../utils/testHelpers';
import { createDeviceInfo } from '../../utils/factories';

/** Fake the LAN/network boundary. `reachable=false` models "no server on the network". */
function installFetch(reachable: boolean) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    if (reachable && String(url).includes('/v1/models')) {
      // Device-shaped OpenAI-compatible model list — one text model.
      return { ok: true, status: 200, json: async () => ({ object: 'list', data: [{ id: 'llama-3-8b', object: 'model', owned_by: 'local' }] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

/** Arrive-via-UI on the ModelDownload onboarding step, then add + connect a server through the real modal. */
async function addAndConnectServerViaUI(ui: ReturnType<typeof render>) {
  // Real gesture: open the Add Server modal from the onboarding screen.
  fireEvent.press(await waitFor(() => ui.getByText('Add Server')));

  // Fill the real modal (targeted by placeholders, like the RemoteServersScreen flow).
  fireEvent.changeText(await waitFor(() => ui.getByPlaceholderText('e.g., Off Grid AI Desktop')), 'My Desktop');
  fireEvent.changeText(ui.getByPlaceholderText('http://192.168.1.50:7878'), 'http://localhost:1234');

  // Test Connection first — the real probe runs over the faked /v1/models. Save stays disabled until it
  // succeeds, so this is a required real step (mirrors the real add-server UX).
  fireEvent.press(ui.getByText('Test Connection'));
  await waitFor(() => { expect(ui.queryByText(/Connected \(/)).not.toBeNull(); }, { timeout: 4000 });

  // Save the server (the modal's "Add Server", the last such text).
  const addButtons = ui.getAllByText('Add Server');
  fireEvent.press(addButtons[addButtons.length - 1]);

  // The onboarding screen's real health check now marks the server reachable → its Connect button renders.
  const connect = await waitFor(() => ui.getByTestId(/^discovered-server-.*-connect$/), { timeout: 4000 });
  // Tap Connect → real handleConnectServer: testConnection + setActiveRemoteTextModel + "Connected!" sheet.
  fireEvent.press(connect);
}

describe('T095 — server + model configured → tap Continue → routes into the app, skips remaining onboarding', () => {
  beforeEach(() => {
    resetStores();
    // Fresh remote-server slate so the added server is the only row.
    useRemoteServerStore.setState({ servers: [], serverHealth: {}, discoveredModels: {} });
    // Onboarding slides already done + NO on-device model downloaded → the initial route is the remaining
    // onboarding step, 'ModelDownload' (per AppNavigator's initial-route logic). This is BOOT state, not a
    // fabrication of the tested outcome — the outcome (skipping to Main) is produced by the gestures below.
    useAppStore.setState({ hasCompletedOnboarding: true, downloadedModels: [], deviceInfo: createDeviceInfo() });
  });

  it('lands on the main app (Home) and the ModelDownload onboarding step is gone after Continue', async () => {
    installFetch(true); // a reachable server with a model exists on the network
    const ui = render(
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>,
    );

    // Pre-condition: we ARE on the remaining onboarding step and NOT yet in the app.
    await waitFor(() => { expect(ui.queryByTestId('model-download-screen')).not.toBeNull(); }, { timeout: 4000 });
    expect(ui.queryByTestId('home-tab')).toBeNull();

    await addAndConnectServerViaUI(ui);

    // Real gesture: tap "Continue" on the "Connected!" sheet.
    fireEvent.press(await waitFor(() => ui.getByText('Continue'), { timeout: 4000 }));

    // Terminal artifact: routed straight into the app — the Home tab renders — and the remaining
    // onboarding step is gone (skipped, not lingering / bounced back).
    await waitFor(() => { expect(ui.queryByTestId('home-tab')).not.toBeNull(); }, { timeout: 4000 });
    expect(ui.queryByTestId('model-download-screen')).toBeNull();
  });
});
