/**
 * App startup tests
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

const appState = {
  setDeviceInfo: jest.fn(),
  setModelRecommendation: jest.fn(),
  setDownloadedModels: jest.fn(),
  setDownloadedImageModels: jest.fn(),
  clearImageModelDownloading: jest.fn(),
  setBackgroundDownload: jest.fn(),
  addDownloadedModel: jest.fn(),
  setDownloadProgress: jest.fn(),
  activeBackgroundDownloads: {
    42: {
      modelId: 'test/model',
      fileName: 'model.gguf',
      quantization: 'Q4_K_M',
      author: 'test',
      totalBytes: 1000,
    },
  },
};

const authState = {
  isEnabled: false,
  isLocked: false,
  setLocked: jest.fn(),
  setLastBackgroundTime: jest.fn(),
};

const mockUseAppStore = Object.assign(
  (selector?: (state: typeof appState) => unknown) => (selector ? selector(appState) : appState),
  {
    getState: () => appState,
    persist: { hasHydrated: () => true, rehydrate: jest.fn() },
  },
);

const mockUseAuthStore = Object.assign(
  (selector?: (state: typeof authState) => unknown) => (selector ? selector(authState) : authState),
  {
    getState: () => authState,
  },
);

const mockUseRemoteServerStore = Object.assign(
  () => ({}),
  {
    persist: { hasHydrated: () => true, rehydrate: jest.fn() },
  },
);

const mockModelManager = {
  initialize: jest.fn(() => Promise.resolve()),
  cleanupMMProjEntries: jest.fn(() => Promise.resolve()),
  setBackgroundDownloadMetadataCallback: jest.fn(),
  syncBackgroundDownloads: jest.fn(() => Promise.resolve([])),
  syncCompletedImageDownloads: jest.fn(() => Promise.resolve([])),
  reconcileFinishedImageDownloads: jest.fn(() => Promise.resolve([])),
  // Current API: no args, returns the ids of downloads that were still in flight
  // when the app was killed. App then watches each to completion.
  restoreInProgressDownloads: jest.fn(() => Promise.resolve(['restored-1'])),
  startBackgroundDownloadPolling: jest.fn(),
  getDownloadedModels: jest.fn(() => Promise.resolve([])),
  refreshModelLists: jest.fn(() => Promise.resolve({ textModels: [], imageModels: [] })),
  watchDownload: jest.fn(),
};
const mockInitializeProviders = jest.fn(() => Promise.resolve());
const mockStartNetworkReconnectWatcher = jest.fn();

jest.mock('../src/navigation', () => ({
  AppNavigator: () => null,
}));

jest.mock('../src/screens', () => ({
  LockScreen: () => null,
}));

jest.mock('../src/theme', () => ({
  useTheme: () => ({
    colors: { background: '#fff', primary: '#000' },
    isDark: false,
  }),
  // ErrorBoundary's fallback calls useThemedStyles(createStyles); without it the
  // fallback itself throws ("useThemedStyles is not a function"), masking any real
  // startup error behind a secondary crash.
  useThemedStyles: (fn: (colors: any, shadows: any) => any) =>
    fn({ background: '#fff', primary: '#000', text: '#000', textSecondary: '#666', textMuted: '#999', surface: '#eee', border: '#ccc' }, {}),
}));

jest.mock('../src/hooks/useAppState', () => ({
  useAppState: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockUseWhisperStore = Object.assign(
  () => ({}),
  { getState: () => ({ refreshPresentModels: jest.fn() }) },
);

jest.mock('../src/stores', () => ({
  useAppStore: mockUseAppStore,
  useAuthStore: mockUseAuthStore,
  useRemoteServerStore: mockUseRemoteServerStore,
  useWhisperStore: mockUseWhisperStore,
}));

// Startup side-effect modules — mocked so initializeApp proceeds deterministically
// to the download-restore step instead of blocking on real SQLite / keychain I/O.
jest.mock('../src/services/downloadHydration', () => ({
  hydrateDownloadStore: jest.fn(() => Promise.resolve()),
}));
jest.mock('../src/services/modelServices/downloadBootstrap', () => ({
  registerCoreDownloadProviders: jest.fn(),
}));
jest.mock('../src/services/proLicenseService', () => ({
  checkProStatus: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../src/bootstrap/loadProFeatures', () => ({
  loadProFeatures: jest.fn(() => Promise.resolve()),
}));
jest.mock('../src/hooks/useDownloads', () => ({
  useDownloadListeners: jest.fn(),
}));
jest.mock('../src/services/loadPolicySync', () => ({
  createLoadPolicySync: jest.fn(() => ({ start: jest.fn(), dispose: jest.fn() })),
}));
jest.mock('../src/services/networkReconnect', () => ({
  startNetworkReconnectWatcher: mockStartNetworkReconnectWatcher,
  stopNetworkReconnectWatcher: jest.fn(),
}));
jest.mock('../src/utils/debugLogFile', () => ({
  initDebugLogFile: jest.fn(),
  appendDebugLine: jest.fn(),
  stopDebugLogFile: jest.fn(),
}));

jest.mock('../src/services', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(() => Promise.resolve({ totalMemory: 8 * 1024 * 1024 * 1024 })),
    getModelRecommendation: jest.fn(() => ({ maxParameters: 7, recommendedQuantization: 'Q4_K_M' })),
  },
  modelLibrary: mockModelManager,
  authService: {
    hasPassphrase: jest.fn(() => Promise.resolve(false)),
  },
  ragService: {
    ensureReady: jest.fn(() => Promise.resolve()),
  },
  remoteServerManager: {
    initializeProviders: mockInitializeProviders,
  },
}));

// NOTE: App is required INSIDE the test, not imported at top level. The jest.mock
// factories above are hoisted above the `const mock*` definitions; a top-level
// `import App` is hoisted too and would run those factories BEFORE the consts
// initialize, so every mocked hook (useAppStore, modelLibrary, …) captured
// `undefined` → "useAppStore is not a function" during render. Requiring App from
// inside the test defers the factories until the consts exist.

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitializeProviders.mockResolvedValue(undefined);
  });

  it('restores in-flight downloads at startup and watches each to completion', async () => {
    const App = require('../App').default;
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      // Flush the async startup chain (hydrate → reattach → restore → watch).
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    // Current startup restore: called with no args (the persisted map + progress
    // callback API was removed when download recovery moved to the downloadStore).
    expect(mockModelManager.restoreInProgressDownloads).toHaveBeenCalled();
    // Each restored id is re-attached via watchDownload so it finishes in the
    // background, and polling is resumed.
    expect(mockModelManager.startBackgroundDownloadPolling).toHaveBeenCalled();
    expect(mockModelManager.watchDownload).toHaveBeenCalledWith(
      'restored-1',
      expect.any(Function),
      expect.any(Function),
    );
    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });

  it('starts reconnect recovery only after remote provider initialization settles', async () => {
    let finishInitialization: (() => void) | undefined;
    mockInitializeProviders.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishInitialization = resolve;
    }));

    const App = require('../App').default;
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    expect(mockInitializeProviders).toHaveBeenCalledTimes(1);
    expect(mockStartNetworkReconnectWatcher).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      finishInitialization?.();
      await Promise.resolve();
    });

    expect(mockStartNetworkReconnectWatcher).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });

  it('does not start reconnect recovery when provider initialization settles after unmount', async () => {
    let finishInitialization: (() => void) | undefined;
    mockInitializeProviders.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishInitialization = resolve;
    }));

    const App = require('../App').default;
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
    await ReactTestRenderer.act(async () => {
      finishInitialization?.();
      await Promise.resolve();
    });

    expect(mockStartNetworkReconnectWatcher).not.toHaveBeenCalled();
  });
});
