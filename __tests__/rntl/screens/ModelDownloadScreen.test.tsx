/**
 * Advanced Setup (ModelDownloadScreen) — the onboarding screen that offers a model on this phone or a
 * server on the network.
 *
 * The real screen runs on a real stack navigator, with the real embedded Models screen, stores,
 * modelManager, remoteServerManager and network discovery. Only the device is faked: the RAM sensor
 * and device-info, the in-memory disk and the native background downloader (modelManagerDevice), the
 * keychain, and the network at fetch (Hugging Face's model API and the LAN). Each test reads what the
 * person sees and which screen the app is on.
 */
jest.unmock('@react-navigation/native');

import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';
import { requireRTL, GB } from '../../harness/nativeBoundary';
import { serveHfModelApi, type HfModelApiServer } from '../../harness/hfModelApiServer';
import { installLanProbe, type LanProbeHandle } from '../../harness/lanProbe';
import { isUnder } from '../../harness/urlMatch';

const SERVER_HOST = '192.168.1.10:1234';
const SERVER_ENDPOINT = `http://${SERVER_HOST}`;
const QWEN_08B_REPO = 'unsloth/Qwen3.5-0.8B-GGUF';
const QWEN_08B_FILE = 'Qwen3.5-0.8B-Q4_K_M.gguf';

type Rtl = ReturnType<typeof requireRTL>;
type LiveHosts = Parameters<typeof installLanProbe>[0];

interface Setup {
  device: ModelManagerDevice;
  rtl: Rtl;
  view: ReturnType<Rtl['render']>;
  /** The route on top of the stack. */
  route(): string | undefined;
  /** Change what the LAN answers from now on. */
  setLan(hosts: LiveHosts): void;
}

let hf: HfModelApiServer | undefined;
let lan: LanProbeHandle | undefined;
const realFetch = globalThis.fetch;

afterEach(() => {
  lan?.uninstall();
  hf?.restore();
  lan = undefined;
  hf = undefined;
  globalThis.fetch = realFetch;
});

/** Route each request to its part of the network: Hugging Face's API, or a host on the LAN. */
function installNetwork(hosts: LiveHosts): (next: LiveHosts) => void {
  hf = serveHfModelApi({ repos: { [QWEN_08B_REPO]: [{ path: QWEN_08B_FILE, size: 4 * GB }] } });
  const hfFetch = globalThis.fetch;
  let lanFetch: typeof fetch;
  const setLan = (next: LiveHosts) => {
    lan?.uninstall();
    globalThis.fetch = hfFetch;
    lan = installLanProbe(next);
    lanFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      isUnder(String(input), 'https://huggingface.co')
        ? hfFetch(input, init)
        : lanFetch(input, init)) as typeof fetch;
  };
  setLan(hosts);
  return setLan;
}

async function mount(opts: {
  platform?: 'ios' | 'android';
  ramGB?: number;
  lan?: LiveHosts;
  /** Servers the person saved earlier, added through the app's own manager before the screen opens. */
  savedServers?: Array<{ name: string; endpoint: string }>;
  /** The device-info read fails, as a native module error would. */
  deviceInfoFails?: boolean;
  /** The phone's Wi-Fi address (a private one lets the real scan sweep the subnet). */
  ip?: string;
} = {}): Promise<Setup> {
  const platform = opts.platform ?? 'ios';
  const device = await installModelManagerDevice({ platform });
  const totalBytes = (opts.ramGB ?? 8) * GB;
  device.boundary.setRam({ platform, totalBytes, availBytes: totalBytes / 2 });

  const DeviceInfo = require('react-native-device-info');
  DeviceInfo.isEmulator = jest.fn(async () => false);
  DeviceInfo.getIpAddress = jest.fn(async () => opts.ip ?? '192.168.1.42');
  if (opts.deviceInfoFails) DeviceInfo.getModel = jest.fn(async () => { throw new Error('device info unavailable'); });

  const setLan = installNetwork(opts.lan ?? {});

  if (opts.savedServers?.length) {
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    for (const server of opts.savedServers) {
      await remoteServerManager.addServer({ ...server, providerType: 'openai-compatible' });
    }
  }

  const React = require('react');
  const rtl = requireRTL();
  const nav = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { Text } = require('react-native');
  const { AdvancedSetupScreen } = require('../../../src/screens/ModelDownloadScreen');
  const Stack = createNativeStackNavigator();
  const ref = nav.createNavigationContainerRef();
  const Named = ({ route }: { route: { name: string } }) => React.createElement(Text, null, `${route.name} screen`);

  const view = rtl.render(
    React.createElement(
      nav.NavigationContainer,
      { ref },
      React.createElement(
        Stack.Navigator,
        null,
        React.createElement(Stack.Screen, { name: 'AdvancedSetup', component: AdvancedSetupScreen }),
        React.createElement(Stack.Screen, { name: 'Main', component: Named }),
        React.createElement(Stack.Screen, { name: 'RemoteServerEditor', component: Named }),
        React.createElement(Stack.Screen, { name: 'Chat', component: Named }),
      ),
    ),
  );
  return { device, rtl, view, route: () => ref.getCurrentRoute()?.name, setLan };
}

/** Mount and wait for the device analysis to finish. */
async function mountLoaded(opts: Parameters<typeof mount>[0] = {}): Promise<Setup> {
  const setup = await mount(opts);
  await setup.rtl.waitFor(() => expect(setup.view.getByText('Advanced setup')).toBeTruthy());
  return setup;
}

/** A reachable OpenAI-compatible server on the LAN with these models. */
const servingModels = (ids: string[]): LiveHosts => ({
  [SERVER_HOST]: {
    paths: ['/v1/models'],
    body: { object: 'list', data: ids.map(id => ({ id, object: 'model', owned_by: 'local' })) },
  },
});

describe('Advanced Setup', () => {
  it('shows the device analysis first, then the setup with this phone and its memory', async () => {
    const { rtl, view } = await mount({ ramGB: 8 });

    expect(view.getByTestId('model-download-loading')).toBeTruthy();
    expect(view.getByText(/Analyzing your device/)).toBeTruthy();

    await rtl.waitFor(() => expect(view.getByTestId('model-download-screen')).toBeTruthy());
    expect(view.queryByText(/Analyzing your device/)).toBeNull();
    expect(view.getByText('Advanced setup')).toBeTruthy();
    expect(view.getByText('Run a model from your network or on this device.')).toBeTruthy();
    expect(view.getByText('Network models')).toBeTruthy();
    expect(view.getByText('On this device')).toBeTruthy();
    expect(view.getByText('Your device')).toBeTruthy();
    // Total, not available: an "available" number moves with whatever else the phone is doing.
    expect(view.getByText('Total memory')).toBeTruthy();
    expect(view.getByText('8.00 GB')).toBeTruthy();
  });

  it('says it could not start when the phone will not report what it is', async () => {
    const { rtl, view } = await mount({ deviceInfoFails: true });

    await rtl.waitFor(() => expect(view.getByText('Failed to initialize. Please try again.')).toBeTruthy());
    expect(view.getByText('Error')).toBeTruthy();
  });

  it('Skip for Now takes the person to the app', async () => {
    const { rtl, view, route } = await mountLoaded();
    expect(route()).toBe('AdvancedSetup');

    rtl.fireEvent.press(view.getByTestId('model-download-skip'));

    await rtl.waitFor(() => expect(route()).toBe('Main'));
  });

  it('Add Server opens the server editor', async () => {
    const { rtl, view, route } = await mountLoaded();

    rtl.fireEvent.press(view.getByText('Add server'));

    await rtl.waitFor(() => expect(route()).toBe('RemoteServerEditor'));
  });

  it.each([8, 3])('offers Qwen 3.5 0.8B as a local model on a %i GB phone', async ramGB => {
    // The smallest phones sold have 3 GB: Qwen 3.5 0.8B (0.74 GB) still loads there.
    const { rtl, view } = await mountLoaded({ ramGB });

    await rtl.waitFor(() => expect(view.getByText('Qwen 3.5 0.8B')).toBeTruthy());
  });

  describe('downloading a local model', () => {
    async function startQwenDownload(setup: Setup) {
      const { rtl, view, device } = setup;
      const card = await rtl.waitFor(() => view.getByLabelText('Download Qwen 3.5 0.8B'));
      await rtl.act(async () => { rtl.fireEvent.press(card); });
      await rtl.waitFor(() => expect(device.nativeRows()).toHaveLength(1));
      return device.nativeRows()[0];
    }

    it('hands the Q4_K_M file to the downloader, then marks the model downloaded without an alert', async () => {
      const setup = await mountLoaded();
      const { rtl, view, device } = setup;

      const row = await startQwenDownload(setup);
      expect(row.fileName).toBe(QWEN_08B_FILE);
      await rtl.waitFor(() => expect(view.queryByLabelText('Download Qwen 3.5 0.8B')).toBeNull());

      await rtl.act(async () => { await device.finishDownload(row.downloadId, 4 * GB); });

      await rtl.waitFor(() => expect(view.getByTestId('model-card-0-downloaded')).toBeTruthy());
      expect(await device.fs.module.exists(`${device.modelsDir}/${QWEN_08B_FILE}`)).toBe(true);
      // Success is the tick on the card, not a sheet.
      expect(view.queryByText('Download Complete!')).toBeNull();
    });

    it('shows Download Failed with the downloader\'s reason when the transfer fails', async () => {
      const setup = await mountLoaded();
      const { rtl, view, device } = setup;

      const row = await startQwenDownload(setup);
      await rtl.act(async () => { await device.failDownload(row.downloadId, 'Not enough storage on the phone'); });

      await rtl.waitFor(() => expect(view.getByText('Download Failed')).toBeTruthy());
      expect(view.getByText(/Not enough storage on the phone/)).toBeTruthy();
      expect(view.queryByTestId('model-card-0-downloaded')).toBeNull();
    });

    it('shows Download Failed when the downloader refuses to start', async () => {
      const setup = await mountLoaded();
      const { rtl, view, device } = setup;
      device.boundary.download!.module.startDownload.mockRejectedValueOnce(new Error('Unexpected error'));

      const card = await rtl.waitFor(() => view.getByLabelText('Download Qwen 3.5 0.8B'));
      await rtl.act(async () => { rtl.fireEvent.press(card); });

      await rtl.waitFor(() => expect(view.getByText('Download Failed')).toBeTruthy());
      expect(view.getByText(/Unexpected error/)).toBeTruthy();
      expect(device.nativeRows()).toHaveLength(0);
    });
  });

  describe('a saved server on the network', () => {
    it('lists it once it answers; Connect picks its text model and Continue opens the app', async () => {
      const { rtl, view, route } = await mountLoaded({
        savedServers: [{ name: 'My Server', endpoint: SERVER_ENDPOINT }],
        lan: servingModels(['llama3', 'llava']),
      });

      const connect = await rtl.waitFor(() => view.getByText('Connect'));
      expect(view.getByText('My Server')).toBeTruthy();
      await rtl.act(async () => { rtl.fireEvent.press(connect); });

      await rtl.waitFor(() => expect(view.getByText('Connected!')).toBeTruthy());
      expect(view.getByText(/My Server is ready with 2 models/)).toBeTruthy();
      const { useRemoteServerStore } = require('../../../src/stores/remoteServerStore');
      expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBe('llama3');

      rtl.fireEvent.press(view.getByText('Continue'));
      await rtl.waitFor(() => expect(route()).toBe('Main'));
    });

    it('says the server has no models when it answers with none, and stays here', async () => {
      const { rtl, view, route } = await mountLoaded({
        savedServers: [{ name: 'My Server', endpoint: SERVER_ENDPOINT }],
        lan: servingModels([]),
      });

      const connect = await rtl.waitFor(() => view.getByText('Connect'));
      await rtl.act(async () => { rtl.fireEvent.press(connect); });

      await rtl.waitFor(() => expect(view.getByText('Connected — No Models Found')).toBeTruthy());
      expect(view.getByText(/My Server is reachable but has no models loaded/)).toBeTruthy();
      expect(route()).toBe('AdvancedSetup');
    });

    it('says the connection failed when the server stops answering before Connect', async () => {
      const { rtl, view, route, setLan } = await mountLoaded({
        savedServers: [{ name: 'My Server', endpoint: SERVER_ENDPOINT }],
        lan: servingModels(['llama3']),
      });

      const connect = await rtl.waitFor(() => view.getByText('Connect'));
      setLan({});
      await rtl.act(async () => { rtl.fireEvent.press(connect); });

      await rtl.waitFor(() => expect(view.getByText('Connection Failed')).toBeTruthy());
      expect(view.queryByText('Connected!')).toBeNull();
      expect(route()).toBe('AdvancedSetup');
    });
  });

  describe('Scan Network', () => {
    it('says no servers were found on an empty network, and offers Off Grid AI Desktop', async () => {
      const { rtl, view } = await mountLoaded({ lan: {} });
      expect(view.queryByText('No Servers Found')).toBeNull();

      await rtl.act(async () => { rtl.fireEvent.press(view.getByText('Scan network')); });

      await rtl.waitFor(() => expect(view.getByText('No Servers Found')).toBeTruthy());
      expect(view.getByText(/same WiFi network/)).toBeTruthy();
      expect(view.getAllByText('Get Off Grid AI Desktop').length).toBeGreaterThan(0);
    });

    it('says the scan failed when a found server cannot be saved because the keychain is locked', async () => {
      const { rtl, view } = await mountLoaded({ lan: servingModels(['llama3']) });
      const Keychain = require('react-native-keychain');
      Keychain.getGenericPassword.mockRejectedValue(new Error('User interaction is not allowed'));
      try {
        await rtl.act(async () => { rtl.fireEvent.press(view.getByText('Scan network')); });

        await rtl.waitFor(() => expect(view.getByText('Scan Failed')).toBeTruthy());
        expect(view.getByText(/Could not scan your network/)).toBeTruthy();
        expect(view.queryByText('No Servers Found')).toBeNull();
      } finally {
        Keychain.getGenericPassword.mockResolvedValue(false);
      }
    });
  });

  describe('curated LiteRT models', () => {
    it('offers the curated LiteRT cards on Android and downloads them under the curated parent id', async () => {
      const { rtl, view, device } = await mountLoaded({ platform: 'android', ramGB: 12 });
      const { LITERT_PARENT_ID } = require('../../../src/services/curatedLiteRTRegistry');

      await rtl.waitFor(() => expect(view.getByTestId('onboarding-litert-model-0')).toBeTruthy());
      expect(view.getByTestId('onboarding-litert-model-1')).toBeTruthy();

      await rtl.act(async () => { rtl.fireEvent.press(view.getByTestId('onboarding-litert-model-0-download')); });

      await rtl.waitFor(() => expect(device.nativeRows()).toHaveLength(1));
      expect(device.nativeRows()[0].modelId).toBe(LITERT_PARENT_ID);
      expect(device.nativeRows()[0].fileName).toMatch(/\.litertlm$/);
    });

    it('does not offer LiteRT cards on iOS', async () => {
      const { rtl, view } = await mountLoaded({ platform: 'ios' });

      await rtl.waitFor(() => expect(view.getByText('Qwen 3.5 0.8B')).toBeTruthy());
      expect(view.queryByTestId('onboarding-litert-model-0')).toBeNull();
    });
  });
});
