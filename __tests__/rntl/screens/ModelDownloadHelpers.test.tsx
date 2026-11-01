/**
 * Advanced Setup's network pieces and its file picker.
 *
 * NetworkSection and ServerCard render for real with the real theme, Card and Touchable. What their
 * buttons DO (scan, add a server, connect) is driven end to end on the real screen in
 * ModelDownloadScreen.test.tsx; here each state the section and card can be in is checked as the
 * person sees it.
 *
 * fetchModelFiles runs the real huggingFaceService against Hugging Face's API faked at fetch
 * (hfModelApiServer), on an iPhone (nativeBoundary), where a curated download takes Q4_K_M only.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { useTheme } from '../../../src/theme';
import { NetworkSection, ServerCard } from '../../../src/screens/ModelDownloadHelpers';
import type { RemoteServer } from '../../../src/types';
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { serveHfModelApi, type HfModelApiServer } from '../../harness/hfModelApiServer';

const OLLAMA: RemoteServer = {
  id: 'server-1',
  name: 'Ollama (192.168.1.10)',
  endpoint: 'http://192.168.1.10:11434',
  providerType: 'openai-compatible',
  createdAt: '2024-01-01',
};

const LM_STUDIO: RemoteServer = {
  id: 'server-2',
  name: 'LM Studio (192.168.1.20)',
  endpoint: 'http://192.168.1.20:1234',
  providerType: 'openai-compatible',
  createdAt: '2024-01-01',
};

const noop = () => {};

type SectionProps = Omit<React.ComponentProps<typeof NetworkSection>, 'colors'>;
type CardProps = Omit<React.ComponentProps<typeof ServerCard>, 'colors'>;

/** The section in the app's theme, as Advanced Setup renders it. */
function Section(props: Partial<SectionProps>) {
  const { colors } = useTheme();
  return (
    <NetworkSection
      servers={[]}
      discoveredModels={{}}
      connectingServerId={null}
      connectedServerId={null}
      isCheckingNetwork={false}
      isScanning={false}
      onConnectServer={noop}
      onScanNetwork={noop}
      onAddManually={noop}
      {...props}
      colors={colors}
    />
  );
}

function Server(props: Partial<CardProps>) {
  const { colors } = useTheme();
  return (
    <ServerCard
      server={OLLAMA}
      modelCount={3}
      isConnecting={false}
      isConnected={false}
      onConnect={noop}
      {...props}
      colors={colors}
    />
  );
}

describe('NetworkSection', () => {
  it('with nothing found, says so and offers Off Grid AI Desktop, Scan Network and Add Server', () => {
    const view = render(<Section />);

    expect(view.getByText('Network Models')).toBeTruthy();
    expect(view.getByText('No Off Grid AI Desktop, Ollama, or LM Studio server found. Scan again or add one.')).toBeTruthy();
    expect(view.getByTestId('onboarding-get-desktop')).toBeTruthy();
    expect(view.getByText('Scan Network')).toBeTruthy();
    expect(view.getByText('Add Server')).toBeTruthy();
    expect(view.queryByText('Scanning your network...')).toBeNull();
  });

  it('while the first check runs with no servers, shows it is scanning and holds the Scan button', () => {
    const view = render(<Section isCheckingNetwork />);

    expect(view.getByText('Scanning your network...')).toBeTruthy();
    expect(view.queryByText('Scan Network')).toBeNull();
    expect(view.getByText('Add Server')).toBeTruthy();
  });

  it('lists each server found, and a recheck does not hide them behind the scanning line', () => {
    const view = render(<Section isCheckingNetwork servers={[OLLAMA, LM_STUDIO]} />);

    expect(view.getByTestId('discovered-server-server-1')).toBeTruthy();
    expect(view.getByTestId('discovered-server-server-2')).toBeTruthy();
    expect(view.queryByText('Scanning your network...')).toBeNull();
    expect(view.queryByText('Scan Network')).toBeNull();
  });

  it('while a scan runs, the Scan button shows it is busy', () => {
    const view = render(<Section isScanning />);

    expect(view.queryByText('Scan Network')).toBeNull();
    expect(view.getByText('Add Server')).toBeTruthy();
  });

  it('marks the connected server, and only that one', () => {
    const view = render(<Section servers={[OLLAMA, LM_STUDIO]} connectedServerId="server-2" />);

    expect(view.getByTestId('discovered-server-server-2-connected')).toBeTruthy();
    expect(view.getByTestId('discovered-server-server-1-connect')).toBeTruthy();
    expect(view.queryByTestId('discovered-server-server-1-connected')).toBeNull();
  });
});

describe('ServerCard', () => {
  it('names the server and its kind by port: Ollama on 11434, LM Studio on 1234', () => {
    const ollama = render(<Server />);
    expect(ollama.getByText('Ollama (192.168.1.10)')).toBeTruthy();
    expect(ollama.getByText('Ollama · 3 models')).toBeTruthy();
    ollama.unmount();

    const studio = render(<Server server={LM_STUDIO} />);
    expect(studio.getByText('LM Studio · 3 models')).toBeTruthy();
  });

  it.each([
    [3, 'Ollama · 3 models'],
    [1, 'Ollama · 1 model'],
    [0, 'Ollama · Tap to connect'],
  ])('with %i models, reads "%s"', (modelCount, meta) => {
    const view = render(<Server modelCount={modelCount} />);
    expect(view.getByText(meta)).toBeTruthy();
  });

  it('shows Connect until it connects, a spinner while connecting, then Connected', () => {
    const idle = render(<Server />);
    expect(idle.getByText('Connect')).toBeTruthy();
    expect(idle.queryByText('Connected')).toBeNull();
    idle.unmount();

    const connecting = render(<Server isConnecting />);
    expect(connecting.queryByText('Connect')).toBeNull();
    expect(connecting.queryByText('Connected')).toBeNull();
    connecting.unmount();

    const connected = render(<Server isConnected />);
    expect(connected.getByTestId('discovered-server-server-1-connected')).toBeTruthy();
    expect(connected.getByText('Connected')).toBeTruthy();
    expect(connected.queryByTestId('discovered-server-server-1-connect')).toBeNull();
  });
});

describe('fetchModelFiles', () => {
  let hf: HfModelApiServer;
  const realFetch = globalThis.fetch;

  afterEach(() => {
    hf?.restore();
    globalThis.fetch = realFetch;
  });

  /** An iPhone whose Hugging Face serves `test/model` with these files. */
  function phoneWith(files: string[] | null) {
    installNativeBoundary({ ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 4 * GB } });
    hf = serveHfModelApi(
      files === null ? { status: 500 } : { repos: { 'test/model': files.map((path, i) => ({ path, size: (i + 3) * GB })) } },
    );
    const { fetchModelFiles } = require('../../../src/screens/ModelDownloadHelpers');
    return fetchModelFiles as typeof import('../../../src/screens/ModelDownloadHelpers').fetchModelFiles;
  }

  it('picks the Q4_K_M file, wherever it is listed', async () => {
    const fetchModelFiles = phoneWith(['model-Q4_K_S.gguf', 'model-Q8_0.gguf', 'model-Q4_K_M.gguf']);

    const result = await fetchModelFiles([{ id: 'test/model' }]);

    expect(result['test/model']).toHaveLength(1);
    expect(result['test/model'][0]).toEqual(expect.objectContaining({ name: 'model-Q4_K_M.gguf', quantization: 'Q4_K_M', size: 5 * GB }));
  });

  it('leaves the model out when there is no Q4_K_M; Q4_K_S and Q4_0 do not count', async () => {
    const fetchModelFiles = phoneWith(['model-Q4_K_S.gguf', 'model-Q4_0.gguf', 'model-Q8_0.gguf', 'model-Q6_K.gguf']);

    const result = await fetchModelFiles([{ id: 'test/model' }]);

    expect(result['test/model']).toBeUndefined();
  });

  it('leaves the model out when Hugging Face does not answer', async () => {
    const fetchModelFiles = phoneWith(null);

    const result = await fetchModelFiles([{ id: 'test/model' }]);

    expect(result).toEqual({});
  });
});
