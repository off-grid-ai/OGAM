/**
 * Scan-network state mismatch (device-reported) — the "Scan Network" alert must AGREE with the
 * server list the onboarding screen actually shows.
 *
 * Device symptom (user, on device): on the onboarding "Set Up Your AI" screen the user taps
 * "Scan Network"; a sheet says servers were NOT found; they dismiss it; and THEN the Off Grid AI
 * Gateway (192.168.1.50) appears in the list. The "not found" alert is WRONG — the server is present
 * (or gets discovered a moment later).
 *
 * Root cause: the screen runs TWO discoveries. `refreshServerHealth` (auto, on mount / when the server
 * list changes) populates the RENDERED list (reachableServerIds → liveServers). It has an in-flight
 * guard. `handleScanNetwork` (the manual "Scan Network" tap) also calls `refreshServerHealth` and,
 * before the fix, showed "No Servers Found" whenever that call returned an empty reachable set. When
 * the auto-check is already in flight, the scan's `refreshServerHealth` short-circuits and returns an
 * EMPTY set WITHOUT actually checking — so the alert fires even though the auto-check is about to (and
 * does) render the reachable server. That is the alert-vs-list race the user saw.
 *
 * Product-correct outcome (OGAM user's view): the user must NEVER see "not found" while a server is —
 * or is about to be — listed. The alert only fires on a genuinely empty network. When a server is
 * present (persisted / auto-discovered / just scanned), no alert; its row shows.
 *
 * Boundary fakes (device leaves ONLY — never our screen/store/service):
 *  - react-native-device-info: `isEmulator=false` + `getIpAddress` → a private IPv4, so the REAL
 *    `discoverLANServers` actually scans (rather than the emulator early-return).
 *  - global.fetch: the LAN/HTTP transport. `/v1/models` on the gateway answers a device-shaped
 *    OpenAI-compatible model list; every other host is a graceful reject (nothing there). To pin the
 *    device B8 timing deterministically, the gateway's second `/v1/models` hit (the manual scan's own
 *    health check) rejects as if OGAD were still warming up, so that check finds nothing reachable — yet
 *    the server IS discovered/added and the follow-up auto-check marks it reachable a moment later.
 * Everything above the boundary — the real ModelDownloadScreen, the real remoteServerStore +
 * remoteServerManager, the real refreshServerHealth / handleScanNetwork, the real networkDiscovery —
 * runs for real.
 *
 * Terminal artifacts asserted (UI layer only): the discovered server ROW renders AND no "No Servers
 * Found" alert text is present. Second scenario (genuinely empty network): the "No Servers Found" alert
 * DOES show. Falsified both ways.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// Safe-area infra (jsdom has no native safe-area). Presentation-only shim, not app logic — the same
// shim the sibling onboarding integration test uses.
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

import { ModelDownloadScreen } from '../../../src/screens/ModelDownloadScreen';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { resetStores } from '../../utils/testHelpers';

const GATEWAY_ENDPOINT = 'http://192.168.1.50:7878';

/** A minimal navigation stub — the screen only calls navigation.replace on Connect/Skip, neither of
 *  which this test exercises. It is NOT our code under test; the tested behaviour is the alert vs the row. */
const navigation = { replace: jest.fn(), navigate: jest.fn(), goBack: jest.fn() } as any;

/**
 * Fake the LAN/HTTP boundary — the gateway's /v1/models transport.
 *
 * - `serverReachable=false`: nothing on the network answers → the genuinely-empty case.
 * - `flakyWarmup=true` (models the device B8 timing): the gateway is answered on the FIRST probe (the
 *   discovery subnet sweep, which finds + adds the server), REJECTS on the SECOND (the manual scan's own
 *   health check runs while OGAD is still warming up — no model list yet, so testConnection deems it
 *   unreachable), then answers again from the THIRD on (the auto health-check fired by the just-added
 *   server settles a moment later and marks it reachable → its row renders). That reproduces exactly what
 *   the user saw: "it said no servers found, but added ogad to the list" — the alert (from the failed 2nd
 *   check) and the row (from the later successful check) both, at once.
 */
function installFetch(opts: { serverReachable: boolean; flakyWarmup?: boolean }): void {
  const { serverReachable, flakyWarmup } = opts;
  const modelsBody = { object: 'list', data: [{ id: 'gateway-llama-3-8b', object: 'model', owned_by: 'local' }] };
  let gatewayModelHits = 0;

  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (input: string) => {
    const url = String(input);
    const isGatewayModels = url.startsWith(GATEWAY_ENDPOINT) && url.includes('/v1/models');
    if (serverReachable && isGatewayModels) {
      gatewayModelHits += 1;
      // 2nd hit rejects during warm-up so the manual scan's health check finds nothing reachable — the
      // exact device transient. Every other hit answers, so discovery finds it and the later auto-check
      // marks it reachable.
      if (flakyWarmup && gatewayModelHits === 2) throw new Error('warming up');
      return { ok: true, status: 200, json: async () => modelsBody };
    }
    // Everything else — the rest of the discovery subnet sweep, capability probes, unreachable hosts —
    // is a graceful reject/!ok, exactly as an empty LAN behaves.
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

describe('Scan Network — alert matches the rendered list (device state-mismatch)', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    resetStores();
    useRemoteServerStore.setState({ servers: [], serverHealth: {}, discoveredModels: {} });
    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = jest.fn(async () => false);
    DeviceInfo.getIpAddress = jest.fn(async () => '192.168.1.42'); // private IPv4 → real scan runs
  });

  afterEach(() => {
    (global as unknown as { fetch: unknown }).fetch = realFetch;
    jest.clearAllMocks();
  });

  it('does NOT show "No Servers Found" while the gateway is (or is about to be) listed', async () => {
    // The gateway is reachable and the scan discovers it, but its health check flaps during warm-up (the
    // device B8 timing) so the manual scan's own check finds nothing reachable — yet the server IS added
    // and the follow-up auto-check marks it reachable a moment later.
    installFetch({ serverReachable: true, flakyWarmup: true });

    const ui = render(<ModelDownloadScreen navigation={navigation} />);

    // Wait for the "Analyzing your device..." init to finish and the network section to render. With an
    // empty store the mount auto-check settles immediately, so "Scan Network" is pressable.
    await waitFor(() => { expect(ui.queryByText('Scan Network')).not.toBeNull(); }, { timeout: 5000 });

    // Real gesture: tap "Scan Network". The real discoverLANServers finds the gateway and adds it; the
    // scan's own health check flaps (finds nothing reachable this instant); the servers-changed auto-check
    // then marks the gateway reachable so its row renders.
    await act(async () => {
      fireEvent.press(ui.getByText('Scan Network'));
      await new Promise((r) => setTimeout(r, 0));
    });

    // Terminal artifact: the discovered gateway row is present (its name renders)...
    await waitFor(() => {
      expect(ui.queryByText(/Off Grid AI Gateway/)).not.toBeNull();
    }, { timeout: 5000 });
    // ...and the "not found" alert is NOT shown. The alert and the list AGREE.
    expect(ui.queryByText('No Servers Found')).toBeNull();
  });

  it('DOES show "No Servers Found" when the network is genuinely empty', async () => {
    // No persisted server and nothing reachable on the LAN → the honest empty case.
    installFetch({ serverReachable: false });

    const ui = render(<ModelDownloadScreen navigation={navigation} />);
    await waitFor(() => { expect(ui.queryByText('Network Models')).not.toBeNull(); }, { timeout: 5000 });

    fireEvent.press(ui.getByText('Scan Network'));

    // The helpful "No Servers Found" alert appears — and no server row exists.
    await waitFor(() => {
      expect(ui.queryByText('No Servers Found')).not.toBeNull();
    }, { timeout: 5000 });
    expect(ui.queryByTestId(/^discovered-server-/)).toBeNull();
  });
});
