import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AutoSetupScreen } from '../../../src/screens/AutoSetupScreen';
import { type AutoSetupCatalogBoundaries } from '../../../src/services/autoSetupCatalog';
import {
  createAutoSetupSession,
  type AutoSetupDownloadBoundaries,
} from '../../../src/services/autoSetupService';
import { modelDownloadService } from '../../../src/services/modelDownloadService';
import type {
  DownloadProvider,
  ModelDownload,
  ModelDownloadStartRequest,
  ModelDownloadType,
} from '../../../src/services/modelDownloadService/types';
import { uniformDownloadId } from '../../../src/services/modelDownloadService/uniformId';
import { useAppStore } from '../../../src/stores';
import { useDownloadStore } from '../../../src/stores/downloadStore';
import { createDownloadedModel } from '../../utils/factories';

const MB = 1024 * 1024;
// The size the fake listing gives a repo follows its parameter count, read from the repo name
// ("Qwen3.5-4B", "gemma-4-E4B", "gemma-4-26B-A4B" → 26), so every catalog model is sized faithfully.
const parameterCount = (modelId: string): number => {
  const match = modelId.split('/').pop()!.match(/(\d+(?:\.\d+)?)B(?![a-z])/i);
  return match ? Number(match[1]) : 1;
};
const capabilities = {
  cancel: true,
  retry: true,
  remove: true,
  resumable: true,
  determinateProgress: true,
};

class NativeDownloadBoundary implements DownloadProvider {
  private downloads: ModelDownload[] = [];
  private readonly listeners = new Set<() => void>();
  completeOnStart = true;

  constructor(readonly modelType: ModelDownloadType) {}

  async list(): Promise<ModelDownload[]> {
    return this.downloads;
  }

  private begin(id: string, name: string, sizeBytes: number): Promise<void> {
    this.downloads = [
      {
        id: uniformDownloadId(this.modelType, id),
        modelType: this.modelType,
        name,
        sizeBytes,
        bytesDownloaded: this.completeOnStart ? sizeBytes : 0,
        progress: this.completeOnStart ? 1 : 0,
        status: this.completeOnStart ? 'completed' : 'downloading',
        capabilities,
      },
    ];
    this.listeners.forEach(listener => listener());
    return Promise.resolve();
  }

  start(request: ModelDownloadStartRequest): Promise<void> {
    if (request.modelType === 'text') {
      return this.begin(`${request.modelId}/${request.file.name}`, request.file.name, request.file.size);
    }
    if (request.modelType === 'image') {
      return this.begin(request.model.id, request.model.name, request.model.size);
    }
    if (request.modelType === 'video') {
      const size = request.model.files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
      return this.begin(request.model.id, request.model.name, size);
    }
    return this.begin(request.modelId, request.modelId, 1 * MB);
  }

  setProgress(progress: number): void {
    this.downloads = this.downloads.map(download => ({
      ...download,
      bytesDownloaded: download.sizeBytes * progress,
      progress,
      status: 'downloading',
    }));
    this.listeners.forEach(listener => listener());
  }

  complete(): void {
    this.downloads = this.downloads.map(download => ({
      ...download,
      bytesDownloaded: download.sizeBytes,
      progress: 1,
      status: 'completed',
    }));
    this.listeners.forEach(listener => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async cancel(): Promise<void> {
    this.downloads = [];
    this.listeners.forEach(listener => listener());
  }
  async retry(): Promise<void> {}
  async remove(): Promise<void> {
    this.downloads = [];
    this.listeners.forEach(listener => listener());
  }
}

const catalogBoundaries: AutoSetupCatalogBoundaries = {
  totalMemoryGB: () => 12,
  fetchTextFiles: async models =>
    Object.fromEntries(
      models.map(model => {
        const params = parameterCount(model.id);
        return [
          model.id,
          [
            {
              name: `${params}b.gguf`,
              size: params * 100 * MB,
              quantization: 'Q4_K_M',
              downloadUrl: `https://models.test/${params}b.gguf`,
            },
          ],
        ];
      }),
    ),
  imageRecommendation: async () => ({
    compatibleBackends: ['coreml'],
    recommendedModels: ['balanced image'],
    recommendedBackend: 'coreml',
    bannerText: 'Core ML is ready.',
  }),
  imageModels: async () => [
    {
      id: 'image-lean',
      name: 'Lean image',
      description: 'Lean image',
      size: 100 * MB,
      downloadUrl: 'https://models.test/image-lean',
      style: 'general',
      backend: 'coreml',
    },
    {
      id: 'image-balanced',
      name: 'Balanced image',
      description: 'Balanced image',
      size: 200 * MB,
      downloadUrl: 'https://models.test/image-balanced',
      style: 'general',
      backend: 'coreml',
    },
    {
      id: 'image-extreme',
      name: 'Extreme image',
      description: 'Extreme image',
      size: 300 * MB,
      downloadUrl: 'https://models.test/image-extreme',
      style: 'general',
      backend: 'coreml',
    },
  ],
};

describe('Auto Setup release journey', () => {
  const navigation = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), reset: jest.fn(), goBack: jest.fn(), canGoBack: () => false } as any;
  const textDownloads = new NativeDownloadBoundary('text');
  const imageDownloads = new NativeDownloadBoundary('image');
  const speechDownloads = new NativeDownloadBoundary('stt');
  let unregister: Array<() => void> = [];

  const downloadBoundaries: AutoSetupDownloadBoundaries = {
    start: request => modelDownloadService.start(request),
    list: () => modelDownloadService.list(),
    cancel: id => modelDownloadService.cancel(id),
    subscribe: listener => modelDownloadService.subscribe(listener),
  };

  const sessionFactory = () =>
    createAutoSetupSession({
      catalog: catalogBoundaries,
      downloads: downloadBoundaries,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.getState().updateSettings({ modelLoadingMode: 'balanced' });
    useAppStore.getState().setActiveModelId(null);
    useAppStore.getState().setActiveImageModelId(null);
    textDownloads.completeOnStart = true;
    imageDownloads.completeOnStart = true;
    speechDownloads.completeOnStart = true;
    unregister = [
      modelDownloadService.register(textDownloads),
      modelDownloadService.register(imageDownloads),
      modelDownloadService.register(speechDownloads),
    ];
  });

  afterEach(async () => {
    await Promise.all([
      textDownloads.remove(),
      imageDownloads.remove(),
      speechDownloads.remove(),
    ]);
    unregister.forEach(dispose => dispose());
    // A chat model left on the phone or on its way would make the next Start chatting skip its download.
    useDownloadStore.setState({ downloads: {} });
    useAppStore.setState({ downloadedModels: [], onboardingPicks: null });
  });

  it('selects a device-fit plan, starts all model downloads, and activates it', async () => {
    // Opened from the app (Choose models): the plans show at once and the download finishes here.
    const fromApp = { ...navigation, canGoBack: () => true };
    const ui = render(
      <AutoSetupScreen
        navigation={fromApp}
        sessionFactory={sessionFactory}
      />,
    );
    expect(ui.queryByTestId('auto-setup-back-to-quick-start')).toBeNull();
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-plan-balanced')).toBeTruthy(),
    );

    // Only the chosen plan is expanded, and a new person starts on Quick start: the best model under
    // 1 GB, so the first download finishes (PostHog 2026-11-09).
    expect(ui.getAllByTestId('auto-setup-selected-plan')).toHaveLength(1);
    expect(ui.getByText('Qwen 3.5 0.8B')).toBeTruthy();
    // Balanced and Extreme are this 12 GB phone's Balanced and Best picks (37759c684), ranked by
    // quality alone (shared afdb05f).
    fireEvent.press(ui.getByTestId('auto-setup-plan-heading-balanced'));
    expect(ui.getByText('MiniCPM5 2B')).toBeTruthy();
    expect(ui.queryByText('SmolVLM 2B')).toBeNull();
    fireEvent.press(ui.getByTestId('auto-setup-plan-heading-extreme'));
    expect(ui.getByText('Qwen 3.5 9B')).toBeTruthy();
    expect(ui.queryByText('MiniCPM5 2B')).toBeNull();
    // A tier only previews downloads; it never changes the live loading policy.
    expect(useAppStore.getState().settings.modelLoadingMode).toBe('balanced');

    // Text is preselected; image and speech-to-text are opt-in.
    fireEvent.press(ui.getByTestId('auto-setup-choice-image'));
    fireEvent.press(ui.getByTestId('auto-setup-choice-stt'));
    fireEvent.press(ui.getByTestId('auto-setup-download'));
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-continue')).toBeTruthy(),
    );
    expect(
      (await modelDownloadService.list()).map(item => item.modelType),
    ).toEqual(expect.arrayContaining(['text', 'image', 'stt']));

    fireEvent.press(ui.getByTestId('auto-setup-continue'));
    expect(useAppStore.getState().activeModelId).toContain(
      'unsloth/Qwen3.5-9B-GGUF',
    );
    expect(useAppStore.getState().activeImageModelId).toBe('image-extreme');
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('first launch: Choose another has a way back to Start chatting', async () => {
    const ui = render(<AutoSetupScreen navigation={navigation} sessionFactory={sessionFactory} />);
    fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-choose-another')));
    await waitFor(() => expect(ui.getByTestId('auto-setup-plan-lean')).toBeTruthy());
    expect(ui.queryByTestId('auto-setup-start-chatting')).toBeNull();

    fireEvent.press(ui.getByTestId('auto-setup-back-to-quick-start'));

    expect(ui.getByTestId('auto-setup-start-chatting')).toBeTruthy();
    expect(ui.queryByTestId('auto-setup-plan-lean')).toBeNull();
    expect(await modelDownloadService.list()).toEqual([]);
  });

  it('first launch: a download from the plans opens the chat at once, with the plan picked', async () => {
    // iPhone hand test 2026-11-19: a plan download kept the person on setup, away from the chat.
    textDownloads.completeOnStart = false;
    const ui = render(<AutoSetupScreen navigation={navigation} sessionFactory={sessionFactory} />);
    fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-choose-another')));
    fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-plan-heading-balanced')));
    expect(ui.getByText('MiniCPM5 2B')).toBeTruthy();

    fireEvent.press(ui.getByTestId('auto-setup-download'));

    await waitFor(() =>
      expect(navigation.reset).toHaveBeenCalledWith({
        index: 1,
        routes: [{ name: 'Main' }, { name: 'Chat', params: {} }],
      }),
    );
    const downloads = await modelDownloadService.list();
    expect(downloads.map(d => [d.modelType, d.status])).toEqual([['text', 'downloading']]);
    expect(downloads[0].name).not.toBe('Qwen3.5-0.8B-Q4_K_M.gguf');
    expect(downloads[0].name).toMatch(/MiniCPM/i);
  });

  it('Start chatting downloads Quick start and opens a chat at once', async () => {
    // PostHog 2026-11-19: a third of new people left setup without a download, and half of those who
    // started one left before it finished. One tap starts the small model and opens the chat.
    textDownloads.completeOnStart = false;
    const ui = render(<AutoSetupScreen navigation={navigation} sessionFactory={sessionFactory} />);
    await waitFor(() => expect(ui.getByTestId('auto-setup-start-chatting')).toBeTruthy());
    // The plans wait behind Choose another; the quick start model is named with its size.
    expect(ui.queryByTestId('auto-setup-plan-lean')).toBeNull();
    expect(ui.getByText(/Qwen 3\.5 0\.8B/)).toBeTruthy();

    fireEvent.press(ui.getByTestId('auto-setup-start-chatting'));

    await waitFor(() =>
      expect(navigation.reset).toHaveBeenCalledWith({
        index: 1,
        routes: [{ name: 'Main' }, { name: 'Chat', params: {} }],
      }),
    );
    const downloads = await modelDownloadService.list();
    expect(downloads.map(d => [d.modelType, d.status])).toEqual([['text', 'downloading']]);
    expect(downloads[0].name).toBe('Qwen3.5-0.8B-Q4_K_M.gguf');
  });

  it('chooses what the background downloads bring after setup is gone', async () => {
    textDownloads.completeOnStart = false;
    const ui = render(<AutoSetupScreen navigation={navigation} sessionFactory={sessionFactory} />);
    fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-start-chatting')));
    await waitFor(() => expect(navigation.reset).toHaveBeenCalled());
    ui.unmount();
    expect(useAppStore.getState().activeModelId).toBeNull();

    textDownloads.complete();

    // Continue used to do this, and only on the screen: a person who left never got the model chosen.
    await waitFor(() =>
      expect(useAppStore.getState().activeModelId).toContain('unsloth/Qwen3.5-0.8B-GGUF'),
    );
  });

  it('opens the chat for a chat model already on its way, and downloads no second one', async () => {
    // A bundled model pack, or a download started earlier: that one is the chat model.
    useDownloadStore.getState().add({
      modelKey: 'LiquidAI/LFM3-VL-2B-GGUF/LFM3-VL-2B-Q4_K_M.gguf',
      downloadId: 'bundled-pack:lfm3',
      modelId: 'LiquidAI/LFM3-VL-2B-GGUF',
      fileName: 'LFM3-VL-2B-Q4_K_M.gguf',
      quantization: 'Q4_K_M',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 0,
      totalBytes: 1,
      combinedTotalBytes: 1,
      progress: 0.3,
      createdAt: 1,
    } as never);
    const ui = render(<AutoSetupScreen navigation={navigation} sessionFactory={sessionFactory} />);
    // The line names the model coming, not Quick start's, and offers no download size.
    await waitFor(() => expect(ui.getByText('LFM3 VL 2B is on its way to this phone. Ask now. It answers as soon as it arrives.')).toBeTruthy());
    expect(ui.queryByText(/Qwen 3\.5 0\.8B/)).toBeNull();
    expect(ui.queryByText(/MB/)).toBeNull();
    fireEvent.press(ui.getByTestId('auto-setup-start-chatting'));

    await waitFor(() => expect(navigation.reset).toHaveBeenCalledWith({
      index: 1,
      routes: [{ name: 'Main' }, { name: 'Chat', params: {} }],
    }));
    expect(await modelDownloadService.list()).toEqual([]);
  });

  it('chooses a chat model already on the phone and opens the chat, with no download', async () => {
    useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'on-phone', name: 'On Phone' })], activeModelId: null });
    const ui = render(<AutoSetupScreen navigation={navigation} sessionFactory={sessionFactory} />);
    await waitFor(() => expect(ui.getByText('On Phone is ready on this phone. Ask now.')).toBeTruthy());
    expect(ui.queryByText(/Qwen 3\.5 0\.8B/)).toBeNull();
    fireEvent.press(ui.getByTestId('auto-setup-start-chatting'));

    await waitFor(() => expect(navigation.reset).toHaveBeenCalled());
    expect(useAppStore.getState().activeModelId).toBe('on-phone');
    expect(await modelDownloadService.list()).toEqual([]);
  });

  it('with a chat model on the phone, shows the picks and Start chatting still downloads the other ones', async () => {
    useAppStore.setState({
      downloadedModels: [createDownloadedModel({ id: 'on-phone', name: 'On Phone' })],
      activeModelId: null,
      onboardingPicks: { groups: ['chat', 'create'], parts: ['chat', 'images'] },
    });
    const ui = render(<AutoSetupScreen navigation={navigation} sessionFactory={sessionFactory} />);
    await waitFor(() => expect(ui.getByText('On Phone is ready on this phone. Ask now.')).toBeTruthy());
    // Start chatting reads as the end of the person's setup: their picks sit right above it.
    expect(ui.getByTestId('setup-picks')).toBeTruthy();
    fireEvent.press(ui.getByTestId('auto-setup-start-chatting'));

    await waitFor(() => expect(navigation.reset).toHaveBeenCalled());
    expect(useAppStore.getState().activeModelId).toBe('on-phone');
    // The picture model comes beside the chat model on the phone; no second chat model downloads.
    await waitFor(async () =>
      expect((await modelDownloadService.list()).map(d => d.modelType)).toEqual(['image']),
    );
  });

  it('stays on setup with Try Again when Start chatting cannot start the download', async () => {
    const refusing: AutoSetupDownloadBoundaries = {
      ...downloadBoundaries,
      start: () => Promise.reject({ message: 'No connection.' }),
    };
    const ui = render(
      <AutoSetupScreen
        navigation={navigation}
        sessionFactory={() => createAutoSetupSession({ catalog: catalogBoundaries, downloads: refusing })}
      />,
    );
    fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-start-chatting')));
    expect(await ui.findByText('No connection.')).toBeTruthy();
    expect(ui.getByTestId('auto-setup-retry')).toBeTruthy();
    expect(navigation.reset).not.toHaveBeenCalled();
  });

  it('keeps manual model and remote server setup in Advanced Setup', async () => {
    const ui = render(
      <AutoSetupScreen
        navigation={navigation}
        sessionFactory={sessionFactory}
      />,
    );
    // First launch leads with Start chatting; the plans are behind Choose another.
    fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-choose-another')));
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-advanced')).toBeTruthy(),
    );
    fireEvent.press(ui.getByTestId('auto-setup-advanced'));
    expect(navigation.push).toHaveBeenCalledWith('AdvancedSetup');
  });

  it('shows the failed model and cancels the other downloads as one session', async () => {
    textDownloads.completeOnStart = false;
    speechDownloads.completeOnStart = false;
    const failingDownloads: AutoSetupDownloadBoundaries = {
      ...downloadBoundaries,
      start: async request => {
        if (request.modelType === 'image') {
          return Promise.reject({ message: 'Image model download could not start.' });
        }
        return modelDownloadService.start(request);
      },
    };
    const ui = render(
      <AutoSetupScreen
        navigation={navigation}
        sessionFactory={() =>
          createAutoSetupSession({
            catalog: catalogBoundaries,
            downloads: failingDownloads,
          })
        }
      />,
    );
    // First launch leads with Start chatting; the plans are behind Choose another.
    fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-choose-another')));
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-download')).toBeTruthy(),
    );

    fireEvent.press(ui.getByTestId('auto-setup-choice-image'));
    fireEvent.press(ui.getByTestId('auto-setup-choice-stt'));
    fireEvent.press(ui.getByTestId('auto-setup-download'));

    await waitFor(() =>
      expect(
        ui.getByText('Image model download could not start.'),
      ).toBeTruthy(),
    );
    expect(ui.getByText(/FAILED/)).toBeTruthy();
    await waitFor(async () => {
      const active = (await modelDownloadService.list()).filter(
        download => download.status === 'downloading',
      );
      expect(active).toEqual([]);
    });
  });

  it('finishes when the last download ends while setup is still reading the one before', async () => {
    // Android 2026-11-19: an image zip finished extracting while setup was still listing the
    // 98% update; that last change was dropped, so setup sat at 98% with the model installed.
    textDownloads.completeOnStart = false;
    let holdList: Promise<void> | null = null;
    let listStarted: () => void = () => undefined;
    const slowList: AutoSetupDownloadBoundaries = {
      ...downloadBoundaries,
      list: async () => {
        const listed = await modelDownloadService.list();
        if (holdList) {
          listStarted();
          await holdList;
        }
        return listed;
      },
    };
    const ui = render(
      <AutoSetupScreen
        navigation={navigation}
        sessionFactory={() =>
          createAutoSetupSession({ catalog: catalogBoundaries, downloads: slowList })
        }
      />,
    );
    // First launch leads with Start chatting; the plans are behind Choose another.
    fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-choose-another')));
    await waitFor(() => expect(ui.getByTestId('auto-setup-download')).toBeTruthy());
    fireEvent.press(ui.getByTestId('auto-setup-download'));
    await waitFor(async () =>
      expect((await modelDownloadService.list()).map(d => d.status)).toEqual(['downloading']),
    );

    let release: () => void = () => undefined;
    holdList = new Promise(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { listStarted = resolve; });
    textDownloads.setProgress(0.98);
    await started;
    holdList = null;
    textDownloads.complete();
    release();

    await waitFor(() => expect(ui.getByTestId('auto-setup-continue')).toBeTruthy());
  });

  it('keeps central download records alive after setup unmounts', async () => {
    textDownloads.completeOnStart = false;
    imageDownloads.completeOnStart = false;
    speechDownloads.completeOnStart = false;
    const ui = render(
      <AutoSetupScreen
        navigation={navigation}
        sessionFactory={sessionFactory}
      />,
    );
    // First launch leads with Start chatting; the plans are behind Choose another.
    fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-choose-another')));
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-download')).toBeTruthy(),
    );
    fireEvent.press(ui.getByTestId('auto-setup-choice-image'));
    fireEvent.press(ui.getByTestId('auto-setup-choice-stt'));
    fireEvent.press(ui.getByTestId('auto-setup-download'));
    await waitFor(() =>
      expect(ui.getAllByText(/STARTING|0%/).length).toBeGreaterThan(0),
    );

    const beforeUnmount = await modelDownloadService.list();
    expect(beforeUnmount).toHaveLength(3);

    ui.unmount();

    await waitFor(async () => {
      const afterUnmount = await modelDownloadService.list();
      expect(afterUnmount.map(download => download.id)).toEqual(
        beforeUnmount.map(download => download.id),
      );
      expect(afterUnmount.every(download => download.status === 'downloading')).toBe(true);
    });

    textDownloads.setProgress(0.42);
    await waitFor(async () => {
      const text = (await modelDownloadService.list()).find(download => download.modelType === 'text');
      expect(text?.progress).toBe(0.42);
    });

    textDownloads.complete();
    await waitFor(async () => {
      const text = (await modelDownloadService.list()).find(download => download.modelType === 'text');
      expect(text?.status).toBe('completed');
      expect(text?.progress).toBe(1);
    });
  });

  it('keeps the selected plan fixed after its download session starts', async () => {
    textDownloads.completeOnStart = false;
    imageDownloads.completeOnStart = false;
    speechDownloads.completeOnStart = false;
    const ui = render(
      <AutoSetupScreen
        navigation={navigation}
        sessionFactory={sessionFactory}
      />,
    );
    // First launch leads with Start chatting; the plans are behind Choose another.
    fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-choose-another')));
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-plan-balanced')).toBeTruthy(),
    );

    fireEvent.press(ui.getByTestId('auto-setup-download'));
    await waitFor(() =>
      expect(ui.getAllByText(/STARTING|0%/).length).toBeGreaterThan(0),
    );
    fireEvent.press(ui.getByTestId('auto-setup-plan-heading-extreme'));

    // The plan that started (Quick start, the default) stays: its model shows, Extreme's does not.
    expect(ui.getByText('Qwen 3.5 0.8B')).toBeTruthy();
    expect(ui.queryByText('Qwen 3.5 9B')).toBeNull();
    expect(useAppStore.getState().settings.modelLoadingMode).toBe('balanced');
    ui.unmount();
  });

  it('ends a stalled catalog request at its deadline', async () => {
    const stalledCatalog: AutoSetupCatalogBoundaries = {
      ...catalogBoundaries,
      // Chat plans come from the bundled picks (37759c684); the image catalog is still a live load.
      imageModels: () => new Promise(() => undefined),
    };
    const ui = render(
      <AutoSetupScreen
        navigation={navigation}
        sessionFactory={() =>
          createAutoSetupSession({
            catalog: stalledCatalog,
            downloads: downloadBoundaries,
            catalogDeadlineMs: 5,
          })
        }
      />,
    );

    expect(
      await ui.findByText('The model catalog did not respond in time.'),
    ).toBeTruthy();
    ui.unmount();
  });
});
