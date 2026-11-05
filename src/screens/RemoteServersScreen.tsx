/**
 * Remote Servers
 *
 * Point this phone at a machine that can run models it cannot: Off Grid AI Desktop on a Mac,
 * or an Ollama / LM Studio server on the same network.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AppSwitch } from '../components/AppSwitch';
import {
  View,
  Text,
  ScrollView,
  Linking,
} from 'react-native';
import { ListGroup } from '../components/ListGroup';
import { TouchableOpacity } from '../components/Touchable';
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
import { AliveScreen } from '../components/AliveScreen';

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

  const scanAbort = useRef<AbortController | null>(null);
  const handleStopScan = useCallback(() => scanAbort.current?.abort(), []);
  // Leaving the screen stops the sweep rather than probing the network in the background.
  useEffect(() => () => scanAbort.current?.abort(), []);

  const handleScanNetwork = useCallback(async () => {
    const abort = new AbortController();
    scanAbort.current = abort;
    setIsScanning(true);
    setScanNote(null);
    setScanProgress({ completed: 0, total: 0 });
    setScanFound(0);
    try {
      const pendingAdds: Array<Promise<unknown>> = [];
      let keyServerId: string | null = null;
      const { found: newServers } = await remoteServerManager.scanAndReconcile({
        kinds: scanKinds,
        signal: abort.signal,
        onProgress: (completed, total) => setScanProgress({ completed, total }),
        onFound: server => {
          setScanFound(count => count + 1);
          pendingAdds.push(
            remoteServerManager.addServer({
              name: server.name,
              endpoint: server.endpoint,
              providerType: 'openai-compatible',
              ...(server.computerId ? { computerId: server.computerId } : {}),
            }).then(saved => {
              if (server.needsKey) {
                keyServerId ??= saved.id;
                return undefined;
              }
              return remoteServerManager.testConnection(saved.id);
            }),
          );
        },
      });
      await Promise.allSettled(pendingAdds);
      if (keyServerId) {
        navigation.navigate('RemoteServerEditor', { serverId: keyServerId, needsKey: true });
      }
      if (abort.signal.aborted) {
        setScanNote(
          newServers.length === 0
            ? 'Scan stopped. No new servers found.'
            : `Scan stopped. Added ${newServers.length} server${newServers.length > 1 ? 's' : ''}.`,
        );
        return;
      }
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
      scanAbort.current = null;
      setIsScanning(false);
    }
  }, [scanKinds, navigation]);

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
    <AliveScreen style={styles.container}>
      <ScreenHeader title="Remote servers" onBack={() => navigation.goBack()} />

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
            <AppSwitch
              testID="auto-discover-toggle"
              value={autoDiscover}
              onValueChange={v =>
                updateSettings({ autoDiscoverRemoteModels: v })
              }
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Scan for</Text>
          {SCAN_KINDS.map(item => (
            <View key={item.kind} style={styles.scanKindRow}>
              <Text style={styles.cardDesc}>{item.label} ({item.port})</Text>
              <AppSwitch
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
              />
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          {/* No `loading` prop: it swaps the label for the platform spinner, and on Android that
              glyph reads as a retry arrow - the same thing that made the chat loading bar look
              like a failure. The dots below carry the waiting instead. */}
          {/* While it scans, the same place stops it: a full sweep takes a while, and you may
              already see the server you came for. */}
          {isScanning ? (
            <Button
              title="Stop scan"
              onPress={handleStopScan}
              size="small"
              testID="stop-scan"
              icon={<Icon name="square" size={12} color={theme.colors.textSecondary} />}
            />
          ) : (
            <Button
              title="Scan network"
              onPress={handleScanNetwork}
              size="small"
              testID="scan-network"
              icon={<Icon name="wifi" size={14} color={theme.colors.textSecondary} />}
            />
          )}
          <Button
            title="Add manually"
            variant="ghost"
            size="small"
            onPress={() => navigation.navigate('RemoteServerEditor')}
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
              {scanFound === 0 ? 'None found yet' : `${scanFound} found`} · {scanProgress.total > 0 ? Math.round((scanProgress.completed / scanProgress.total) * 100) : 0}% checked
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
            <ListGroup testID="server-list">
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
                  style={styles.serverCard}
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
                    accessibilityState={{ selected: isActive }}
                    testID={`server-use-${server.id}`}
                  >
                    <View style={styles.serverTopRow}>
                      {/* A radio, as on Models: tap a row to use that server. */}
                      <Icon name={isActive ? 'check-circle' : 'circle'} size={16} color={isActive ? theme.colors.primary : theme.colors.textMuted} />
                      <Text style={styles.serverName} numberOfLines={1}>
                        {server.name}
                      </Text>
                      <View style={[styles.statusDot, statusColor]} />
                      {/* Only the chosen server is marked; tapping any row chooses it (its label says so). */}
                      {isActive && <Text style={styles.activeBadge}>In use</Text>}
                    </View>
                    <Text style={styles.serverEndpoint} numberOfLines={1}>
                      {server.endpoint}
                    </Text>
                    <Text style={styles.serverStatus}>{statusText}</Text>
                  </TouchableOpacity>

                  {/* Row actions as icon buttons (brand: one surface, actions at the row's end, never a
                      bar of buttons under each item). Their words stay as accessible names. */}
                  <View style={styles.serverActions}>
                    <TouchableOpacity
                      style={styles.serverAction}
                      onPress={() => handleTestServer(server.id)}
                      disabled={isTesting}
                      accessibilityRole="button"
                      accessibilityLabel="Test"
                      accessibilityState={{ busy: isTesting, disabled: isTesting }}
                    >
                      <Icon name="activity" size={16} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.serverAction}
                      onPress={() =>
                        navigation.navigate('RemoteServerEditor', {
                          serverId: server.id,
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel="Edit"
                    >
                      <Icon name="edit-2" size={16} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.serverAction}
                      onPress={() => handleDeleteServer(server)}
                      accessibilityRole="button"
                      accessibilityLabel="Remove"
                    >
                      <Icon name="trash-2" size={16} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
            </ListGroup>
          </>
        )}
      </ScrollView>

      <CustomAlert
        {...alertState}
        onClose={() => setAlertState(initialAlertState)}
      />
    </AliveScreen>
  );
};
