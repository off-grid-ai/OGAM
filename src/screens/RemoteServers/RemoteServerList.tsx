import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type {
  PersistedRemoteServer,
  RemoteServerHealth,
} from '@offgrid/application';
import type { useTheme } from '../../theme';
import type { createStyles } from '../RemoteServersScreen.styles';

type Styles = ReturnType<typeof createStyles>;
type Theme = ReturnType<typeof useTheme>;

interface RemoteServerListProps {
  readonly servers: readonly PersistedRemoteServer[];
  readonly serverHealth: Readonly<Record<string, RemoteServerHealth>>;
  readonly activeServerId: string | null;
  readonly testingId: string | null;
  readonly styles: Styles;
  readonly theme: Theme;
  readonly onUse: (server: PersistedRemoteServer) => Promise<void>;
  readonly onTest: (serverId: string) => Promise<void>;
  readonly onEdit: (serverId: string) => void;
  readonly onDelete: (server: PersistedRemoteServer) => void;
  readonly onOpenDesktop: () => void;
}

export function RemoteServerList({
  servers,
  serverHealth,
  activeServerId,
  testingId,
  styles,
  theme,
  onUse,
  onTest,
  onEdit,
  onDelete,
  onOpenDesktop,
}: RemoteServerListProps): React.JSX.Element {
  if (servers.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No servers yet</Text>
        <Text style={styles.emptyText}>
          Off Grid AI Desktop serves your Mac&apos;s models to this phone.
          Ollama and LM Studio work the same way.
        </Text>
        <TouchableOpacity
          style={styles.desktopLink}
          onPress={onOpenDesktop}
          accessibilityRole="link"
          accessibilityLabel="Get Off Grid AI Desktop"
        >
          <Icon name="monitor" size={14} color={theme.colors.primary} />
          <Text style={styles.desktopLinkText}>Get Off Grid AI Desktop</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <Text style={styles.sectionLabel}>Servers</Text>
      {servers.map(server => {
        const isTesting = testingId === server.id;
        const isActive = activeServerId === server.id;
        const health = serverHealth[server.id];
        const statusColor =
          health?.status === 'healthy'
            ? styles.statusDotActive
            : health?.status === 'unhealthy'
            ? styles.statusDotInactive
            : styles.statusDotUnknown;
        const statusText = isTesting
          ? 'Checking'
          : health?.status === 'healthy'
          ? 'Connected'
          : health?.status === 'unhealthy'
          ? 'Not answering'
          : 'Not checked yet';

        return (
          <View
            key={server.id}
            style={[styles.serverCard, isActive && styles.serverCardActive]}
            testID={`server-${server.id}`}
          >
            <TouchableOpacity
              style={styles.serverIdentity}
              onPress={() => onUse(server)}
              accessibilityRole="button"
              accessibilityLabel={
                isActive ? `Stop using ${server.name}` : `Use ${server.name}`
              }
              testID={`server-use-${server.id}`}
            >
              <View style={styles.serverTopRow}>
                <View style={[styles.statusDot, statusColor]} />
                <Text style={styles.serverName} numberOfLines={1}>
                  {server.name}
                </Text>
                <Text style={isActive ? styles.activeBadge : styles.useHint}>
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
                onPress={() => onTest(server.id)}
                disabled={isTesting}
              >
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
                onPress={() => onEdit(server.id)}
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
                onPress={() => onDelete(server)}
              >
                <Icon name="trash-2" size={13} color={theme.colors.error} />
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
  );
}
