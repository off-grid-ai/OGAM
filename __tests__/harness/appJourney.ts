import type { DownloadedModel, ONNXImageModel } from '../../src/types';
import {
  installNativeBoundary,
  requireRTL,
  type InstallOpts,
  type NativeBoundary,
} from './nativeBoundary';

const APP_STORAGE_KEY = 'local-llm-app-storage';
const DOWNLOADED_MODELS_KEY = '@local_llm/downloaded_models';
const DOWNLOADED_IMAGE_MODELS_KEY = '@local_llm/downloaded_image_models';
const REQUIRED_MNN_FILES = [
  'pos_emb.bin',
  'token_emb.bin',
  'tokenizer.json',
  'unet.mnn',
  'unet.mnn.weight',
  'vae_decoder.mnn',
  'vae_decoder.mnn.weight',
  'clip_v2.mnn',
  'clip_v2.mnn.weight',
] as const;

export interface AppJourneyOptions {
  boundary?: InstallOpts;
  downloadedModels?: DownloadedModel[];
  /** Previously persisted app state, hydrated by the real Zustand persistence path. */
  persistedAppState?: Record<string, unknown>;
  beforeRender?: (context: {
    boundary: NativeBoundary;
    asyncStorage: typeof import('@react-native-async-storage/async-storage').default;
  }) => void | Promise<void>;
  /** Skip the existing-user Home assertion when a journey intentionally tests a different boot outcome. */
  waitForHome?: boolean;
}

async function renderApp() {
  // The repository-wide navigation shim is intentionally appropriate for tests
  // that mount one real screen. App journeys opt into the real navigator because
  // reaching the destination is part of the behavior they prove.
  jest.unmock('@react-navigation/native');
  const React = require('react');
  const rtl = requireRTL();
  const App = require('../../App').default;
  const view = rtl.render(React.createElement(App));

  await rtl.waitFor(
    () => {
      expect(view.queryByTestId('app-loading')).toBeNull();
    },
    { timeout: 15000 },
  );

  return { rtl, view };
}

/** Render the real App with the empty storage/filesystem state of a fresh install. */
export async function renderFreshApp(
  options: Pick<AppJourneyOptions, 'boundary' | 'beforeRender'> = {},
) {
  const boundary = installNativeBoundary({
    ...options.boundary,
    fs: true,
  });
  const asyncStorageModule = require('@react-native-async-storage/async-storage');
  const asyncStorage = (asyncStorageModule.default ??
    asyncStorageModule) as typeof import('@react-native-async-storage/async-storage').default;
  await asyncStorage.clear();
  await options.beforeRender?.({ boundary, asyncStorage });

  const rendered = await renderApp();
  return { boundary, asyncStorage, ...rendered };
}

function defaultDownloadedModel(
  documentDirectoryPath: string,
): DownloadedModel {
  const fileName = 'journey-model-Q4_K_M.gguf';
  return {
    id: `test/journey-model/${fileName}`,
    name: 'Journey Model',
    author: 'test',
    fileName,
    filePath: `${documentDirectoryPath}/models/${fileName}`,
    fileSize: 128 * 1024 * 1024,
    quantization: 'Q4_K_M',
    downloadedAt: '2026-01-01T00:00:00.000Z',
    engine: 'llama',
  };
}

/** Persist a complete downloaded MNN model at device boundaries for real App hydration/loading. */
export async function seedDownloadedMnnImageModel(
  boundary: NativeBoundary,
  asyncStorage: typeof import('@react-native-async-storage/async-storage').default,
  overrides: Partial<ONNXImageModel> = {},
): Promise<ONNXImageModel> {
  const id = overrides.id ?? 'journey-mnn';
  const modelPath = overrides.modelPath ?? `/docs/image_models/${id}`;
  const model: ONNXImageModel = {
    id,
    name: 'Journey Image',
    description: 'Full-app image generation fixture',
    modelPath,
    downloadedAt: '2026-07-17T00:00:00.000Z',
    size: 512 * 1024 * 1024,
    style: 'Image',
    backend: 'mnn',
    ...overrides,
  };
  REQUIRED_MNN_FILES.forEach(file =>
    boundary.fs!.seedFile(`${model.modelPath}/${file}`, 8 * 1024 * 1024),
  );
  await asyncStorage.setItem(
    DOWNLOADED_IMAGE_MODELS_KEY,
    JSON.stringify([model]),
  );
  return model;
}

/**
 * Render the real App in an existing-user state.
 *
 * Preconditions are written only to device boundaries before App is imported:
 * AsyncStorage represents a prior completed onboarding/download and the in-memory
 * filesystem contains the downloaded model files. App then performs its normal
 * hydration, initialization, model scan, and navigation selection.
 */
export async function renderMainApp(options: AppJourneyOptions = {}) {
  const boundary = installNativeBoundary({
    ...options.boundary,
    fs: true,
  });
  const asyncStorageModule = require('@react-native-async-storage/async-storage');
  const asyncStorage = (asyncStorageModule.default ??
    asyncStorageModule) as typeof import('@react-native-async-storage/async-storage').default;
  const documentDirectoryPath = boundary.fs!.DocumentDirectoryPath;
  const downloadedModels = options.downloadedModels ?? [
    defaultDownloadedModel(documentDirectoryPath),
  ];

  for (const model of downloadedModels) {
    boundary.fs!.seedFile(model.filePath, model.fileSize);
  }
  await asyncStorage.setItem(
    DOWNLOADED_MODELS_KEY,
    JSON.stringify(downloadedModels),
  );
  await asyncStorage.setItem(
    APP_STORAGE_KEY,
    JSON.stringify({
      state: {
        hasCompletedOnboarding: true,
        ...options.persistedAppState,
      },
      version: 0,
    }),
  );
  await options.beforeRender?.({ boundary, asyncStorage });

  const { rtl, view } = await renderApp();

  if (options.waitForHome !== false) {
    await rtl.waitFor(
      () => {
        expect(view.queryByTestId('app-loading')).toBeNull();
        expect(view.queryByTestId('home-screen')).not.toBeNull();
      },
      { timeout: 15000 },
    );
  }

  return { boundary, asyncStorage, rtl, view };
}

/**
 * Relaunch an existing-user App journey without rewriting its persisted state.
 * A fresh module graph recreates every Zustand store, while AsyncStorage and the
 * downloaded-model records remain the device boundaries from the prior launch.
 */
export async function relaunchMainApp(
  options: Pick<AppJourneyOptions, 'boundary'> = {},
) {
  jest.resetModules();
  const boundary = installNativeBoundary({
    ...options.boundary,
    fs: true,
  });
  const asyncStorageModule = require('@react-native-async-storage/async-storage');
  const asyncStorage = (asyncStorageModule.default ??
    asyncStorageModule) as typeof import('@react-native-async-storage/async-storage').default;
  const rawModels = await asyncStorage.getItem(DOWNLOADED_MODELS_KEY);
  const downloadedModels = rawModels
    ? (JSON.parse(rawModels) as DownloadedModel[])
    : [];
  for (const model of downloadedModels) {
    boundary.fs!.seedFile(model.filePath, model.fileSize);
  }

  const { rtl, view } = await renderApp();
  await rtl.waitFor(
    () => {
      expect(view.queryByTestId('app-loading')).toBeNull();
      expect(view.queryByTestId('home-screen')).not.toBeNull();
    },
    { timeout: 15000 },
  );
  return { boundary, asyncStorage, rtl, view };
}

export type RenderedAppJourney = Awaited<ReturnType<typeof renderMainApp>>;

/** Reach a new chat through the same Home model picker and navigation gestures a user performs. */
export async function openChatWithJourneyModel(
  rtl: RenderedAppJourney['rtl'],
  view: RenderedAppJourney['view'],
): Promise<void> {
  rtl.fireEvent.press(view.getByTestId('browse-models-button'));
  const model = await rtl.waitFor(() => view.getByTestId('model-item'));
  rtl.fireEvent.press(model);
  await rtl.waitFor(() =>
    expect(view.getByTestId('new-chat-button')).toBeTruthy(),
  );
  rtl.fireEvent.press(view.getByTestId('new-chat-button'));
  await rtl.waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());
}

/** Type and send through the rendered composer; callers assert the resulting product behavior. */
export function sendChatMessage(
  rtl: RenderedAppJourney['rtl'],
  view: RenderedAppJourney['view'],
  message: string,
): void {
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), message);
  rtl.fireEvent.press(view.getByTestId('send-button'));
}
