import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { LoadingDots } from '../components/LoadingDots';
import { Card } from '../components';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING, FONTS, OFF_GRID_DESKTOP_URL } from '../constants';
import { RemoteModel, RemoteServer } from '../types';
export { fetchModelFiles } from '../services/modelCatalogFiles';
import { withUtm } from '../utils/utm';

// ---------------------------------------------------------------------------
// Model file fetching
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Discovered-server card
// ---------------------------------------------------------------------------

export const ServerCard: React.FC<{
  server: RemoteServer;
  modelCount: number;
  isConnecting: boolean;
  isConnected: boolean;
  onConnect: () => void;
  colors: ThemeColors;
}> = ({ server, modelCount, isConnecting, isConnected, onConnect, colors }) => {
  const serverType = server.endpoint.includes(':11434') ? 'Ollama'
    : server.endpoint.includes(':1234') ? 'LM Studio'
    : 'AI Server';
  const styles = serverCardStyles(colors);

  return (
    <Card style={styles.serverCard} testID={`discovered-server-${server.id}`}>
      <View style={styles.serverCardContent}>
        <View style={styles.serverInfo}>
          <Text style={styles.serverName}>{server.name}</Text>
          <Text style={styles.serverMeta}>
            {serverType} · {modelCount > 0 ? `${modelCount} model${modelCount !== 1 ? 's' : ''}` : 'Tap to connect'}
          </Text>
        </View>
        {isConnecting && (
          <LoadingDots color={colors.primary} />
        )}
        {!isConnecting && isConnected && (
          <View style={[styles.connectedBadge, { backgroundColor: `${colors.success}20`, borderColor: colors.success }]} testID={`discovered-server-${server.id}-connected`}>
            <Text style={[styles.connectButtonText, { color: colors.success }]}>Connected</Text>
          </View>
        )}
        {!isConnecting && !isConnected && (
          <TouchableOpacity style={[styles.connectButton, { borderColor: colors.primary }]} onPress={onConnect} testID={`discovered-server-${server.id}-connect`}>
            <Text style={[styles.connectButtonText, { color: colors.primary }]}>Connect</Text>
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Network section — always shown, with servers or empty-state actions
// ---------------------------------------------------------------------------

export const NetworkSection: React.FC<{
  servers: RemoteServer[];
  discoveredModels: Record<string, RemoteModel[]>;
  connectingServerId: string | null;
  connectedServerId: string | null;
  isCheckingNetwork: boolean;
  isScanning: boolean;
  onConnectServer: (server: RemoteServer) => void;
  onScanNetwork: () => void;
  onAddManually: () => void;
  colors: ThemeColors;
}> = ({ servers, discoveredModels, connectingServerId, connectedServerId, isCheckingNetwork, isScanning, onConnectServer, onScanNetwork, onAddManually, colors }) => {
  const styles = networkSectionStyles(colors);
  const hasServers = servers.length > 0;
  const busy = isCheckingNetwork || isScanning;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Network Models</Text>

      {isCheckingNetwork && !hasServers && (
        <View style={styles.scanningRow}>
          <LoadingDots color={colors.textSecondary} />
          <Text style={styles.scanningText}>Scanning your network...</Text>
        </View>
      )}

      {hasServers && servers.map((server) => (
        <ServerCard
          key={server.id}
          server={server}
          modelCount={(discoveredModels[server.id] || []).length}
          isConnecting={connectingServerId === server.id}
          isConnected={connectedServerId === server.id}
          onConnect={() => onConnectServer(server)}
          colors={colors}
        />
      ))}

      {!isCheckingNetwork && !hasServers && (
        <>
          <Text style={styles.emptyText}>
            No Off Grid AI Desktop, Ollama, or LM Studio server found. Scan again or add one.
          </Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(withUtm(OFF_GRID_DESKTOP_URL, 'model-download')).catch(() => {})}
            testID="onboarding-get-desktop"
          >
            <Text style={[styles.getDesktopLink, { color: colors.primary }]}>Get Off Grid AI Desktop</Text>
          </TouchableOpacity>
        </>
      )}

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionButton, { borderColor: colors.primary }]}
          onPress={onScanNetwork}
          disabled={busy}
        >
          {busy
            ? <LoadingDots color={colors.primary} />
            : <Text style={[styles.actionButtonText, { color: colors.primary }]}>Scan Network</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, { borderColor: colors.primary }]}
          onPress={onAddManually}
        >
          <Text style={[styles.actionButtonText, { color: colors.primary }]}>Add Server</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const serverCardStyles = (colors: ThemeColors) => ({
  serverCard: {
    marginBottom: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: SPACING.sm,
    borderWidth: 1,
    borderColor: colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  serverCardContent: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  serverInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  serverName: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    fontWeight: '500' as const,
    color: colors.text,
    marginBottom: 2,
  },
  serverMeta: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  connectButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  connectedBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  connectButtonText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    fontWeight: '500' as const,
  },
});

const networkSectionStyles = (colors: ThemeColors) => ({
  section: {
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  scanningRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  scanningText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: SPACING.xs,
  },
  getDesktopLink: {
    ...TYPOGRAPHY.bodySmall,
    fontFamily: FONTS.mono,
    marginBottom: SPACING.sm,
  },
  actionRow: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  actionButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: SPACING.sm,
    paddingVertical: SPACING.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  actionButtonText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    fontWeight: '500' as const,
  },
});
