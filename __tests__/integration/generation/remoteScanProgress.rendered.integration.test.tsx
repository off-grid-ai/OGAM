import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { withNavigator } from '../../harness/realNavigation';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');
jest.mock('react-native-device-info', () => ({
  isEmulator: async () => false,
  getIpAddress: async () => '192.168.1.42',
}));

describe('remote server scan progress', () => {
  const originalFetch = global.fetch;
  afterEach(async () => {
    global.fetch = originalFetch;
    await remoteServerManager.clearAllServers();
  });

  // This rendered /24 journey reports all 254 probes and is slower under full-suite coverage.
  it('shows a found Desktop and completed probes while one probe is still pending', async () => {
    await remoteServerManager.clearAllServers();
    let finishLastProbe: (() => void) | undefined;
    const lastProbe = new Promise<{ status: number; ok: boolean }>(resolve => {
      finishLastProbe = () => resolve({ status: 404, ok: false });
    });
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('192.168.1.254:7878')) return lastProbe as Promise<Response>;
      if (url.includes('192.168.1.2:7878')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({ data: [{ id: 'desktop-text', kind: 'chat' }] }),
        } as Response;
      }
      return { status: 404, ok: false } as Response;
    }) as typeof fetch;

    const view = render(withNavigator(<RemoteServersScreen />));
    fireEvent(view.getByTestId('scan-kind-ollama'), 'valueChange', false);
    fireEvent(view.getByTestId('scan-kind-lmstudio'), 'valueChange', false);
    fireEvent.press(view.getByTestId('scan-network'));

    await waitFor(() => { expect(view.queryByText(/Off Grid AI Gateway \(192\.168\.1\.2\)/)).not.toBeNull(); });
    expect(view.queryByTestId('stop-scan')).not.toBeNull();
    expect(view.queryByTestId('scan-network')).toBeNull();
    // 253 of 254 answered: the found count and the share checked, never raw probe numbers.
    await waitFor(() => { expect(view.queryByText('1 found · 100% checked')).not.toBeNull(); });
    finishLastProbe?.();
    await waitFor(() => { expect(view.queryByTestId('stop-scan')).toBeNull(); }, { timeout: 10_000 });
    expect(view.queryByTestId('scan-network')).not.toBeNull();
    expect(view.queryByText(/Added 1 server/)).not.toBeNull();
    view.unmount();
  }, 60_000);

  it('Stop scan sends no further probes and says the scan stopped', async () => {
    await remoteServerManager.clearAllServers();
    const probed: string[] = [];
    const held: Array<() => void> = [];
    global.fetch = ((input: RequestInfo | URL) => {
      probed.push(String(input));
      return new Promise<Response>(resolve => {
        held.push(() => resolve({ status: 404, ok: false } as Response));
      });
    }) as typeof fetch;

    const view = render(withNavigator(<RemoteServersScreen />));
    fireEvent(view.getByTestId('scan-kind-ollama'), 'valueChange', false);
    fireEvent(view.getByTestId('scan-kind-lmstudio'), 'valueChange', false);
    fireEvent.press(view.getByTestId('scan-network'));
    await waitFor(() => { expect(probed.length).toBeGreaterThan(0); });
    expect(view.queryByText('None found yet · 0% checked')).not.toBeNull();

    fireEvent.press(view.getByTestId('stop-scan'));
    const probedAtStop = probed.length;
    expect(probedAtStop).toBeLessThan(254);
    held.splice(0).forEach(release => release());

    await waitFor(() => { expect(view.queryByText('Scan stopped. No new servers found.')).not.toBeNull(); });
    expect(probed.length).toBe(probedAtStop);
    expect(view.queryByTestId('scan-network')).not.toBeNull();
    view.unmount();
  }, 30_000);

  it('a stopped scan that found a server says it added it', async () => {
    await remoteServerManager.clearAllServers();
    const held: Array<() => void> = [];
    global.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('192.168.1.1:7878')) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: async () => ({ data: [{ id: 'desktop-text', kind: 'chat' }] }),
        } as Response);
      }
      return new Promise<Response>(resolve => {
        held.push(() => resolve({ status: 404, ok: false } as Response));
      });
    }) as typeof fetch;

    const view = render(withNavigator(<RemoteServersScreen />));
    fireEvent(view.getByTestId('scan-kind-ollama'), 'valueChange', false);
    fireEvent(view.getByTestId('scan-kind-lmstudio'), 'valueChange', false);
    fireEvent.press(view.getByTestId('scan-network'));
    await waitFor(() => { expect(view.queryByText(/^1 found · /)).not.toBeNull(); });

    fireEvent.press(view.getByTestId('stop-scan'));
    held.splice(0).forEach(release => release());
    await waitFor(() => { expect(view.queryByText('Scan stopped. Added 1 server.')).not.toBeNull(); });
    view.unmount();
  }, 30_000);

  it('leaving the screen stops the sweep', async () => {
    await remoteServerManager.clearAllServers();
    const probed: string[] = [];
    const held: Array<() => void> = [];
    global.fetch = ((input: RequestInfo | URL) => {
      probed.push(String(input));
      return new Promise<Response>(resolve => {
        held.push(() => resolve({ status: 404, ok: false } as Response));
      });
    }) as typeof fetch;

    const view = render(withNavigator(<RemoteServersScreen />));
    fireEvent.press(view.getByTestId('scan-network'));
    await waitFor(() => { expect(probed.length).toBeGreaterThan(0); });
    view.unmount();
    const probedAtLeave = probed.length;
    held.splice(0).forEach(release => release());
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(probed.length).toBe(probedAtLeave);
  }, 30_000);
});
