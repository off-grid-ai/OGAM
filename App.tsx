/**
 * Off Grid - On-Device AI Chat Application
 * Private AI assistant that runs entirely on your device
 */

import 'react-native-gesture-handler';
import React, { useEffect, useState, useCallback } from 'react';
import { StatusBar, ActivityIndicator, View, StyleSheet, LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from './src/navigation';
import { useTheme } from './src/theme';
import { hardwareService, modelManager, authService, ragService, remoteServerManager } from './src/services';
import logger, { setLogListener } from './src/utils/logger';
import { useAppStore, useAuthStore, useRemoteServerStore } from './src/stores';
import { useDebugLogsStore } from './src/stores/debugLogsStore';
import { loadProFeatures } from './src/bootstrap/loadProFeatures';
import { configureRevenueCat, checkProStatus } from './src/services/proLicenseService';
import { hydrateDownloadStore } from './src/services/downloadHydration';
import { useDownloadListeners } from './src/hooks/useDownloads';
import { LockScreen } from './src/screens';
import { useAppState } from './src/hooks/useAppState';
import { useDownloadStore } from './src/stores/downloadStore';

LogBox.ignoreAllLogs(); // Suppress all logs

// Wire logger → in-app debug viewer (runs before any component mounts)
setLogListener((entry) => useDebugLogsStore.getState().addLog(entry));

const ensureRemoteServerStoreHydrated = async () => {
  const persistApi = useRemoteServerStore.persist;
  if (!persistApi?.hasHydrated || !persistApi.rehydrate) return;
  if (!persistApi.hasHydrated()) {
    await persistApi.rehydrate();
  }
};

function App() {
  useDownloadListeners();
  const [isInitializing, setIsInitializing] = useState(true);
  const setDeviceInfo = useAppStore((s) => s.setDeviceInfo);
  const setModelRecommendation = useAppStore((s) => s.setModelRecommendation);
  const setDownloadedModels = useAppStore((s) => s.setDownloadedModels);
  const setDownloadedImageModels = useAppStore((s) => s.setDownloadedImageModels);

  const { colors, isDark } = useTheme();

  const {
    isEnabled: authEnabled,
    isLocked,
    setLocked,
    setLastBackgroundTime,
  } = useAuthStore();

  const reattachTextDownloadRecovery = useCallback(async () => {
    const restoredIds = await modelManager.restoreInProgressDownloads();
    modelManager.startBackgroundDownloadPolling();
    restoredIds.forEach((downloadId) => {
      modelManager.watchDownload(
        downloadId,
        async () => {
          const models = await modelManager.getDownloadedModels();
          setDownloadedModels(models);
          useDownloadStore.getState().remove(
            useDownloadStore.getState().downloadIdIndex[downloadId] ?? '',
          );
        },
        (error: Error) => {
          logger.error('[App] Restored text download failed:', error);
          useDownloadStore.getState().setStatus(downloadId, 'failed', { message: error.message });
        },
      );
    });
  }, [setDownloadedModels]);

  // Handle app state changes for auto-lock
  useAppState({
    onBackground: useCallback(() => {
      if (authEnabled) {
        setLastBackgroundTime(Date.now());
        setLocked(true);
      }
    }, [authEnabled, setLastBackgroundTime, setLocked]),
    onForeground: useCallback(() => {
      // Rebuild the unified store before reattaching JS listeners so restored
      // progress events map onto current download entries instead of racing hydration.
      hydrateDownloadStore()
        .catch((error) => {
          logger.error('[App] Failed to hydrate download store on foreground:', error);
        })
        .finally(() => {
          reattachTextDownloadRecovery().catch((error) => {
            logger.error('[App] Failed to restore text downloads on foreground:', error);
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

  const initializeApp = useCallback(async () => {
    try {
      // Ensure persisted download metadata is loaded before restore logic reads it.
      await ensureAppStoreHydrated();

      // Hydrate download store from SQLite before any screen mounts.
      await hydrateDownloadStore().catch((error) => {
        logger.error('[App] Failed to hydrate download store during startup:', error);
      });
      await reattachTextDownloadRecovery();

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

      // Reconcile image model directories that finished extracting on disk but
      // whose AsyncStorage registration was lost to an app kill. Runs before
      // refreshModelLists so the recovered models are included in the initial
      // setDownloadedImageModels call. activeModelIds guards against touching
      // directories that are currently being downloaded/extracted.
      const activeImageModelIds = new Set(
        Object.values(useDownloadStore.getState().downloads)
          .filter(e => e.modelType === 'image')
          .map(e => e.modelId.replace('image:', '')),
      );
      await modelManager.reconcileFinishedImageDownloads(activeImageModelIds).catch((error) => {
        logger.error('[App] Image model reconciliation failed:', error);
      });

      // Scan for any models that may have been downloaded externally or
      // while the app was killed. hydrateDownloadStore (called on cold start
      // and foreground resume) repopulates in-flight downloads directly
      // from the native Room DB, replacing the old metadata-callback +
      // syncBackgroundDownloads recovery path.
      const { textModels, imageModels } = await modelManager.refreshModelLists();
      setDownloadedModels(textModels);
      setDownloadedImageModels(imageModels);

      // Ensure remote server store is hydrated before initializing providers,
      // so getServers() / activeServerId reads see persisted data.
      await ensureRemoteServerStoreHydrated();

      // Initialize remote server providers in the background — don't block
      // the home screen while fetching models from potentially unreachable servers.
      remoteServerManager.initializeProviders().catch((err) => {
        logger.error('[App] Failed to initialize remote server providers:', err);
      });

      // Check if passphrase is set and lock app if needed
      const hasPassphrase = await authService.hasPassphrase();
      if (hasPassphrase && authEnabled) {
        setLocked(true);
      }

      // Initialize RAG database tables
      ragService.ensureReady().catch((err) => logger.error('Failed to initialize RAG service on startup', err));

      // Configure RevenueCat and read the cached entitlement before Pro features load.
      // configureRevenueCat is sync; checkProStatus reads the keychain cache immediately
      // and fires a background RC network sync so the next launch stays fresh.
      configureRevenueCat();
      await checkProStatus();

      // Load pro features — only activates if the keychain entitlement is set.
      await loadProFeatures();

      // Show the UI immediately
      setIsInitializing(false);

      // Models are loaded on-demand when the user opens a chat,
      // not eagerly on startup, to avoid freezing the UI.
    } catch (error) {
      logger.error('[App] Error initializing app:', error);
      setIsInitializing(false);
    }
  }, [
    authEnabled,
    ensureAppStoreHydrated,
    reattachTextDownloadRecovery,
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
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaProvider>
          <View style={[styles.loadingContainer, { backgroundColor: colors.background }]} testID="app-loading">
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // Show lock screen if auth is enabled and app is locked
  if (authEnabled && isLocked) {
    return (
      <GestureHandlerRootView style={styles.flex} testID="app-locked">
        <SafeAreaProvider>
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
          <LockScreen onUnlock={handleUnlock} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
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

export default App;
