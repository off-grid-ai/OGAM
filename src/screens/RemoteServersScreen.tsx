/**
 * Remote Servers
 *
 * Point this phone at a machine that can run models it cannot: Off Grid AI Desktop on a Mac,
 * or an Ollama / LM Studio server on the same network.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, useThemedStyles } from '../theme';
import { useRemoteServerStore, useAppStore } from '../stores';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { ThinkingIndicator } from '../components/ThinkingIndicator';
import { RootStackParamList } from '../navigation/types';
import { remoteServerManager } from '../services/remoteServerManager';
import type { DiscoverableServerKind } from '../services/networkDiscovery';
import {
  CustomAlert,
  AlertState,
  initialAlertState,
  showAlert,
} from '../components/CustomAlert';
import { OFF_GRID_DESKTOP_URL } from '../constants';
import { withUtm } from '../utils/utm';
import { createStyles } from './RemoteServersScreen.styles';

const DESKTOP_URL = withUtm(OFF_GRID_DESKTOP_URL, 'remote-servers');
const SCAN_KINDS: Array<{ kind: DiscoverableServerKind; label: string; port: number }> = [
  { kind: 'gateway', label: 'Off Grid AI Desktop', port: 7878 },
  { kind: 'ollama', label: 'Ollama', port: 11434 },
  { kind: 'lmstudio', label: 'LM Studio', port: 1234 },
];

type NavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'RemoteServers'
>;

export const RemoteServersScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { servers, serverHealth, activeServerId, setActiveServerId } = useRemoteServerStore();
  const autoDiscover = useAppStore(
    s => s.settings.autoDiscoverRemoteModels === true,
  );
  const updateSettings = useAppStore(s => s.updateSettings);
  const savedScanKinds = useAppStore(s => s.settings.remoteScanKinds);
  const scanKinds = savedScanKinds?.length
    ? savedScanKinds
    : SCAN_KINDS.map(item => item.kind);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState({ completed: 0, total: 0 });
  const [scanFound, setScanFound] = useState(0);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  // Auto-check all server statuses when screen opens. The manager reads each server's saved key,
  // so an authenticated server is checked with its key rather than reported offline without it.
  useEffect(() => {
    servers.forEach(server => {
      remoteServerManager.testConnection(server.id).catch(() => { });
    });

  // Status refresh belongs to this screen-open event, not every health projection update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTestServer = useCallback(async (serverId: string) => {
    setTestingId(serverId);
    try {
      const result = await remoteServerManager.testConnection(serverId);
      // The row's own status line already says Connected or Offline, so a success needs no
      // dialog to dismiss. Only a failure earns one, because it carries the reason.
      if (!result.success) {
        setAlertState(showAlert('Could not connect', result.error || 'The server did not answer.'));
      }
    } catch (error) {
      setAlertState(showAlert('Could not connect', error instanceof Error ? error.message : 'The server did not answer.'));
    } finally {
      setTestingId(null);
    }
  }, []);

  const handleScanNetwork = useCallback(async () => {
    setIsScanning(true);
    setScanNote(null);
    setScanProgress({ completed: 0, total: 0 });
    setScanFound(0);
    try {
      const pendingAdds: Array<Promise<unknown>> = [];
      const { found: newServers } = await remoteServerManager.scanAndReconcile({
        kinds: scanKinds,
        onProgress: (completed, total) => setScanProgress({ completed, total }),
        onFound: server => {
          setScanFound(count => count + 1);
          pendingAdds.push(
            remoteServerManager.addServer({
              name: server.name,
              endpoint: server.endpoint,
              providerType: 'openai-compatible',
            }).then(saved => remoteServerManager.testConnection(saved.id)),
          );
        },
      });
      await Promise.allSettled(pendingAdds);
      if (newServers.length === 0) {
        setScanNote(
          `No new servers answered. Check ${SCAN_KINDS.filter(item => scanKinds.includes(item.kind)).map(item => `${item.label} on port ${item.port}`).join(', ')}.`,
        );
        return;
      }
      setScanNote(
        `Added ${newServers.length} server${newServers.length > 1 ? 's' : ''}.`,
      );
    } catch (error) {
      setScanNote(
        error instanceof Error ? error.message : 'The scan could not finish.',
      );
    } finally {
      setIsScanning(false);
    }
  }, [scanKinds]);

  const handleDeleteServer = useCallback(
    (server: (typeof servers)[0]) => {
      setAlertState(
        showAlert(
      'Remove this server',
      `"${server.name}" will be removed from this phone. The server itself is not touched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (activeServerId === server.id) setActiveServerId(null);
            await remoteServerManager.removeServer(server.id);
          },
        },
          ],
        ),
      );
    },
    [activeServerId, setActiveServerId],
  );

  const handleUseServer = useCallback(
    async (server: (typeof servers)[0]) => {
      if (activeServerId === server.id) {
        remoteServerManager.clearActiveRemoteTextModel();
        return;
      }
      const textModelId = server.mediaModels?.text;
      if (textModelId) {
        try {
          await remoteServerManager.setActiveRemoteTextModel(server.id, textModelId);
          return;
        } catch (error) {
          setAlertState(showAlert('Could not use this model', error instanceof Error
            ? error.message : 'The server did not load the selected model.'));
          return;
        }
      }
      setActiveServerId(server.id);
    },
    [activeServerId, setActiveServerId],
  );

  const openDesktopUrl = useCallback(() => {
    Linking.openURL(DESKTOP_URL).catch(() => {});
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Remote Servers" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.intro}>
          Run models this phone cannot hold. Another machine on your network
          does the work and the answer comes back here, over your own Wi-Fi.
        </Text>

        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardTextCol}>
              <Text style={styles.cardTitle}>Auto-discover on Wi-Fi</Text>
              {/* Describes what is happening NOW, not what the default was: the old copy read
                  "Off by default" while the switch was on. */}
              <Text style={styles.cardDesc}>
                {autoDiscover
                  ? 'Looks for servers on your network each time you open this screen.'
                  : 'Turn this on to find servers on your network without scanning by hand.'}
              </Text>
            </View>
            <Switch
              testID="auto-discover-toggle"
              value={autoDiscover}
              onValueChange={v =>
                updateSettings({ autoDiscoverRemoteModels: v })
              }
              trackColor={{
                false: theme.colors.border,
                true: theme.colors.primary,
              }}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Scan for</Text>
          {SCAN_KINDS.map(item => (
            <View key={item.kind} style={styles.scanKindRow}>
              <Text style={styles.cardDesc}>{item.label} ({item.port})</Text>
              <Switch
                testID={`scan-kind-${item.kind}`}
                accessibilityLabel={`Scan for ${item.label}`}
                value={scanKinds.includes(item.kind)}
                disabled={isScanning || (scanKinds.length === 1 && scanKinds.includes(item.kind))}
                onValueChange={enabled => {
                  const next = enabled
                    ? [...scanKinds, item.kind]
                    : scanKinds.filter(kind => kind !== item.kind);
                  if (next.length > 0) updateSettings({ remoteScanKinds: next });
                }}
                trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              />
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          {/* No `loading` prop: it swaps the label for the platform spinner, and on Android that
              glyph reads as a retry arrow - the same thing that made the chat loading bar look
              like a failure. The dots below carry the waiting instead. */}
          <Button
            title={isScanning ? 'Scanning' : 'Scan network'}
            onPress={handleScanNetwork}
            disabled={isScanning}
            style={styles.actionButton}
            testID="scan-network"
            icon={<Icon name="wifi" size={14} color={theme.colors.primary} />}
          />
          <Button
            title="Add manually"
            variant="secondary"
            onPress={() => navigation.navigate('RemoteServerEditor')}
            style={styles.actionButton}
            testID="add-server"
            icon={<Icon name="plus" size={14} color={theme.colors.text} />}
          />
        </View>
        {isScanning ? (
          <View>
            <ThinkingIndicator
              text="Looking for servers on your Wi-Fi"
              textStyle={styles.scanNote}
            />
            <Text style={styles.scanNote} accessibilityRole="text" testID="scan-progress">
              {scanProgress.completed} / {scanProgress.total} checked. {scanFound} found.
            </Text>
          </View>
        ) : null}
        {!isScanning && scanNote ? (
          <Text style={styles.scanNote}>{scanNote}</Text>
        ) : null}

        {servers.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No servers yet</Text>
            <Text style={styles.emptyText}>
              Off Grid AI Desktop serves your Mac&apos;s models to this phone.
              Ollama and LM Studio work the same way.
            </Text>
            <TouchableOpacity
              style={styles.desktopLink}
              onPress={openDesktopUrl}
              accessibilityRole="link"
              accessibilityLabel="Get Off Grid AI Desktop"
            >
              <Icon name="monitor" size={14} color={theme.colors.primary} />
              <Text style={styles.desktopLinkText}>
                Get Off Grid AI Desktop
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>Servers</Text>
            {servers.map(server => {
              const isTesting = testingId === server.id;
              const isActive = activeServerId === server.id;
              const health = serverHealth[server.id];

              let statusColor = styles.statusDotUnknown;
              if (health?.isHealthy === true)
                statusColor = styles.statusDotActive;
              else if (health?.isHealthy === false)
                statusColor = styles.statusDotInactive;

              let statusText = 'Not checked yet';
              if (isTesting) statusText = 'Checking';
              else if (health?.isHealthy === true) statusText = 'Connected';
              else if (health?.isHealthy === false)
                statusText = 'Not answering';

              return (
                <View
                  key={server.id}
                  style={[
                    styles.serverCard,
                    isActive && styles.serverCardActive,
                  ]}
                  testID={`server-${server.id}`}
                >
                  {/* Tapping the server chooses it. The store has always had an active server
                      and this screen never let you set one, so the only way to pick was to go
                      somewhere else. */}
                  <TouchableOpacity
                    style={styles.serverIdentity}
                    onPress={() => handleUseServer(server)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      isActive
                        ? `Stop using ${server.name}`
                        : `Use ${server.name}`
                    }
                    testID={`server-use-${server.id}`}
                  >
                    <View style={styles.serverTopRow}>
                      <View style={[styles.statusDot, statusColor]} />
                      <Text style={styles.serverName} numberOfLines={1}>
                        {server.name}
                      </Text>
                      <Text
                        style={isActive ? styles.activeBadge : styles.useHint}
                      >
                        {isActive ? 'In use' : 'Use'}
                      </Text>
                    </View>
                    <Text style={styles.serverEndpoint} numberOfLines={1}>
                      {server.endpoint}
                    </Text>
                    <Text style={styles.serverStatus}>{statusText}</Text>
                  </TouchableOpacity>

                  <View style={styles.serverActions}>
                    <TouchableOpacity
                      style={styles.serverAction}
                      onPress={() => handleTestServer(server.id)}
                      disabled={isTesting}
                    >
                      {/* The row's status line already says "Checking", so the icon stays put
                          rather than being swapped for a spinner that reads as retry. */}
                      <Icon
                        name="refresh-cw"
                        size={13}
                        color={theme.colors.textSecondary}
                      />
                      <Text style={styles.serverActionText}>
                        {isTesting ? 'Checking' : 'Test'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.serverAction}
                      onPress={() =>
                        navigation.navigate('RemoteServerEditor', {
                          serverId: server.id,
                        })
                      }
                    >
                      <Icon
                        name="edit-2"
                        size={13}
                        color={theme.colors.textSecondary}
                      />
                      <Text style={styles.serverActionText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.serverAction, styles.serverActionDanger]}
                      onPress={() => handleDeleteServer(server)}
                    >
                      <Icon
                        name="trash-2"
                        size={13}
                        color={theme.colors.error}
                      />
                      <Text
                        style={[
                          styles.serverActionText,
                          styles.serverActionDangerText,
                        ]}
                      >
                        Remove
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      <CustomAlert
        {...alertState}
        onClose={() => setAlertState(initialAlertState)}
      />
    </SafeAreaView>
  );
};
