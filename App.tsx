/**
 * Off Grid - On-Device AI Chat Application
 * Private AI assistant that runs entirely on your device
 */

import 'react-native-gesture-handler';
import React, { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, View, StyleSheet, LogBox } from 'react-native';
import { SystemBars } from 'react-native-edge-to-edge';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from './src/navigation';
import { useTheme } from './src/theme';
import {
  hardwareService,
  modelManager,
  authService,
  ragService,
  remoteServerManager,
} from './src/services';
import logger from './src/utils/logger';
import {
  useAppStore,
  useAuthStore,
  useRemoteServerStore,
  useWhisperStore,
} from './src/stores';
import { useDebugLogsStore } from './src/stores/debugLogsStore';
import {
  initDebugLogFile,
  appendDebugLine,
  shutdownDebugLogFile,
} from './src/utils/debugLogFile';
import { loadProFeatures } from './src/bootstrap/loadProFeatures';
import { checkProStatus } from './src/services/proLicenseService';
import { hydrateDownloadStore } from './src/services/downloadHydration';
import { startLoadPolicySync } from './src/services/loadPolicySync';
import { useDownloadListeners } from './src/hooks/useDownloads';
import { useDownloadRecovery } from './src/hooks/useDownloadRecovery';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useSlot, SLOTS } from './src/bootstrap/slotRegistry';
import { LockScreen } from './src/screens';
import { useAppState } from './src/hooks/useAppState';
import { ErrorBoundary } from './src/components/ErrorBoundary';

LogBox.ignoreAllLogs(); // Suppress all logs

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
}

const ensureRemoteServerStoreHydrated = async () => {
  const persistApi = useRemoteServerStore.persist;
  if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
  if (!persistApi.hasHydrated()) {
    await persistApi.rehydrate();
  }
};

function App() {
  useDownloadListeners();
  const { reattachTextDownloadRecovery, recoverDownloadState } =
    useDownloadRecovery();
  useEffect(() => {
    if (!__DEV__) return undefined;
    initDebugLogFile();
    return shutdownDebugLogFile;
  }, []);
  // Reactive: when Pro is activated at runtime (license key → loadProFeatures),
  // the appRoot slot (TTS engine bridge) registers and this re-renders to mount
  // it live — no restart needed.
  const AppRoot = useSlot(SLOTS.appRoot);
  const [isInitializing, setIsInitializing] = useState(true);
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
      // Refresh the paid-feature entitlement whenever the app comes back online.
      // A revoked Keygen license tears down Pro routes/hooks/slots immediately;
      // offline failures preserve the cached entitlement in proLicenseService.
      checkProStatus().catch(error => {
        logger.error(
          '[App] Failed to refresh Pro entitlement on foreground:',
          error,
        );
      });
      // Rebuild the unified store before reattaching JS listeners so restored
      // progress events map onto current download entries instead of racing hydration.
      // NOTE: restoreQueuedDownloads() is intentionally NOT called here — on a foreground
      // resume the process was never killed, so backgroundDownloadService.startQueue (the
      // in-memory FIFO) is still the live source of truth for queued items. Replaying the
      // persisted queue here would DOUBLE-issue starts that are still waiting in memory.
      // Restore is a cold-start-only concern (the queue owner is gone only after a kill).
      hydrateDownloadStore()
        .catch(error => {
          logger.error(
            '[App] Failed to hydrate download store on foreground:',
            error,
          );
        })
        .finally(() => {
          reattachTextDownloadRecovery().catch(error => {
            logger.error(
              '[App] Failed to restore text downloads on foreground:',
              error,
            );
          });
        });
    }, [reattachTextDownloadRecovery]),
  });

  const ensureAppStoreHydrated = useCallback(async () => {
    const persistApi = useAppStore.persist;
    if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
    if (!persistApi.hasHydrated()) {
      await persistApi.rehydrate();
    }
  }, []);

  const ensureAuthStoreHydrated = useCallback(async () => {
    const persistApi = useAuthStore.persist;
    if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
    if (!persistApi.hasHydrated()) {
      await persistApi.rehydrate();
    }
  }, []);

  const initializeApp = useCallback(async () => {
    try {
      // Keep navigation behind the boot gate until both product state and the
      // persisted lock decision are known. Otherwise a slow auth-storage read can
      // briefly render the navigator before a cold-start lock arrives.
      await Promise.all([ensureAppStoreHydrated(), ensureAuthStoreHydrated()]);

      // Project the persisted "aggressive model loading" setting onto the residency
      // manager (single owner of the runtime load policy) now that settings are
      // hydrated, and keep it in sync for the app's lifetime.
      startLoadPolicySync();

      // Download-state recovery runs OFF the boot gate (fire-and-forget, order preserved
      // inside recoverDownloadState below): with many WorkManager downloads mid-flight the
      // native Room DB read (getActiveDownloads) sat ~9.5s behind write-lock contention
      // (device 2026-07-13, 9 active downloads) and the WHOLE app was hostage to it. The
      // download rows/badges are reactive projections — they fill in when recovery lands.
      recoverDownloadState();

      // Phase 1: Quick initialization - get app ready to show UI
      // Initialize hardware detection
      const deviceInfo = await hardwareService.getDeviceInfo();
      setDeviceInfo(deviceInfo);

      const recommendation = hardwareService.getModelRecommendation();
      setModelRecommendation(recommendation);

      // Initialize model manager and load downloaded models list
      await modelManager.initialize();

      // Clean up any mmproj files that were incorrectly added as standalone models
      await modelManager.cleanupMMProjEntries();

      // Scan for any models that may have been downloaded externally or
      // while the app was killed. hydrateDownloadStore (called on cold start
      // and foreground resume) repopulates in-flight downloads directly
      // from the native Room DB, replacing the old metadata-callback +
      // syncBackgroundDownloads recovery path.
      const { textModels, imageModels } =
        await modelManager.refreshModelLists();
      setDownloadedModels(textModels);
      setDownloadedImageModels(imageModels);

      // Ensure remote server store is hydrated before initializing providers,
      // so getServers() / activeServerId reads see persisted data.
      await ensureRemoteServerStoreHydrated();

      // Initialize remote server providers in the background — don't block
      // the home screen while fetching models from potentially unreachable servers.
      remoteServerManager.initializeProviders().catch(err => {
        logger.error(
          '[App] Failed to initialize remote server providers:',
          err,
        );
      });

      // Check if passphrase is set and lock app if needed
      const hasPassphrase = await authService.hasPassphrase();
      if (hasPassphrase && useAuthStore.getState().isEnabled) {
        setLocked(true);
      }

      // Initialize RAG database tables
      ragService
        .ensureReady()
        .catch(err =>
          logger.error('Failed to initialize RAG service on startup', err),
        );

      // Read the cached Pro entitlement before Pro features load. checkProStatus
      // returns the Keychain cache immediately and fires a background Keygen
      // revalidation so the next launch stays fresh.
      //
      // Pro is optional: a failure here (keychain locked, no network) must never
      // abort app init or hang the splash screen, so it is isolated and only logs.
      let isPro = false;
      try {
        isPro = await checkProStatus();
      } catch (proError) {
        logger.error(
          '[App] Pro check failed, continuing without entitlement:',
          proError,
        );
      }

      try {
        // Load pro features — only activates if the keychain entitlement is set
        // (or in dev, where loadProFeatures force-unlocks).
        await loadProFeatures(isPro);

        // Reconcile the persisted Pro flag with the actual entitlement on every
        // boot. Setting it to the resolved value (not only ever true) means a
        // cleared/expired license also flips it back to false — previously it
        // only ever went true, so a stale persisted true stuck forever.
        // DEV builds force-unlock for local testing, unless the Settings
        // "Turn off Pro (DEV)" toggle is set. Never force-unlocks in release.
        const devUnlock = __DEV__ && !useAppStore.getState().devProDisabled;
        useAppStore.getState().setHasRegisteredPro(isPro || devUnlock);
      } catch (proError) {
        logger.error(
          '[App] Pro feature load failed, continuing without Pro:',
          proError,
        );
      }

      // Show the UI immediately
      setIsInitializing(false);

      // Reconcile downloaded Whisper models against disk at startup. presentModelIds
      // isn't persisted (the filesystem is the source of truth), so it rehydrates
      // empty — without this scan a freshly launched app shows an already-installed
      // model (e.g. base.en) as "Download" and re-fetches the full file. Fire-and-
      // forget; the Models screen also refreshes on focus.
      useWhisperStore.getState().refreshPresentModels();

      // Models are intentionally NOT warmed at boot — a native model load is heavy
      // and contends with startup, leaving the whole app sluggish in that window.
      // They load lazily instead: the text model on chat entry / before the first
      // generation (useChatScreen + ensureModelLoaded), TTS/STT when those features
      // are first used. This keeps app launch responsive.
    } catch (error) {
      logger.error('[App] Error initializing app:', error);
      setIsInitializing(false);
    }
  }, [
    ensureAppStoreHydrated,
    ensureAuthStoreHydrated,
    recoverDownloadState,
    setDeviceInfo,
    setDownloadedImageModels,
    setDownloadedModels,
    setLocked,
    setModelRecommendation,
  ]);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  const handleUnlock = useCallback(() => {
    setLocked(false);
  }, [setLocked]);

  if (isInitializing) {
    return (
      <GestureHandlerRootView
        style={[styles.flex, { backgroundColor: colors.background }]}
      >
        <SafeAreaProvider>
          <View
            style={[
              styles.loadingContainer,
              { backgroundColor: colors.background },
            ]}
            testID="app-loading"
          >
            <SystemBars style={isDark ? 'light' : 'dark'} />
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // Show lock screen if auth is enabled and app is locked
  if (authEnabled && isLocked) {
    return (
      <GestureHandlerRootView
        style={[styles.flex, { backgroundColor: colors.background }]}
        testID="app-locked"
      >
        <SafeAreaProvider>
          <SystemBars style={isDark ? 'light' : 'dark'} />
          <LockScreen onUnlock={handleUnlock} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <SystemBars style={isDark ? 'light' : 'dark'} />
        {AppRoot ? <AppRoot /> : null}
        <NavigationContainer
          theme={{
            dark: isDark,
            colors: {
              primary: colors.primary,
              background: colors.background,
              card: colors.surface,
              text: colors.text,
              border: colors.border,
              notification: colors.primary,
            },
            fonts: {
              regular: {
                fontFamily: 'System',
                fontWeight: '400',
              },
              medium: {
                fontFamily: 'System',
                fontWeight: '500',
              },
              bold: {
                fontFamily: 'System',
                fontWeight: '700',
              },
              heavy: {
                fontFamily: 'System',
                fontWeight: '900',
              },
            },
          }}
        >
          <AppNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

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
