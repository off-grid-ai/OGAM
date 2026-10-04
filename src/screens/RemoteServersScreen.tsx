import { useActiveMobileModel } from '../hooks/useActiveMobileModel';
/**
 * Remote Servers
 *
 * Point this phone at a machine that can run models it cannot: Off Grid AI Desktop on a Mac,
 * or an Ollama / LM Studio server on the same network.
 */

import { callHook, HOOKS } from '../bootstrap/hookRegistry';
import {
  REMOTE_LAN_PROVIDER_KINDS,
  REMOTE_LAN_PROVIDER_LABELS,
  remoteLanScanKinds,
  type RemoteLanProviderKind,
} from '@offgrid/application';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, Linking, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, useThemedStyles } from '../theme';
import { useRemoteServerStore } from '../stores';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { ThinkingIndicator } from '../components/ThinkingIndicator';
import { RootStackParamList } from '../navigation/types';
import { applicationFacade } from '../services/applicationFacade';
import { useModelsProjection } from '../hooks/useApplicationProjection';
import { modelsFailureMessage } from '@offgrid/application';
import {
  CustomAlert,
  AlertState,
  initialAlertState,
  showAlert,
} from '../components/CustomAlert';
import { OFF_GRID_DESKTOP_URL } from '../constants';
import { withUtm } from '../utils/utm';
import { createStyles } from './RemoteServersScreen.styles';
import { RemoteServerList } from './RemoteServers/RemoteServerList';

const DESKTOP_URL = withUtm(OFF_GRID_DESKTOP_URL, 'remote-servers');

type NavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'RemoteServers'
>;

/** Say what was actually tried: the ports are what has to be listening on the other machine. */
function scanEmptyNote(savedCount: number): string {
  return savedCount > 0
    ? 'Everything on this network is already in your list.'
    : 'Nothing answered on this network. Off Grid AI Desktop serves on port 7878, Ollama on 11434, LM Studio on 1234.';
}

/** Which server kinds a scan looks for. Shared owns the default and the filter; this only renders. */
const ScanKindToggles: React.FC<{
  styles: any;
  theme: any;
  scanKinds: readonly RemoteLanProviderKind[];
  disabled: boolean;
  onChange: (kinds: readonly RemoteLanProviderKind[]) => Promise<void>;
}> = ({ styles, theme, scanKinds, disabled, onChange }) => {
  const toggle = (kind: RemoteLanProviderKind, on: boolean) => {
    const next = REMOTE_LAN_PROVIDER_KINDS.filter(candidate =>
      candidate === kind ? on : scanKinds.includes(candidate),
    );
    // Shared treats an empty choice as "everything"; keep one kind on so the switch you just
    // turned off stays off.
    onChange(next.length ? next : [kind]);
  };
  return (
    <View style={styles.kindGroup}>
      {REMOTE_LAN_PROVIDER_KINDS.map(kind => (
        <View key={kind} style={styles.kindRow}>
          <View style={styles.cardTextCol}>
            <Text style={styles.cardDesc}>
              {REMOTE_LAN_PROVIDER_LABELS[kind]}
            </Text>
          </View>
          <Switch
            testID={`scan-kind-${kind}`}
            value={scanKinds.includes(kind)}
            onValueChange={on => toggle(kind, on)}
            disabled={disabled}
            trackColor={{
              false: theme.colors.border,
              true: theme.colors.primary,
            }}
          />
        </View>
      ))}
    </View>
  );
};

/** The scan action: each server joins the list as it answers; the note reads found-so-far and percent. */
function useScanNetwork({
  servers,
  scanKindLabels,
  setIsScanning,
  setScanNote,
}: {
  servers: readonly unknown[];
  scanKindLabels: readonly string[];
  setIsScanning: (value: boolean) => void;
  setScanNote: (value: string | null) => void;
}) {
  return useCallback(async () => {
    setIsScanning(true);
    setScanNote(null);
    try {
      // Paired devices first: a Mac you paired over sync is a server without any scan.
      await callHook<Promise<void>>(HOOKS.remoteServersAdoptPaired);
      // Each server joins the list the moment it answers; the scan keeps going behind it.
      let addedSoFar = 0;
      let percent = 0;
      const note = () => {
        const found = addedSoFar ? `Found ${addedSoFar} so far. ` : '';
        setScanNote(
          `${found}Looking for ${scanKindLabels.join(', ')}… ${percent}%`,
        );
      };
      note();
      const pendingSaves: Array<Promise<void>> = [];
      let saveFailure: unknown;
      const reconciled =
        await applicationFacade().models.reconcileRemoteServers({
          onFound: found => {
            const saving = applicationFacade()
              .models.saveRemoteServer({
                name: found.name,
                endpoint: found.endpoint,
                provider: 'openai-compatible',
              })
              .then(async saved => {
                if (!saved.ok)
                  throw new Error(modelsFailureMessage(saved.failure));
                const checked =
                  await applicationFacade().models.checkRemoteServer(
                    saved.value.id,
                  );
                if (!checked.success)
                  throw new Error(
                    checked.error ?? 'The server did not answer.',
                  );
                addedSoFar += 1;
                note();
              })
              .catch(error => {
                saveFailure ??= error;
              });
            pendingSaves.push(saving);
          },
          onProgress: (done, total) => {
            const next = total ? Math.floor((done / total) * 100) : 0;
            if (next !== percent) {
              percent = next;
              note();
            }
          },
        });
      if (!reconciled.ok)
        throw new Error(modelsFailureMessage(reconciled.failure));
      await Promise.all(pendingSaves);
      if (saveFailure) throw saveFailure;
      const newServers = reconciled.value.found;
      if (newServers.length === 0) {
        setScanNote(scanEmptyNote(servers.length));
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
  }, [servers, scanKindLabels, setIsScanning, setScanNote]);
}

export const RemoteServersScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const models = useModelsProjection();
  const servers = models.servers;
  const serverHealth = useRemoteServerStore(state => state.serverHealth);
  const activeServerId = useActiveMobileModel('text').model?.serverId ?? null;
  const autoDiscover = models.settings.autoDiscoverRemoteModels === true;
  const storedScanKinds = models.settings.remoteScanKinds;
  const scanKinds = useMemo(
    () => remoteLanScanKinds({ remoteScanKinds: storedScanKinds }),
    [storedScanKinds],
  );
  const scanKindLabels = useMemo(
    () =>
      remoteLanScanKinds({ remoteScanKinds: storedScanKinds }).map(
        kind => REMOTE_LAN_PROVIDER_LABELS[kind],
      ),
    [storedScanKinds],
  );

  const [testingId, setTestingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [settingsPending, setSettingsPending] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const saveDiscoverySettings = useCallback(
    async (patch: {
      autoDiscoverRemoteModels?: boolean;
      remoteScanKinds?: readonly RemoteLanProviderKind[];
    }) => {
      setSettingsPending(true);
      try {
        const outcome = await applicationFacade().models.settings.save({
          origin: 'local',
          patch,
        });
        if (!outcome.ok) {
          setAlertState(
            showAlert(
              'Could not save discovery settings',
              modelsFailureMessage(outcome.failure),
            ),
          );
        }
      } catch (error) {
        setAlertState(
          showAlert(
            'Could not save discovery settings',
            error instanceof Error
              ? error.message
              : 'The setting could not be saved.',
          ),
        );
      } finally {
        setSettingsPending(false);
      }
    },
    [],
  );

  useEffect(() => {
    servers.forEach(server => {
      applicationFacade()
        .models.checkRemoteServer(server.id)
        .catch(error => {
          const message =
            error instanceof Error
              ? error.message
              : 'The server did not answer.';
          setAlertState(showAlert('Could not check server', message));
        });
    });
    // Status refresh belongs to this screen-open event, not every health projection update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTestServer = useCallback(async (serverId: string) => {
    setTestingId(serverId);
    try {
      const result = await applicationFacade().models.checkRemoteServer(
        serverId,
      );
      // The row's own status line already says Connected or Offline, so a success needs no
      // dialog to dismiss. Only a failure earns one, because it carries the reason.
      if (!result.success) {
        setAlertState(
          showAlert(
            'Could not connect',
            result.error || 'The server did not answer.',
          ),
        );
      }
    } catch (error) {
      setAlertState(
        showAlert(
          'Could not connect',
          error instanceof Error ? error.message : 'The server did not answer.',
        ),
      );
    } finally {
      setTestingId(null);
    }
  }, []);

  const handleScanNetwork = useScanNetwork({
    servers,
    scanKindLabels,
    setIsScanning,
    setScanNote,
  });

  const handleDeleteServer = useCallback((server: (typeof servers)[0]) => {
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
              try {
                await applicationFacade().models.removeRemoteServer(server.id);
              } catch (error: unknown) {
                const message =
                  error instanceof Error
                    ? error.message
                    : 'The server could not be removed.';
                setAlertState(
                  showAlert('Could not remove this server', message),
                );
              }
            },
          },
        ],
      ),
    );
  }, []);

  const handleUseServer = useCallback(
    async (server: (typeof servers)[0]) => {
      if (activeServerId === server.id) {
        const cleared = await applicationFacade().models.select({
          modality: 'text',
          modelId: null,
        });
        if (!cleared.ok)
          setAlertState(
            showAlert(
              'Could not stop using this model',
              modelsFailureMessage(cleared.failure),
            ),
          );
        return;
      }
      const textModelId = server.selections?.text;
      if (textModelId) {
        try {
          const routeId = applicationFacade().models.remoteModelRoute(
            server.id,
            textModelId,
            'text',
          );
          if (!routeId)
            throw new Error('The selected server model is unavailable.');
          const selected = await applicationFacade().models.select({
            modality: 'text',
            modelId: routeId,
          });
          if (!selected.ok)
            throw new Error(modelsFailureMessage(selected.failure));
          return;
        } catch (error) {
          setAlertState(
            showAlert(
              'Could not use this model',
              error instanceof Error
                ? error.message
                : 'The server did not load the selected model.',
            ),
          );
          return;
        }
      }
      setAlertState(
        showAlert(
          'Select a text model first',
          'Open this server and select the text model that you want to use.',
        ),
      );
    },
    [activeServerId],
  );

  const openDesktopUrl = useCallback(() => {
    Linking.openURL(DESKTOP_URL).catch(error => {
      const message =
        error instanceof Error
          ? error.message
          : 'The link could not be opened.';
      setAlertState(showAlert('Could not open link', message));
    });
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
            </View>
            <Switch
              testID="auto-discover-toggle"
              value={autoDiscover}
              onValueChange={value =>
                saveDiscoverySettings({ autoDiscoverRemoteModels: value })
              }
              disabled={settingsPending}
              trackColor={{
                false: theme.colors.border,
                true: theme.colors.primary,
              }}
            />
          </View>
          <ScanKindToggles
            styles={styles}
            theme={theme}
            scanKinds={scanKinds}
            disabled={settingsPending}
            onChange={kinds =>
              saveDiscoverySettings({ remoteScanKinds: kinds })
            }
          />
          {settingsPending ? (
            <ThinkingIndicator
              text="Saving discovery settings"
              textStyle={styles.scanNote}
            />
          ) : null}
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
          <ThinkingIndicator
            text="Looking for servers on your Wi-Fi"
            textStyle={styles.scanNote}
          />
        ) : null}
        {!isScanning && scanNote ? (
          <Text style={styles.scanNote}>{scanNote}</Text>
        ) : null}

        <RemoteServerList
          servers={servers}
          serverHealth={serverHealth}
          activeServerId={activeServerId}
          testingId={testingId}
          styles={styles}
          theme={theme}
          onUse={handleUseServer}
          onTest={handleTestServer}
          onEdit={serverId =>
            navigation.navigate('RemoteServerEditor', { serverId })
          }
          onDelete={handleDeleteServer}
          onOpenDesktop={openDesktopUrl}
        />
      </ScrollView>

      <CustomAlert
        {...alertState}
        onClose={() => setAlertState(initialAlertState)}
      />
    </SafeAreaView>
  );
};
