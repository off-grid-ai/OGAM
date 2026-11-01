/**
 * App startup, on the real App.
 *
 * The whole app mounts over the native boundary (installNativeBoundary): the native downloader, the disk,
 * the device's IP address and AppState are the device; a saved remote server answers at the HTTP edge.
 * Everything between them is the app's own startup: download recovery, remote provider initialization and
 * the network reconnect watcher.
 */
import { installNativeBoundary, requireRTL } from './harness/nativeBoundary';
import { isUnder } from './harness/urlMatch';

jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });

const SERVER = 'http://192.168.1.50:1234';

/**
 * The saved server, answering at the HTTP edge. Requests are counted; while `hold` is on, every
 * request waits until release(), the way a slow server keeps the app's first connection open.
 */
function installServer() {
  const requests: string[] = [];
  let held: Array<() => void> = [];
  let holding = true;
  const realFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!isUnder(url, SERVER)) return realFetch(input);
    requests.push(url);
    if (holding) await new Promise<void>(resolve => held.push(resolve));
    return new Response(JSON.stringify({ data: [{ id: 'remote-model' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    requests,
    release() {
      holding = false;
      held.forEach(resolve => resolve());
      held = [];
    },
    restore() {
      global.fetch = realFetch;
    },
  };
}

/** The phone's IP address, as react-native-device-info reads it. */
function setPhoneIp(ip: string) {
  require('react-native-device-info').getIpAddress = jest.fn(async () => ip);
}

/** Wait out the reconnect watcher's settle delay (2.5 s), as a real network handoff does. */
const settle = (rtl: ReturnType<typeof requireRTL>) =>
  rtl.act(() => new Promise(resolve => setTimeout(resolve, 2_800)));

async function saveServer() {
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const { useRemoteServerStore } = require('../src/stores');
  const serverId = useRemoteServerStore.getState().addServer({
    name: 'Office Mac',
    endpoint: SERVER,
    providerType: 'openai-compatible',
  });
  useRemoteServerStore.getState().setActiveServerId(serverId);
}

describe('App', () => {
  jest.setTimeout(30_000);

  it('restores a download that was in flight when the app closed and finishes it after launch', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    // The native downloader kept the transfer through the app's restart.
    boundary.download!.seedActive({
      downloadId: 'restored-1',
      modelId: 'test/model',
      fileName: 'model.gguf',
      modelType: 'text',
      quantization: 'Q4_K_M',
      status: 'running',
      bytesDownloaded: 500,
      totalBytes: 1000,
    });
    const React = require('react');
    const rtl = requireRTL();
    const { useAppStore } = require('../src/stores');
    const App = require('../App').default;
    const view = rtl.render(React.createElement(App));

    // Startup re-attaches the transfer.
    await rtl.waitFor(() => expect(boundary.download!.events.listenerCount('DownloadComplete')).toBeGreaterThan(0));
    expect(useAppStore.getState().downloadedModels).toHaveLength(0);

    // The native side finishes: the file is on disk, and the model is the person's to use.
    const target = `${boundary.fs!.DocumentDirectoryPath}/models/model.gguf`;
    await rtl.act(async () => {
      boundary.fs!.seedFile(target, 1000);
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: 'restored-1',
        fileName: 'model.gguf',
        modelId: 'test/model',
        bytesDownloaded: 1000,
        totalBytes: 1000,
        status: 'completed',
        localUri: `file://${target}`,
      });
    });
    await rtl.waitFor(() =>
      expect(useAppStore.getState().downloadedModels.map((m: { fileName: string }) => m.fileName)).toContain('model.gguf'),
    );
    view.unmount();
  });

  it('starts reconnect recovery only after the saved server connection settles', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const server = installServer();
    try {
      setPhoneIp('192.168.1.10');
      await saveServer();
      const React = require('react');
      const rtl = requireRTL();
      const App = require('../App').default;
      const view = rtl.render(React.createElement(App));

      // The app's first connection to the saved server is still open.
      await rtl.waitFor(() => expect(server.requests.length).toBeGreaterThan(0));
      const duringInit = server.requests.length;

      // The phone changes network meanwhile: no recovery runs on top of the connection in progress.
      setPhoneIp('192.168.1.20');
      await rtl.act(async () => boundary.emitAppStateChange('background'));
      await rtl.act(async () => boundary.emitAppStateChange('active'));
      await settle(rtl);
      expect(server.requests).toHaveLength(duringInit);

      // The connection settles. From then on, a network change reconnects to the server.
      await rtl.act(async () => server.release());
      await rtl.act(() => new Promise(resolve => setTimeout(resolve, 50)));
      const afterInit = server.requests.length;
      setPhoneIp('192.168.1.30');
      await rtl.act(async () => boundary.emitAppStateChange('background'));
      await rtl.act(async () => boundary.emitAppStateChange('active'));
      await settle(rtl);
      expect(server.requests.length).toBeGreaterThan(afterInit);
      view.unmount();
    } finally {
      server.restore();
    }
  });

  it('does not start reconnect recovery when the connection settles after the app is gone', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const server = installServer();
    try {
      setPhoneIp('192.168.1.10');
      await saveServer();
      const React = require('react');
      const rtl = requireRTL();
      const App = require('../App').default;
      const view = rtl.render(React.createElement(App));
      await rtl.waitFor(() => expect(server.requests.length).toBeGreaterThan(0));

      view.unmount();
      await rtl.act(async () => server.release());
      await rtl.act(() => new Promise(resolve => setTimeout(resolve, 50)));
      const afterRelease = server.requests.length;

      setPhoneIp('192.168.1.20');
      await rtl.act(async () => boundary.emitAppStateChange('background'));
      await rtl.act(async () => boundary.emitAppStateChange('active'));
      await settle(rtl);
      expect(server.requests).toHaveLength(afterRelease);
    } finally {
      server.restore();
    }
  });
});
