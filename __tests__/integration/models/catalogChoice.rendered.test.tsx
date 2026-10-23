import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname !== 'huggingface.co' || !url.pathname.startsWith('/api/models/')) {
      throw new Error(`Unexpected network request: ${url.origin}${url.pathname}`);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: decodeURIComponent(url.pathname.slice('/api/models/'.length)), downloads: 0, likes: 0, siblings: [] }),
    } as Response;
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = originalFetch; });

describe('Model choice on the phone', () => {
  it('shows the recommended models’ capabilities on Models > Text', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 11 * GB, availBytes: 8 * GB } });
    const React = require('react');
    const { render, waitFor, within } = requireRTL();
    // The app reads the phone's memory at launch (Home), before the Models screen opens.
    await require('../../../src/services/hardware').hardwareService.getDeviceInfo();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    const screen = render(React.createElement(ModelsScreen));

    await waitFor(() => {
      const minicpm = within(screen.getByLabelText('MiniCPM5 2B'));
      expect(minicpm.getByText('MiniCPM5 2B')).toBeTruthy();
      expect(minicpm.getByLabelText('Thinking likely')).toBeTruthy();
      expect(minicpm.getByLabelText('Tool calling likely')).toBeTruthy();

      const gemma = within(screen.getByLabelText('Gemma 4 E2B'));
      expect(gemma.getByText('Gemma 4 E2B')).toBeTruthy();
      expect(gemma.getByLabelText('Vision')).toBeTruthy();
      expect(gemma.getByLabelText('Thinking likely')).toBeTruthy();
      expect(gemma.getByLabelText('Tool calling likely')).toBeTruthy();
    });
  });

  it('offers local file import as an upload action only on Models > Text', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB } });
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    const screen = render(React.createElement(ModelsScreen));

    const searchRow = await waitFor(() => screen.getByTestId('text-model-search-row'));
    expect(within(searchRow).getByTestId('search-input')).toBeTruthy();
    const upload = within(searchRow).getByTestId('import-local-model');
    expect(upload.props.accessibilityLabel).toBe('Import local file');
    fireEvent.press(upload);
    await waitFor(() => expect(screen.getByText('Invalid File')).toBeTruthy());

    fireEvent.press(screen.getByText('Image'));
    expect(screen.queryByTestId('import-local-model')).toBeNull();
    fireEvent.press(screen.getByText('Text'));
    expect(screen.getByTestId('import-local-model')).toBeTruthy();
  });

  it('opens the image picker directly from the Home model summary', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB } });
    const React = require('react');
    const { render, fireEvent, waitFor } = requireRTL();
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    const navigation = { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} };
    const home = render(React.createElement(HomeScreen, { navigation }));

    fireEvent.press(await waitFor(() => home.getByTestId('model-summary-image-open')));
    await waitFor(() => { expect(home.getByText('IMAGE MODEL')).toBeTruthy(); });
    expect(home.queryByText('TEXT MODEL')).toBeNull();
  });

  it('keeps size, quant, params and curated facts on a compact model card, without type, RAM or a trending mark', () => {
    installNativeBoundary();
    const React = require('react');
    const { render } = requireRTL();
    const { ModelCard } = require('../../../src/components/ModelCard');
    const card = render(React.createElement(ModelCard, {
      model: { id: 'sample/model', name: 'Sample Model', author: 'Sample', modelType: 'text', paramCount: 7, minRamGB: 8, downloads: 1200 },
      file: { name: 'sample-q4.gguf', size: 4 * GB, quantization: 'Q4_K_M' },
      compact: true,
      recommended: { chips: ['Fast'] },
    }));
    expect(card.getByText(/Q4_K_M.*7B params.*Fast/)).toBeTruthy();
    expect(card.queryByText(/Text|RAM/)).toBeNull();
    expect(card.queryByLabelText('Recommended')).toBeNull();
    expect(card.queryByText('Recommended')).toBeNull();
  });

  it('shows the iOS text picker estimate from GGUF metadata with one approximation mark', async () => {
    installNativeBoundary({
      llama: true,
      ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB },
      llamaModelInfo: {
        'general.architecture': 'qwen3',
        'qwen3.block_count': '36',
        'qwen3.attention.head_count': '32',
        'qwen3.attention.head_count_kv': '8',
        'qwen3.embedding_length': '4096',
        'qwen3.attention.key_length': '128',
        'qwen3.attention.value_length': '128',
        'qwen3.attention.sliding_window': '4096',
      },
    });
    const React = require('react');
    const { render, waitFor } = requireRTL();
    const { TextTab } = require('../../../src/components/ModelSelectorModal/TextTab');
    const model = createDownloadedModel({
      id: 'qwythos',
      name: 'Qwythos 9B',
      engine: 'llama',
      filePath: '/docs/models/qwythos.gguf',
      fileName: 'qwythos.gguf',
      fileSize: 5.5 * GB,
    });
    const picker = render(React.createElement(TextTab, {
      downloadedModels: [model],
      remoteModels: [],
      currentModelPath: null,
      currentRemoteModelId: null,
      isAnyLoading: false,
      onSelectModel: () => {},
      onSelectRemoteModel: () => {},
      onUnloadModel: () => {},
      onAddServer: () => {},
    }));

    await waitFor(() => {
      const hint = picker.getByText(/~\d+\.\d GB RAM/);
      const estimate = Number(String(hint.props.children).match(/~(\d+\.\d) GB RAM/)?.[1]);
      expect(estimate).toBeLessThan(7.2);
      expect(String(hint.props.children)).not.toMatch(/~~/);
    });
  });
});
