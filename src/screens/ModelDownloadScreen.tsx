import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, ModelCard } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { RemoteServerModal } from '../components/RemoteServerModal';
import { useTheme, useThemedStyles } from '../theme';
import { getUserFacingDownloadMessage } from '../utils/downloadErrors';
import { isAccelerableQuant } from '../utils/acceleration';
import type { ThemeColors, ThemeShadows } from '../theme';
import { RECOMMENDED_MODELS, TYPOGRAPHY, SPACING, OFF_GRID_DESKTOP_URL } from '../constants';
import { withUtm } from '../utils/utm';
import { useAppStore } from '../stores';
import { useDownloadStore, isActiveStatus } from '../stores/downloadStore';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { hardwareService, modelManager, remoteServerManager } from '../services';
import { startModelDownload } from '../services/startModelDownload';
import { recommendedModelsForDevice, trendingModelIdsForDevice } from '../utils/recommendedModels';
import { fileExceedsBudget } from '../services/memoryBudget';
import { discoverLANServers } from '../services/networkDiscovery';
import { ModelFile, DownloadedModel, RemoteServer } from '../types';
import { RootStackParamList } from '../navigation/types';
import { fetchModelFiles, NetworkSection } from './ModelDownloadHelpers';
import {
  LITERT_PARENT_ID,
  buildCuratedLiteRTFiles,
  getCuratedLiteRTEntry,
  curatedLiteRTDownloadWarning,
  CuratedLiteRTEntry,
} from '../services/curatedLiteRTRegistry';
import { makeModelKey } from '../utils/modelKey';
import logger from '../utils/logger';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'ModelDownload'> };

interface RecommendedCardProps {
  model: typeof RECOMMENDED_MODELS[number];
  recFile: ModelFile;
  index: number;
  progress: { progress: number; queued?: boolean; bytes?: { downloaded: number; total: number } } | null | undefined;
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
    isDownloading={!!progress && !progress.queued}
    isQueued={!!progress?.queued}
    downloadProgress={progress?.progress}
    downloadBytes={progress?.bytes}
    isCompatible={model.minRam <= totalRamGB && (!model.maxRam || totalRamGB <= model.maxRam)}
    isTrending={isTrending}
    supportsAcceleration={isAccelerableQuant(recFile.quantization)}
    onPress={() => {}}
    onDownload={downloaded ? undefined : onDownload}
    onCancel={progress ? onCancel : undefined}
  />
);

interface LiteRTCardProps {
  file: ModelFile;
  index: number;
  curatedEntry: CuratedLiteRTEntry | undefined;
  progress: { progress: number; queued?: boolean; bytes?: { downloaded: number; total: number } } | null | undefined;
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
    isDownloading={!!progress && !progress.queued}
    isQueued={!!progress?.queued}
    downloadProgress={progress?.progress}
    downloadBytes={progress?.bytes}
    // Offer the card (enable its download button) when the file fits the budget OR carries a
    // device-aware warning — the "Download anyway" sheet in handleLiteRTDownload is the guard for
    // the over-budget case. Both branches route through the single owners (fileExceedsBudget +
    // curatedLiteRTDownloadWarning), never a re-inlined budget calc. A card disabled here would make
    // its warning branch unreachable (button disabled), which was the #510 defect.
    isCompatible={!fileExceedsBudget(file.size, totalRamGB) || curatedLiteRTDownloadWarning(file.name, file.size, totalRamGB) !== null}
    recommended={{ pillLabel: 'Recommended' }}
    supportsAcceleration
    onPress={() => {}}
    onDownload={downloaded ? undefined : onDownload}
    onCancel={progress ? onCancel : undefined}
  />
);

/** Active-download progress for a card, or null when the model isn't downloading.
 *  `queued` (store status 'pending') drives the "Queued" label vs a live progress bar.
 *  `bytes` feeds the shared card's "X MB / Y MB" line so onboarding matches the
 *  Text/Image/STT tabs (same ModelCard, same props) instead of showing % only. */
export function downloadProgressFor(
  entry: { status: string; progress: number; bytesDownloaded?: number; totalBytes?: number; combinedTotalBytes?: number; mmProjBytesDownloaded?: number } | undefined,
): { progress: number; queued: boolean; bytes?: { downloaded: number; total: number } } | null {
  if (!entry || !isActiveStatus(entry.status as any)) return null;
  const total = entry.combinedTotalBytes ?? entry.totalBytes ?? 0;
  const downloaded = (entry.bytesDownloaded ?? 0) + (entry.mmProjBytesDownloaded ?? 0);
  return {
    progress: entry.progress,
    queued: entry.status === 'pending',
    bytes: total > 0 ? { downloaded, total } : undefined,
  };
}

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

  const { deviceInfo, setDeviceInfo, setModelRecommendation, downloadedModels } = useAppStore();
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
        // Same curated list as the Models screen, filtered to this device's RAM.
        const compat = recommendedModelsForDevice(ram);
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

  // Health-check persisted servers — only show reachable ones.
  // Returns { ran, reachable }: `ran` is false when the in-flight guard short-circuited this call
  // (another check is already running), so callers can distinguish "checked and found nothing" from
  // "did not actually check". The reachable set is only authoritative when `ran` is true.
  const refreshServerHealth = useCallback(async (): Promise<{ ran: boolean; reachable: Set<string> }> => {
    if (healthCheckInFlight.current) return { ran: false, reachable: new Set<string>() };
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
    return { ran: true, reachable };
  }, []);

  useEffect(() => { refreshServerHealth(); }, [servers.length, refreshServerHealth]);

  // Scan network handler
  const handleScanNetwork = useCallback(async () => {
    setIsScanning(true);
    try {
      const discovered = await discoverLANServers();
      const store = useRemoteServerStore.getState();
      const existing = new Set(store.servers.map(s => s.endpoint.replace(/\/$/, '')));
      let added = 0;
      for (const d of discovered) {
        if (existing.has(d.endpoint.replace(/\/$/, ''))) continue;
        await remoteServerManager.addServer({ name: d.name, endpoint: d.endpoint, providerType: 'openai-compatible' });
        added += 1;
      }
      const { ran, reachable } = await refreshServerHealth();
      // The alert must AGREE with the rendered list: never claim "no servers" while one is present or
      // was just discovered. Show it only when the scan genuinely found nothing on the network — no
      // server discovered/added, none already listed, AND a real check ran (not short-circuited by the
      // in-flight auto-check) that found nothing reachable. If the check was skipped by the in-flight
      // guard, the auto-check that owns it will settle the reachable list, so we do not alert.
      const noServersPresent = added === 0 && useRemoteServerStore.getState().servers.length === 0;
      if (noServersPresent && ran && reachable.size === 0) {
        setAlertState(showAlert(
          'No Servers Found',
          'Make sure you\'re on the same WiFi network as your server and that it\'s running. Off Grid AI Desktop serves its models to this phone over your network.',
          [
            { text: 'Dismiss', style: 'cancel' },
            { text: 'Get Off Grid AI Desktop', onPress: () => Linking.openURL(withUtm(OFF_GRID_DESKTOP_URL, 'model-download')).catch(() => {}) },
          ],
        ));
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
    // Same mechanism as the Models screen (startModelDownload) — guard, register, and
    // clear are shared; onboarding just surfaces the failure alert.
    await startModelDownload(modelId, file, {
      onError: (error) => setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(error.message))),
    });
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
        setAlertState(showAlert('Connected — No Models Found', `${server.name} is reachable but has no models loaded. Start a model in Off Grid AI Desktop, Ollama, or LM Studio, then reconnect.`));
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

  // Curated LiteRT models — Android-only. Offer a file when it FITS the RAM budget, OR when it is
  // over budget but carries a device-aware warning (e.g. Gemma 4 E4B): those download behind the
  // "Download anyway" confirm sheet (handleLiteRTDownload) rather than being silently hidden. An
  // over-budget file with NO warning stays hidden — there is no safe way to offer it. The decision
  // is the single owners (fileExceedsBudget + curatedLiteRTDownloadWarning), not a re-inlined budget
  // calc; hiding warnable files here made the warning branch dead code (#510). No HF fetch needed;
  // the files come straight from the curated registry with their download URLs baked in.
  const liteRTFiles = React.useMemo(
    () => (Platform.OS === 'android'
      ? buildCuratedLiteRTFiles().filter((f) =>
        !fileExceedsBudget(f.size, totalRamGB)
        || curatedLiteRTDownloadWarning(f.name, f.size, totalRamGB) !== null)
      : []),
    [totalRamGB],
  );

  const handleLiteRTDownload = (file: ModelFile) => {
    const proceed = () => handleDownload(LITERT_PARENT_ID, file);
    // Same DEVICE-AWARE decision the Models tab uses (curatedLiteRTDownloadWarning):
    // warn only when the file genuinely exceeds this device's RAM budget, never a
    // device-blind static flag. On a device where the model fits, no warning.
    const warning = curatedLiteRTDownloadWarning(file.name, file.size, totalRamGB);
    if (warning) {
      setAlertState(showAlert(
        warning.title,
        warning.message,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setAlertState(hideAlert()) },
          { text: 'Download anyway', style: 'default', onPress: () => { setAlertState(hideAlert()); proceed(); } },
        ],
      ));
      return;
    }
    proceed();
  };

  // One best-fit trending model per family — shared with the Models screen's scoring.
  const trendingModelIds = React.useMemo(() => trendingModelIdsForDevice(totalRamGB), [totalRamGB]);

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
            const progress = downloadProgressFor(storeDownloads[modelKey]);
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
            const progress = downloadProgressFor(storeDownloads[modelKey]);
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
  // Vertical padding is intentionally small: the ghost Button carries its own
  // paddingVertical and the SafeAreaView already insets the home-indicator area, so a
  // full 16 here stacked into an oversized gap below "Skip for Now".
  footer: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xs, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
});
