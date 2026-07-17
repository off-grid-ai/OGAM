import type { DownloadedModel } from '../../src/types';
import {
  installNativeBoundary,
  requireRTL,
  type InstallOpts,
  type NativeBoundary,
} from './nativeBoundary';

const APP_STORAGE_KEY = 'local-llm-app-storage';
const DOWNLOADED_MODELS_KEY = '@local_llm/downloaded_models';

export interface AppJourneyOptions {
  boundary?: InstallOpts;
  downloadedModels?: DownloadedModel[];
  /** Previously persisted app state, hydrated by the real Zustand persistence path. */
  persistedAppState?: Record<string, unknown>;
  beforeRender?: (context: {
    boundary: NativeBoundary;
    asyncStorage: typeof import('@react-native-async-storage/async-storage').default;
  }) => void | Promise<void>;
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
  options: Pick<AppJourneyOptions, 'boundary'> = {},
) {
  const boundary = installNativeBoundary({
    ...options.boundary,
    fs: true,
  });
  const asyncStorageModule = require('@react-native-async-storage/async-storage');
  const asyncStorage = (asyncStorageModule.default ??
    asyncStorageModule) as typeof import('@react-native-async-storage/async-storage').default;
  await asyncStorage.clear();

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

  await rtl.waitFor(
    () => {
      expect(view.queryByTestId('app-loading')).toBeNull();
      expect(view.queryByTestId('home-screen')).not.toBeNull();
    },
    { timeout: 15000 },
  );

  return { boundary, asyncStorage, rtl, view };
}
