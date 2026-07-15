import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Card } from '../components';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING, FONTS, OFF_GRID_DESKTOP_URL } from '../constants';
import { huggingFaceService } from '../services';
import { ModelFile, RemoteModel, RemoteServer } from '../types';
import logger from '../utils/logger';
import { withUtm } from '../utils/utm';

// ---------------------------------------------------------------------------
// Model file fetching
// ---------------------------------------------------------------------------

export async function fetchModelFiles(
  models: { id: string }[],
): Promise<Record<string, ModelFile[]>> {
  const filesMap: Record<string, ModelFile[]> = {};
  await Promise.all(
    models.map(async (model) => {
      try {
        const files = await huggingFaceService.getModelFiles(model.id);
        const q4km = files.find(f => f.quantization.toUpperCase() === 'Q4_K_M');
        if (q4km) filesMap[model.id] = [q4km];
      } catch (error) {
        logger.error(`Error fetching files for ${model.id}:`, error);
      }
    }),
  );
  return filesMap;
}

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
          <ActivityIndicator size="small" color={colors.primary} />
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
          <ActivityIndicator size="small" color={colors.textSecondary} />
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
            No servers found. Make sure you're on the same WiFi network as your Off Grid AI Desktop, Ollama, or LM Studio server, then scan or add it manually.
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
            ? <ActivityIndicator size="small" color={colors.primary} />
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
    marginBottom: SPACING.md,
  },
  serverCardContent: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  serverInfo: {
    flex: 1,
    marginRight: SPACING.md,
  },
  serverName: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    fontWeight: '500' as const,
    color: colors.text,
    marginBottom: 4,
  },
  serverMeta: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  connectButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  connectedBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  connectButtonText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    fontWeight: '500' as const,
  },
});

const networkSectionStyles = (colors: ThemeColors) => ({
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginBottom: SPACING.lg,
  },
  scanningRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  scanningText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: SPACING.sm,
  },
  getDesktopLink: {
    ...TYPOGRAPHY.bodySmall,
    fontFamily: FONTS.mono,
    marginBottom: SPACING.md,
  },
  actionRow: {
    flexDirection: 'row' as const,
    gap: SPACING.md,
    marginTop: SPACING.sm,
  },
  actionButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  actionButtonText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    fontWeight: '500' as const,
  },
});
