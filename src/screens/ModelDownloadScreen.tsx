import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Linking,
} from 'react-native';
import { LoadingDots } from '../components/LoadingDots';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING, OFF_GRID_DESKTOP_URL } from '../constants';
import { withUtm } from '../utils/utm';
import { useAppStore } from '../stores';
import { useDiscoveredRemoteModels } from '../hooks/useDiscoveredRemoteModels';
import { serverDiscoveredModels } from '../stores/remoteServerProjection';
import { hardwareService } from '../services';
import { applicationFacade } from '../services/applicationFacade';
import { useModelsProjection } from '../hooks/useApplicationProjection';
import { modelsFailureMessage } from '@offgrid/application';
import { RemoteServer } from '../types';
import { RootStackParamList } from '../navigation/types';
import { NetworkSection } from './ModelDownloadHelpers';
import logger from '../utils/logger';
import { ModelsScreen } from './ModelsScreen';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'AdvancedSetup'> };

export const AdvancedSetupScreen: React.FC<Props> = ({ navigation }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [connectingServerId, setConnectingServerId] = useState<string | null>(null);
  const [connectedServerId, setConnectedServerId] = useState<string | null>(null);
  const [reachableServerIds, setReachableServerIds] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [isCheckingNetwork, setIsCheckingNetwork] = useState(true);
  const healthCheckInFlight = useRef(false);

  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const deviceInfo = useAppStore(s => s.deviceInfo);
  const { setDeviceInfo, setModelRecommendation } = useAppStore.getState();
  const servers = [...useModelsProjection().servers] as RemoteServer[];
  const discoveredModels = useDiscoveredRemoteModels();

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
      } catch (error) {
        logger.error('Error initializing:', error);
        if (!cancelled) setAlertState(showAlert('Error', 'Failed to initialize. Please try again.'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [setDeviceInfo, setModelRecommendation]);

  // Health-check persisted servers — only show reachable ones.
  // Returns { ran, reachable }: `ran` is false when the in-flight guard short-circuited this call
  // (another check is already running), so callers can distinguish "checked and found nothing" from
  // "did not actually check". The reachable set is only authoritative when `ran` is true.
  const refreshServerHealth = useCallback(async (): Promise<{ ran: boolean; reachable: Set<string> }> => {
    if (healthCheckInFlight.current) return { ran: false, reachable: new Set<string>() };
    healthCheckInFlight.current = true;
    setIsCheckingNetwork(true);
    const reachable = new Set<string>();
    await Promise.all(
      applicationFacade().models.snapshot().servers.map(async (server) => {
        try {
          const result = await applicationFacade().models.checkRemoteServer(server.id);
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
      const reconciled = await applicationFacade().models.reconcileRemoteServers();
      if (!reconciled.ok) throw new Error(modelsFailureMessage(reconciled.failure));
      let added = 0;
      for (const d of reconciled.value.found) {
        const saved = await applicationFacade().models.saveRemoteServer({
          name: d.name,
          endpoint: d.endpoint,
          provider: 'openai-compatible',
        });
        if (!saved.ok) throw new Error(modelsFailureMessage(saved.failure));
        added += 1;
      }
      const { ran, reachable } = await refreshServerHealth();
      // The alert must AGREE with the rendered list: never claim "no servers" while one is present or
      // was just discovered. Show it only when the scan genuinely found nothing on the network — no
      // server discovered/added, none already listed, AND a real check ran (not short-circuited by the
      // in-flight auto-check) that found nothing reachable. If the check was skipped by the in-flight
      // guard, the auto-check that owns it will settle the reachable list, so we do not alert.
      const noServersPresent =
        added === 0 && applicationFacade().models.snapshot().servers.length === 0;
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

  const handleConnectServer = async (server: RemoteServer) => {
    setConnectingServerId(server.id);
    try {
      const result = await applicationFacade().models.checkRemoteServer(server.id);
      if (!result.success) {
        setAlertState(showAlert('Connection Failed', result.error || 'Could not connect to server.'));
        return;
      }
      setConnectedServerId(server.id);
      let models = discoveredModels[server.id] ?? [];
      if (models.length === 0) {
        const discovered = await applicationFacade().models.discoverRemoteServers(
          server.id,
        );
        if (!discovered.ok) {
          throw new Error(modelsFailureMessage(discovered.failure));
        }
        const refreshed = applicationFacade().models.remoteServer(server.id);
        models = refreshed
          ? serverDiscoveredModels(refreshed as RemoteServer)
          : [];
      }
      if (models.length === 0) {
        setAlertState(showAlert('Connected — No Models Found', `${server.name} is reachable but has no models loaded. Start a model in Off Grid AI Desktop, Ollama, or LM Studio, then reconnect.`));
        return;
      }
      const textModel = models.find(m => !m.capabilities.supportsVision) || models[0];
      if (textModel) {
        const selected = await applicationFacade().models.activateOnServer(
          server.id,
          'text',
          textModel.id,
        );
        if (!selected.ok) throw new Error(modelsFailureMessage(selected.failure));
      }
      setAlertState(showAlert('Connected!', `${server.name} is ready with ${models.length} model${models.length === 1 ? '' : 's'}. You can start chatting now.`,
        [{ text: 'Continue', onPress: () => { setAlertState(hideAlert()); navigation.replace('Main'); } }]));
    } catch (e) { setAlertState(showAlert('Connection Failed', (e as Error).message)); }
    finally { setConnectingServerId(null); }
  };

  const liveServers = servers.filter((s) => reachableServerIds.has(s.id));

  if (isLoading) return (
    <SafeAreaView style={styles.container}>
      <View testID="model-download-loading" style={styles.loadingContainer}>
        <LoadingDots color={colors.primary} size={8} />
        <Text style={styles.loadingText}>Analyzing your device...</Text>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View testID="model-download-screen" style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Advanced Setup</Text>
            <Text style={styles.subtitle}>
              Run a model from your network or on this device.
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
            onAddManually={() => navigation.navigate('RemoteServerEditor')}
            colors={colors}
          />

          <Text style={styles.sectionTitle}>On This Device</Text>

          <View style={styles.deviceCard}>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceLabel}>Your Device</Text>
              <Text style={styles.deviceValue}>{deviceInfo?.deviceModel}</Text>
            </View>
            <View style={styles.deviceInfo}>
              {/* TOTAL memory, not available.
                *
                * Available memory is whatever the rest of the phone happens to be doing, so the same
                * device reported a different number on every launch and the figure could not be
                * compared with a model's size - which is the only reason it is on this screen. Total
                * is a property of the device, so "12 GB" means the same thing tomorrow. */}
              <Text style={styles.deviceLabel}>Total Memory</Text>
              <Text style={styles.deviceValue}>{hardwareService.formatBytes(deviceInfo?.totalMemory || 0)}</Text>
            </View>
          </View>
          <ModelsScreen embedded />
        </ScrollView>

        <View style={styles.footer}>
          <Button title="Skip for Now" variant="ghost" onPress={() => navigation.replace('Main')} testID="model-download-skip" />
        </View>

        <CustomAlert visible={alertState.visible} title={alertState.title} message={alertState.message} buttons={alertState.buttons} onClose={() => setAlertState(hideAlert())} />
      </View>
    </SafeAreaView>
  );
};


const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const, gap: 16 },
  loadingText: { ...TYPOGRAPHY.body, color: colors.textSecondary, textAlign: 'center' as const },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: 72 },
  header: { marginBottom: SPACING.md },
  title: { ...TYPOGRAPHY.h2, color: colors.text, marginBottom: SPACING.xs },
  subtitle: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, lineHeight: 20 },
  sectionTitle: { ...TYPOGRAPHY.h3, color: colors.text, marginBottom: SPACING.sm },
  deviceCard: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginBottom: SPACING.md,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  deviceInfo: { flex: 1 },
  deviceLabel: { ...TYPOGRAPHY.labelSmall, color: colors.textMuted, marginBottom: 2 },
  deviceValue: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  warningCard: { backgroundColor: `${colors.warning}20`, borderWidth: 1, borderColor: colors.warning },
  warningTitle: { ...TYPOGRAPHY.h3, color: colors.warning, marginBottom: 8 },
  warningText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, lineHeight: 20 },
  // Vertical padding is intentionally small: the ghost Button carries its own
  // paddingVertical and the SafeAreaView already insets the home-indicator area, so a
  // full 16 here stacked into an oversized gap below "Skip for Now".
  footer: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xs, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
});
