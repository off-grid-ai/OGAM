import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, ModelCard } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { RemoteServerModal } from '../components/RemoteServerModal';
import { useTheme, useThemedStyles } from '../theme';
import { getUserFacingDownloadMessage } from '../utils/downloadErrors';
import type { ThemeColors, ThemeShadows } from '../theme';
import { RECOMMENDED_MODELS, TRENDING_FAMILIES, TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';
import { useDownloadStore, isActiveStatus } from '../stores/downloadStore';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { hardwareService, modelManager, remoteServerManager } from '../services';
import { discoverLANServers } from '../services/networkDiscovery';
import { ModelFile, DownloadedModel, RemoteServer } from '../types';
import { RootStackParamList } from '../navigation/types';
import { fetchModelFiles, NetworkSection } from './ModelDownloadHelpers';
import {
  LITERT_PARENT_ID,
  buildCuratedLiteRTFiles,
  getCuratedLiteRTEntry,
  CuratedLiteRTEntry,
} from '../services/curatedLiteRTRegistry';
import { makeModelKey } from '../utils/modelKey';
import logger from '../utils/logger';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'ModelDownload'> };

interface RecommendedCardProps {
  model: typeof RECOMMENDED_MODELS[number];
  recFile: ModelFile;
  index: number;
  progress: { progress: number } | null | undefined;
  downloaded: DownloadedModel | undefined;
  totalRamGB: number;
  isTrending: boolean;
  onDownload: () => void;
  onCancel: () => void;
}

const RecommendedModelCard: React.FC<RecommendedCardProps> = ({ model, recFile, index, progress, downloaded, totalRamGB, isTrending, onDownload, onCancel }) => (
  <ModelCard
    key={model.id}
    testID={`recommended-model-${index}`}
    compact
    model={{ id: model.id, name: model.name, author: model.id.split('/')[0], description: model.description, modelType: model.type, paramCount: model.params, minRamGB: model.minRam }}
    file={recFile}
    downloadedModel={downloaded}
    isDownloaded={!!downloaded}
    isDownloading={!!progress}
    downloadProgress={progress?.progress}
    isCompatible={model.minRam <= totalRamGB && (!model.maxRam || totalRamGB <= model.maxRam)}
    isTrending={isTrending}
    onPress={() => {}}
    onDownload={downloaded ? undefined : onDownload}
    onCancel={progress ? onCancel : undefined}
  />
);

interface LiteRTCardProps {
  file: ModelFile;
  index: number;
  curatedEntry: CuratedLiteRTEntry | undefined;
  progress: { progress: number } | null | undefined;
  downloaded: DownloadedModel | undefined;
  totalRamGB: number;
  onDownload: () => void;
  onCancel: () => void;
}

// Curated LiteRT models surface at the top of the on-device list (Android only;
// the LiteRT engine is Android-only). They download straight through the same
// handlers as the GGUF cards — `file.downloadUrl` and the `.litertlm` extension
// route the request to the LiteRT engine with no extra wiring.
const LiteRTModelCard: React.FC<LiteRTCardProps> = ({ file, index, curatedEntry, progress, downloaded, totalRamGB, onDownload, onCancel }) => (
  <ModelCard
    testID={`litert-model-${index}`}
    compact
    model={{ id: LITERT_PARENT_ID, name: curatedEntry?.displayName ?? file.name, author: 'google', description: curatedEntry?.highlight, modelType: 'vision' }}
    file={file}
    downloadedModel={downloaded}
    isDownloaded={!!downloaded}
    isDownloading={!!progress}
    downloadProgress={progress?.progress}
    isCompatible={file.size / (1024 ** 3) < totalRamGB * 0.6}
    recommended={{ pillLabel: 'Recommended', highlightText: curatedEntry?.highlight }}
    onPress={() => {}}
    onDownload={downloaded ? undefined : onDownload}
    onCancel={progress ? onCancel : undefined}
  />
);

export const ModelDownloadScreen: React.FC<Props> = ({ navigation }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [recommendedModels, setRecommendedModels] = useState<typeof RECOMMENDED_MODELS>([]);
  const [modelFiles, setModelFiles] = useState<Record<string, ModelFile[]>>({});
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [connectingServerId, setConnectingServerId] = useState<string | null>(null);
  const [connectedServerId, setConnectedServerId] = useState<string | null>(null);
  const [reachableServerIds, setReachableServerIds] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [isCheckingNetwork, setIsCheckingNetwork] = useState(true);
  const [showServerModal, setShowServerModal] = useState(false);
  const healthCheckInFlight = useRef(false);

  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const { deviceInfo, setDeviceInfo, setModelRecommendation, addDownloadedModel, downloadedModels } = useAppStore();
  const storeDownloads = useDownloadStore(s => s.downloads);
  const servers = useRemoteServerStore((s) => s.servers);
  const discoveredModels = useRemoteServerStore((s) => s.discoveredModels);

  // Init hardware + model recommendations
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await hardwareService.getDeviceInfo();
        if (cancelled) return;
        setDeviceInfo(info);
        const rec = hardwareService.getModelRecommendation();
        if (cancelled) return;
        setModelRecommendation(rec);
        const ram = hardwareService.getTotalMemoryGB();
        const compat = RECOMMENDED_MODELS.filter((m) => m.minRam <= ram && (!m.maxRam || ram <= m.maxRam));
        if (cancelled) return;
        setRecommendedModels(compat);
        const files = await fetchModelFiles(compat);
        if (!cancelled) setModelFiles(files);
      } catch (error) {
        logger.error('Error initializing:', error);
        if (!cancelled) setAlertState(showAlert('Error', 'Failed to initialize. Please try again.'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Health-check persisted servers — only show reachable ones
  const refreshServerHealth = useCallback(async (): Promise<Set<string>> => {
    if (healthCheckInFlight.current) return new Set<string>();
    healthCheckInFlight.current = true;
    setIsCheckingNetwork(true);
    const store = useRemoteServerStore.getState();
    const reachable = new Set<string>();
    await Promise.all(
      store.servers.map(async (server) => {
        try {
          const result = await store.testConnection(server.id);
          if (result.success) reachable.add(server.id);
        } catch { /* offline */ }
      }),
    );
    setReachableServerIds(reachable);
    setIsCheckingNetwork(false);
    healthCheckInFlight.current = false;
    return reachable;
  }, []);

  useEffect(() => { refreshServerHealth(); }, [servers.length, refreshServerHealth]);

  // Scan network handler
  const handleScanNetwork = useCallback(async () => {
    setIsScanning(true);
    try {
      const discovered = await discoverLANServers();
      const store = useRemoteServerStore.getState();
      const existing = new Set(store.servers.map(s => s.endpoint.replace(/\/$/, '')));
      for (const d of discovered) {
        if (existing.has(d.endpoint.replace(/\/$/, ''))) continue;
        await remoteServerManager.addServer({ name: d.name, endpoint: d.endpoint, providerType: 'openai-compatible' });
      }
      const reachable = await refreshServerHealth();
      // Only alert if there are truly no reachable servers after the scan
      if (reachable.size === 0) {
        setAlertState(showAlert('No Servers Found', 'Make sure you\'re on the same WiFi network as your server and that it\'s running.'));
      }
    } catch (e) {
      logger.warn('[ModelDownload] Scan failed:', (e as Error).message);
      setAlertState(showAlert('Scan Failed', 'Could not scan your network. Make sure you are connected to WiFi.'));
    } finally {
      setIsScanning(false);
    }
  }, [refreshServerHealth]);

  // Cancel goes through the store: removing the entry by modelKey is the
  // single source of truth, and the native cancel cleans up the worker.
  const handleCancelDownload = async (modelId: string, fileName: string) => {
    const modelKey = makeModelKey(modelId, fileName);
    const entry = useDownloadStore.getState().downloads[modelKey];
    if (!entry) return;
    useDownloadStore.getState().remove(modelKey);
    try { await modelManager.cancelBackgroundDownload(entry.downloadId); } catch { /* ignore */ }
    if (entry.mmProjDownloadId) {
      try { await modelManager.cancelBackgroundDownload(entry.mmProjDownloadId); } catch { /* ignore */ }
    }
  };

  const handleDownload = async (modelId: string, file: ModelFile) => {
    const modelKey = makeModelKey(modelId, file.name);
    // Duplicate-start guard. The store's add() also enforces this, but
    // checking up-front avoids the unnecessary native call.
    const existing = useDownloadStore.getState().downloads[modelKey];
    if (existing && isActiveStatus(existing.status)) return;
    const onError = (error: Error) => {
      // The store now holds the failed state — UI shows it, no need to
      // clear progress here. Only surface the alert.
      setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(error.message)));
    };
    try {
      // modelManager.downloadModelBackground writes the row to SQLite and
      // adds the entry to useDownloadStore synchronously after start.
      const info = await modelManager.downloadModelBackground(modelId, file);
      modelManager.watchDownload(info.downloadId, (model: DownloadedModel) => {
        addDownloadedModel(model);
        useDownloadStore.getState().remove(modelKey);
      }, onError);
    } catch (error) { onError(error as Error); }
  };

  const handleConnectServer = async (server: RemoteServer) => {
    setConnectingServerId(server.id);
    try {
      const result = await remoteServerManager.testConnection(server.id);
      if (!result.success) {
        setAlertState(showAlert('Connection Failed', result.error || 'Could not connect to server.'));
        return;
      }
      setConnectedServerId(server.id);
      const models = discoveredModels[server.id] || result.models || [];
      if (models.length === 0) {
        setAlertState(showAlert('Connected — No Models Found', `${server.name} is reachable but has no models loaded. Start a model in Ollama/LM Studio, then reconnect.`));
        return;
      }
      const textModel = models.find(m => !m.capabilities.supportsVision) || models[0];
      if (textModel) await remoteServerManager.setActiveRemoteTextModel(server.id, textModel.id);
      setAlertState(showAlert('Connected!', `${server.name} is ready with ${models.length} model${models.length === 1 ? '' : 's'}. You can start chatting now.`,
        [{ text: 'Continue', onPress: () => { setAlertState(hideAlert()); navigation.replace('Main'); } }]));
    } catch (e) { setAlertState(showAlert('Connection Failed', (e as Error).message)); }
    finally { setConnectingServerId(null); }
  };

  const handleServerSaved = useCallback(() => {
    setShowServerModal(false);
    refreshServerHealth();
  }, [refreshServerHealth]);

  const totalRamGB = hardwareService.getTotalMemoryGB();

  // Curated LiteRT models — Android-only, filtered to what fits in RAM (same
  // 60%-of-RAM headroom the model browser uses). No HF fetch needed; the files
  // come straight from the curated registry with their download URLs baked in.
  const liteRTFiles = React.useMemo(
    () => (Platform.OS === 'android'
      ? buildCuratedLiteRTFiles().filter((f) => f.size / (1024 ** 3) < totalRamGB * 0.6)
      : []),
    [totalRamGB],
  );

  const handleLiteRTDownload = (file: ModelFile) => {
    const curatedEntry = getCuratedLiteRTEntry(file.name);
    const proceed = () => handleDownload(LITERT_PARENT_ID, file);
    if (curatedEntry?.confirmDownload) {
      setAlertState(showAlert(
        curatedEntry.confirmDownload.title,
        curatedEntry.confirmDownload.message,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setAlertState(hideAlert()) },
          { text: 'Download anyway', style: 'default', onPress: () => { setAlertState(hideAlert()); proceed(); } },
        ],
      ));
      return;
    }
    proceed();
  };

  // One best-fit trending model per family (ideal ≈ 40% of RAM, penalise > 75%)
  const trendingModelIds = React.useMemo(() => {
    const score = (m: (typeof RECOMMENDED_MODELS)[number]) => {
      const ratio = m.minRam / totalRamGB;
      const penalty = ratio > 0.75 ? (ratio - 0.75) * 4 : 0;
      return Math.abs(ratio - 0.4) + penalty;
    };
    const ids = new Set<string>();
    for (const familyIds of Object.values(TRENDING_FAMILIES)) {
      const best = RECOMMENDED_MODELS
        .filter(m => familyIds.includes(m.id) && m.minRam <= totalRamGB && (!m.maxRam || totalRamGB <= m.maxRam))
        .sort((a, b) => score(a) - score(b))[0];
      if (best) ids.add(best.id);
    }
    return ids;
  }, [totalRamGB]);

  const liveServers = servers.filter((s) => reachableServerIds.has(s.id));

  if (isLoading) return (
    <SafeAreaView style={styles.container}>
      <View testID="model-download-loading" style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Analyzing your device...</Text>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View testID="model-download-screen" style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Set Up Your AI</Text>
            <Text style={styles.subtitle}>
              Connect to a model server on your network, or download one to run directly on your device.
            </Text>
          </View>

          <NetworkSection
            servers={liveServers}
            discoveredModels={discoveredModels}
            connectingServerId={connectingServerId}
            connectedServerId={connectedServerId}
            isCheckingNetwork={isCheckingNetwork}
            isScanning={isScanning}
            onConnectServer={handleConnectServer}
            onScanNetwork={handleScanNetwork}
            onAddManually={() => setShowServerModal(true)}
            colors={colors}
          />

          <Text style={styles.sectionTitle}>Download to Your Device</Text>

          <Card style={styles.deviceCard}>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceLabel}>Your Device</Text>
              <Text style={styles.deviceValue}>{deviceInfo?.deviceModel}</Text>
            </View>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceLabel}>Available Memory</Text>
              <Text style={styles.deviceValue}>{hardwareService.formatBytes(deviceInfo?.availableMemory || 0)}</Text>
            </View>
          </Card>

          {liteRTFiles.map((file, index) => {
            const modelKey = makeModelKey(LITERT_PARENT_ID, file.name);
            const dlEntry = storeDownloads[modelKey];
            const progress = dlEntry && isActiveStatus(dlEntry.status)
              ? { progress: dlEntry.progress }
              : null;
            return (
              <LiteRTModelCard
                key={file.name}
                file={file}
                index={index}
                curatedEntry={getCuratedLiteRTEntry(file.name)}
                progress={progress}
                downloaded={downloadedModels.find(d => d.id === `${LITERT_PARENT_ID}/${file.name}`)}
                totalRamGB={totalRamGB}
                onDownload={() => handleLiteRTDownload(file)}
                onCancel={() => handleCancelDownload(LITERT_PARENT_ID, file.name)}
              />
            );
          })}

          {recommendedModels.filter((model) => modelFiles[model.id]?.length).map((model, index) => {
            const recFile = modelFiles[model.id][0];
            const modelKey = makeModelKey(model.id, recFile.name);
            const entry = storeDownloads[modelKey];
            const progress = entry && isActiveStatus(entry.status)
              ? { progress: entry.progress }
              : null;
            return (
              <RecommendedModelCard
                key={model.id}
                model={model}
                recFile={recFile}
                index={index}
                progress={progress}
                downloaded={downloadedModels.find(d => d.id === `${model.id}/${recFile.name}`)}
                totalRamGB={totalRamGB}
                isTrending={trendingModelIds.has(model.id)}
                onDownload={() => handleDownload(model.id, recFile)}
                onCancel={() => handleCancelDownload(model.id, recFile.name)}
              />
            );
          })}

          {recommendedModels.length === 0 && liteRTFiles.length === 0 && (
            <Card style={styles.warningCard}>
              <Text style={styles.warningTitle}>Limited Compatibility</Text>
              <Text style={styles.warningText}>Your device has limited memory. You can still browse and download smaller models from the model browser.</Text>
            </Card>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Button title="Skip for Now" variant="ghost" onPress={() => navigation.replace('Main')} testID="model-download-skip" />
        </View>

        <CustomAlert visible={alertState.visible} title={alertState.title} message={alertState.message} buttons={alertState.buttons} onClose={() => setAlertState(hideAlert())} />
        <RemoteServerModal visible={showServerModal} onClose={() => setShowServerModal(false)} onSave={handleServerSaved} />
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const, gap: 16 },
  loadingText: { ...TYPOGRAPHY.body, color: colors.textSecondary, textAlign: 'center' as const },
  scrollView: { flex: 1 },
  content: { padding: 16, paddingBottom: 100 },
  header: { marginBottom: SPACING.xl },
  title: { ...TYPOGRAPHY.h2, color: colors.text, marginBottom: 8 },
  subtitle: { ...TYPOGRAPHY.body, color: colors.textSecondary, lineHeight: 24 },
  sectionTitle: { ...TYPOGRAPHY.h2, color: colors.text, marginBottom: SPACING.lg },
  deviceCard: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, marginBottom: SPACING.xl },
  deviceInfo: { flex: 1 },
  deviceLabel: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginBottom: 4 },
  deviceValue: { ...TYPOGRAPHY.body, color: colors.text },
  warningCard: { backgroundColor: `${colors.warning}20`, borderWidth: 1, borderColor: colors.warning },
  warningTitle: { ...TYPOGRAPHY.h3, color: colors.warning, marginBottom: 8 },
  warningText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, lineHeight: 20 },
  footer: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
});
