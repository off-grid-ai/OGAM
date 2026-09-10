/**
 * Off Grid - On-Device AI Chat Application
 * Private AI assistant that runs entirely on your device
 */

import 'react-native-gesture-handler';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { LogBox } from 'react-native';
import { useTheme } from './src/theme';
import {
  hardwareService,
  modelLibrary,
  authService,
  remoteServerManager,
} from './src/services';
import logger from './src/utils/logger';
import { useAppStore, useAuthStore, useRemoteServerStore } from './src/stores';
import { useDebugLogsStore } from './src/stores/debugLogsStore';
import { useWhisperStore } from './src/stores/whisperStore';
import { useModelSelectionStore } from './src/stores/modelSelectionStore';
import {
  initDebugLogFile,
  appendDebugLine,
  stopDebugLogFile,
} from './src/utils/debugLogFile';
import { startStartupMemoryProbe } from './src/services/startupMemoryProbe';
import { loadProFeatures } from './src/bootstrap/loadProFeatures';
import { createLoadPolicySync } from './src/services/loadPolicySync';
import {
  startMobileApplication,
  stopMobileApplication,
} from './src/services/composition/application';
import {
  refreshMobileModelServices,
} from './src/services/modelServices';
import {
  startNetworkReconnectWatcher,
  stopNetworkReconnectWatcher,
} from './src/services/networkReconnect';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useSlot, SLOTS } from './src/bootstrap/slotRegistry';
import { useAppState } from './src/hooks/useAppState';
import { applicationFacade } from './src/services/applicationFacade';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import {
  InitializingSurface,
  LockedSurface,
  MainSurface,
} from './src/bootstrap/AppSurfaces';
import { startContentPersistenceMigration } from './src/services/migrations/contentMigrationCoordinator';
import {
  ContentMigrationSurface,
  shouldBlockForContentMigration,
  useContentMigrationStatus,
} from './src/components/migrations/ContentMigrationSurface';

LogBox.ignoreAllLogs(); // Suppress all logs

let stopStartupProbe: (() => void) | null = null;
// Dev-only: mirror logger output into the in-app Debug Logs viewer. The whole block
// is behind __DEV__, so release builds keep main's no-op logger (zero logging cost).
if (__DEV__) {
  const fmt = (a: unknown): string => {
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    if (typeof a === 'string') return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  };
  const base = { log: logger.log, warn: logger.warn, error: logger.error };
  const tap =
    (level: 'log' | 'warn' | 'error') =>
    (...args: unknown[]) => {
      base[level](...args);
      const message = args.map(fmt).join(' ');
      try {
        useDebugLogsStore
          .getState()
          .addLog({ timestamp: Date.now(), level, message });
      } catch {
        /* never break logging */
      }
      // Persist to the on-device file sink so traces can be pulled over the cable
      // (RN 0.83 console logs don't reach Metro stdout or syslog). See debugLogFile.ts.
      try {
        appendDebugLine(level, message);
      } catch {
        /* never break logging */
      }
    };
  logger.log = tap('log');
  logger.warn = tap('warn');
  logger.error = tap('error');
  initDebugLogFile();
  // Immediately after the sink exists, so the first sample lands before anything heavy runs. The app
  // was being killed by iOS at launch with the log going silent half a second in; this says where it
  // stops and what memory was doing when it did.
  stopStartupProbe = startStartupMemoryProbe();
}

const ensureRemoteServerStoreHydrated = async () => {
  const persistApi = useRemoteServerStore.persist;
  if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
  if (!persistApi.hasHydrated()) {
    await persistApi.rehydrate();
  }
};

const ensureWhisperStoreHydrated = async () => {
  const persistApi = useWhisperStore.persist;
  if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
  if (!persistApi.hasHydrated()) {
    await persistApi.rehydrate();
  }
};

const ensureModelSelectionStoreHydrated = async () => {
  const persistApi = useModelSelectionStore.persist;
  if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
  if (!persistApi.hasHydrated()) await persistApi.rehydrate();
};

function stopMobileRuntime(loadPolicySync: ReturnType<typeof createLoadPolicySync>): void {
  stopNetworkReconnectWatcher();
  stopMobileApplication();
  loadPolicySync.dispose();
}

function App() {
  useEffect(
    () => () => {
      stopStartupProbe?.();
      stopStartupProbe = null;
      stopDebugLogFile();
    },
    [],
  );
  // Reactive: when Pro is activated at runtime (license key → loadProFeatures),
  // the appRoot slot (TTS engine bridge) registers and this re-renders to mount
  // it live — no restart needed.
  const AppRoot = useSlot(SLOTS.appRoot);
  const [isInitializing, setIsInitializing] = useState(true);
  const contentMigration = useContentMigrationStatus();
  const startupGeneration = useRef(0);
  const setDeviceInfo = useAppStore(s => s.setDeviceInfo);
  const setModelRecommendation = useAppStore(s => s.setModelRecommendation);
  const setDownloadedModels = useAppStore(s => s.setDownloadedModels);
  const setDownloadedImageModels = useAppStore(s => s.setDownloadedImageModels);
  const { colors, isDark } = useTheme();

  const {
    isEnabled: authEnabled,
    isLocked,
    setLocked,
    setLastBackgroundTime,
  } = useAuthStore();

  // Handle app state changes for auto-lock
  useAppState({
    onBackground: useCallback(() => {
      if (authEnabled) {
        setLastBackgroundTime(Date.now());
        setLocked(true);
      }
    }, [authEnabled, setLastBackgroundTime, setLocked]),
    onForeground: useCallback(() => {
      applicationFacade().models.refresh().then(outcome => {
        if (!outcome.ok) logger.error('[App] Failed to refresh models on foreground', outcome.failure);
      }).catch(error => logger.error('[App] Failed to refresh models on foreground', error));
    }, []),
  });

  const ensureAppStoreHydrated = useCallback(async () => {
    const persistApi = useAppStore.persist;
    if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
    if (!persistApi.hasHydrated()) {
      await persistApi.rehydrate();
    }
  }, []);

  const initializeApp = useCallback(
    async (
      generation: number,
      loadPolicySync: ReturnType<typeof createLoadPolicySync>,
    ) => {
      try {
        // Ensure persisted download metadata is loaded before restore logic reads it.
        logger.log('[BOOT] app store hydrate');
        await ensureAppStoreHydrated();

        // Copy released AsyncStorage content into the normalized SQLite target before later
        // application/UI milestones switch their read owner. Failure is projected reactively and
        // leaves the released stores untouched, so startup can continue without data loss.
        logger.log('[BOOT] workspace content migration');
        await startContentPersistenceMigration();

        // Phase 1: Quick initialization - get app ready to show UI
        // Initialize hardware detection
        logger.log('[BOOT] device info');
        const deviceInfo = await hardwareService.getDeviceInfo();
        setDeviceInfo(deviceInfo);

        const recommendation = hardwareService.getModelRecommendation();
        setModelRecommendation(recommendation);

        // Initialize model manager and load downloaded models list
        logger.log('[BOOT] model library initialize');
        await modelLibrary.initialize();

        // Clean up any mmproj files that were incorrectly added as standalone models
        logger.log('[BOOT] cleanup mmproj entries');
        await modelLibrary.cleanupMMProjEntries();

        // Publish the installed library cache used by legacy presentation surfaces. The
        // application root separately hydrates and recovers its one durable download owner.
        const { textModels, imageModels } =
          await modelLibrary.refreshModelLists();
        setDownloadedModels(textModels);
        setDownloadedImageModels(imageModels);

        // Ensure remote server store is hydrated before initializing providers,
        // so getServers() / activeServerId reads see persisted data.
        logger.log('[BOOT] remote server hydrate');
        await ensureRemoteServerStoreHydrated();

        // Hydrate the one selection store before Shared reconciles disk-backed inventory. The old
        // Whisper store is read only as an upgrade source when the selection store has no STT row.
        logger.log('[BOOT] model selection hydrate');
        await Promise.all([
          ensureModelSelectionStoreHydrated(),
          ensureWhisperStoreHydrated(),
        ]);

        try {
          // Pro supplies optional domain ports before core creates the single application root.
          logger.log('[BOOT] load pro features');
          await loadProFeatures();
        } catch (proError) {
          logger.error(
            '[App] Pro feature load failed, continuing without Pro:',
            proError,
          );
        }

        // Pro must register every application port before the first facade lookup constructs the
        // single root. The policy projection resolves that root, so it starts only after optional
        // ports are prepared and registered.
        if (generation !== startupGeneration.current) return;
        loadPolicySync.start();

        // Initialize remote server providers in the background — don't block
        // the home screen while fetching models from potentially unreachable servers.
        remoteServerManager
          .initializeProviders()
          .catch(err => {
            logger.error(
              '[App] Failed to initialize remote server providers:',
              err,
            );
          })
          .finally(() => {
            refreshMobileModelServices().catch(err =>
              logger.error('[App] Model refresh failed:', err),
            );
            if (generation !== startupGeneration.current) return;
            // Recovery and provider initialization both update the registry and remote-server store.
            // Start recovery only after initialization releases those owners. A failed initialization
            // must still start the watcher so a later network recovery can repair the connection.
            startNetworkReconnectWatcher();
          });

        // Check if passphrase is set and lock app if needed
        logger.log('[BOOT] auth passphrase check');
        const hasPassphrase = await authService.hasPassphrase();
        if (hasPassphrase && authEnabled) {
          setLocked(true);
        }

        // Start the single application root, including RAG and any registered Pro domains.
        try {
          await startMobileApplication();
        } catch (applicationError) {
          logger.error(
            'Failed to initialize the application on startup',
            applicationError,
          );
        }

        // Show the UI immediately
        logger.log('[BOOT] startup complete');
        setIsInitializing(false);

        // Models are intentionally NOT warmed at boot. A native model load is heavy
        // and contends with startup, leaving the whole app sluggish in that window.
        // Text, TTS, and STT load on demand. This keeps app launch responsive.
      } catch (error) {
        logger.error('[App] Error initializing app:', error);
        setIsInitializing(false);
      }
    },
    [
      authEnabled,
      ensureAppStoreHydrated,
      setDeviceInfo,
      setDownloadedImageModels,
      setDownloadedModels,
      setLocked,
      setModelRecommendation,
    ],
  );

  useEffect(() => {
    const loadPolicySync = createLoadPolicySync();
    const generation = ++startupGeneration.current;
    initializeApp(generation, loadPolicySync);
    return () => {
      startupGeneration.current += 1;
      stopMobileRuntime(loadPolicySync);
    };
  }, [initializeApp]);

  const handleUnlock = useCallback(() => setLocked(false), [setLocked]);

  if (shouldBlockForContentMigration(contentMigration)) {
    return <ContentMigrationSurface status={contentMigration} />;
  }

  if (isInitializing) {
    return <InitializingSurface colors={colors} isDark={isDark} />;
  }

  if (authEnabled && isLocked) {
    return (
      <LockedSurface
        colors={colors}
        isDark={isDark}
        onUnlock={handleUnlock}
      />
    );
  }

  return (
    <MainSurface
      AppRoot={AppRoot}
      colors={colors}
      isDark={isDark}
    />
  );
}

// KeyboardProvider drives react-native-keyboard-controller's edge-to-edge-aware
// keyboard avoidance (used by ChatScreen). It must sit above every screen, so
// wrap the whole app once here rather than per return-branch in App().
function AppWithProviders() {
  return (
    <ErrorBoundary>
      <KeyboardProvider>
        <App />
      </KeyboardProvider>
    </ErrorBoundary>
  );
}

export default AppWithProviders;
