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
    expect(view.queryByText('Scanning')).not.toBeNull();
    await waitFor(() => { expect(view.queryByText(/253 \/ 254 checked/)).not.toBeNull(); });
    finishLastProbe?.();
    await waitFor(() => { expect(view.queryByText('Scanning')).toBeNull(); }, { timeout: 10_000 });
    expect(view.queryByText(/Added 1 server/)).not.toBeNull();
    view.unmount();
  }, 60_000);
});
