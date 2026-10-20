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
  const navigation = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn() } as any;
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
  });

  it('selects a device-fit plan, starts all model downloads, and activates it', async () => {
    const ui = render(
      <AutoSetupScreen
        navigation={navigation}
        sessionFactory={sessionFactory}
      />,
    );
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-plan-balanced')).toBeTruthy(),
    );

    expect(ui.getAllByText('INCLUDES')).toHaveLength(1);
    // Balanced aims at 4B: the catalog now offers Qwen 3.5 4B, which leads Gemma 4 E4B.
    expect(ui.getByText('Qwen 3.5 4B')).toBeTruthy();
    fireEvent.press(ui.getByTestId('auto-setup-plan-lean'));
    expect(ui.getByText('Qwen 3.5 2B')).toBeTruthy();
    expect(ui.queryByText('SmolVLM 2B')).toBeNull();
    fireEvent.press(ui.getByTestId('auto-setup-plan-extreme'));
    expect(ui.getByText('Qwen 3.5 9B')).toBeTruthy();
    expect(ui.queryByText('Qwen 3.5 4B')).toBeNull();
    expect(useAppStore.getState().settings.modelLoadingMode).toBe('aggressive');

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
    expect(navigation.replace).toHaveBeenCalledWith('Main');
  });

  it('keeps manual model and remote server setup in Advanced Setup', async () => {
    const ui = render(
      <AutoSetupScreen
        navigation={navigation}
        sessionFactory={sessionFactory}
      />,
    );
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
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-download')).toBeTruthy(),
    );

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
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-download')).toBeTruthy(),
    );
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
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-plan-balanced')).toBeTruthy(),
    );

    fireEvent.press(ui.getByTestId('auto-setup-download'));
    await waitFor(() =>
      expect(ui.getAllByText(/STARTING|0%/).length).toBeGreaterThan(0),
    );
    fireEvent.press(ui.getByTestId('auto-setup-plan-extreme'));

    expect(ui.getByText('Qwen 3.5 4B')).toBeTruthy();
    expect(ui.queryByText('Qwen 3.5 9B')).toBeNull();
    expect(useAppStore.getState().settings.modelLoadingMode).toBe('balanced');
    ui.unmount();
  });

  it('ends a stalled catalog request at its deadline', async () => {
    const stalledCatalog: AutoSetupCatalogBoundaries = {
      ...catalogBoundaries,
      fetchTextFiles: () => new Promise(() => undefined),
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
