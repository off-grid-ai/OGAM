/**
 * Remote Servers Settings Screen
 *
 * Manage connections to remote LLM servers (Ollama, LM Studio, etc.)
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, useThemedStyles } from '../theme';
import { useRemoteServerStore } from '../stores';
import { RemoteServerModal } from '../components/RemoteServerModal';
import { RootStackParamList } from '../navigation/types';
import { remoteServerManager } from '../services/remoteServerManager';
import { discoverLANServers } from '../services/networkDiscovery';
import { CustomAlert, AlertState, initialAlertState, showAlert } from '../components/CustomAlert';
import { createStyles } from './RemoteServersScreen.styles';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'RemoteServers'>;

export const RemoteServersScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { servers, serverHealth, testConnection, activeServerId, setActiveServerId } = useRemoteServerStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingServer, setEditingServer] = useState<typeof servers[0] | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  // Auto-check all server statuses when screen opens
  useEffect(() => {
    servers.forEach(server => {
      testConnection(server.id).catch(() => { });
    });

  }, []);

  const handleTestServer = useCallback(async (serverId: string) => {
    setTestingId(serverId);
    try {
      const result = await testConnection(serverId);
      if (result.success) {
        setAlertState(showAlert('Success', `Connected successfully (${result.latency}ms)`));
      } else {
        setAlertState(showAlert('Connection Failed', result.error || 'Unknown error'));
      }
    } catch (error) {
      setAlertState(showAlert('Error', error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setTestingId(null);
    }
  }, [testConnection]);

  const handleScanNetwork = useCallback(async () => {
    setIsScanning(true);
    try {
      const discovered = await discoverLANServers();
      if (discovered.length === 0) {
        setAlertState(showAlert('No Servers Found', 'No LLM servers were found on your local network.'));
        return;
      }
      const existingEndpoints = new Set(servers.map(s => s.endpoint));
      const newServers = discovered.filter(d => !existingEndpoints.has(d.endpoint));
      if (newServers.length === 0) {
        setAlertState(showAlert('Already Added', 'All discovered servers are already in your list.'));
        return;
      }
      const added = await Promise.all(
        newServers.map(d =>
          remoteServerManager.addServer({
            name: d.name,
            endpoint: d.endpoint,
            providerType: 'openai-compatible',
          })
        )
      );
      added.forEach(s => remoteServerManager.testConnection(s.id).catch(() => { }));
      setAlertState(showAlert('Discovery Complete', `Added ${newServers.length} server${newServers.length > 1 ? 's' : ''}.`));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setAlertState(showAlert('Scan Failed', message));
    } finally {
      setIsScanning(false);
    }
  }, [servers]);

  const handleDeleteServer = useCallback((server: typeof servers[0]) => {
    setAlertState(showAlert(
      'Delete Server',
      `Are you sure you want to delete "${server.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (activeServerId === server.id) setActiveServerId(null);
            await remoteServerManager.removeServer(server.id);
          },
        },
      ]
    ));
  }, [activeServerId, setActiveServerId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="chevron-left" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Remote Servers</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {servers.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Icon name="wifi" size={32} color={theme.colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No Remote Servers</Text>
            <Text style={styles.emptyText}>
              Connect to Ollama, LM Studio, or other LLM servers on your network
            </Text>
            <TouchableOpacity style={styles.addButton} onPress={() => setShowAddModal(true)}>
              <Icon name="plus" size={20} color={theme.colors.background} />
              <Text style={styles.addButtonText}>Add Server</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.scanButton} onPress={handleScanNetwork} disabled={isScanning}>
              {isScanning ? (
                <ActivityIndicator size="small" color={theme.colors.text} />
              ) : (
                <Icon name="wifi" size={20} color={theme.colors.text} />
              )}
              <Text style={styles.scanButtonText}>{isScanning ? 'Scanning...' : 'Scan Network'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {servers.map((server) => {
              const isTesting = testingId === server.id;
              const health = serverHealth[server.id];

              let statusColor = styles.statusDotUnknown;
              if (health?.isHealthy === true) statusColor = styles.statusDotActive;
              else if (health?.isHealthy === false) statusColor = styles.statusDotInactive;

              let statusText = 'Unknown';
              if (isTesting) statusText = 'Testing...';
              else if (health?.isHealthy === true) statusText = 'Connected';
              else if (health?.isHealthy === false) statusText = 'Offline';

              return (
                <View key={server.id} style={styles.serverItem}>
                  <View style={styles.serverHeader}>
                    <View style={styles.serverInfo}>
                      <Text style={styles.serverName}>{server.name}</Text>
                      <Text style={styles.serverEndpoint}>{server.endpoint}</Text>
                    </View>
                  </View>

                  <View style={styles.statusContainer}>
                    <View style={[styles.statusDot, statusColor]} />
                    <Text style={styles.statusText}>{statusText}</Text>
                  </View>

                  <View style={styles.serverActions}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleTestServer(server.id)}
                      disabled={isTesting}
                    >
                      {isTesting ? (
                        <ActivityIndicator size="small" color={theme.colors.text} />
                      ) : (
                        <>
                          <Icon name="refresh-cw" size={16} color={theme.colors.text} />
                          <Text style={styles.actionButtonText}>Test</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => setEditingServer(server)}
                    >
                      <Icon name="edit-2" size={16} color={theme.colors.text} />
                      <Text style={styles.actionButtonText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.deleteButton]}
                      onPress={() => handleDeleteServer(server)}
                    >
                      <Icon name="trash-2" size={16} color={theme.colors.error} />
                      <Text style={[styles.actionButtonText, styles.deleteButtonText]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            <TouchableOpacity style={styles.addButton} onPress={() => setShowAddModal(true)}>
              <Icon name="plus" size={20} color={theme.colors.background} />
              <Text style={styles.addButtonText}>Add Another Server</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.scanButton} onPress={handleScanNetwork} disabled={isScanning}>
              {isScanning ? (
                <ActivityIndicator size="small" color={theme.colors.text} />
              ) : (
                <Icon name="wifi" size={20} color={theme.colors.text} />
              )}
              <Text style={styles.scanButtonText}>{isScanning ? 'Scanning...' : 'Scan Network'}</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>About Remote Servers</Text>
          <Text style={styles.infoText}>
            Connect to LLM servers running on your local network, such as Ollama or LM Studio.{'\n\n'}
            Make sure your server is running and accessible from your device. For security, only connect to servers on trusted networks.
          </Text>
        </View>
      </ScrollView>

      <RemoteServerModal
        visible={showAddModal || !!editingServer}
        onClose={() => {
          setShowAddModal(false);
          setEditingServer(null);
        }}
        server={editingServer || undefined}
        onSave={() => {
          setShowAddModal(false);
          setEditingServer(null);
        }}
      />

      <CustomAlert
        {...alertState}
        onClose={() => setAlertState(initialAlertState)}
      />
    </SafeAreaView>
  );
};