import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card } from '../components';
import {
  CustomAlert,
  showAlert,
  hideAlert,
  type AlertState,
  initialAlertState,
} from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import { SPACING } from '../constants';
import { useAppStore } from '../stores';
import { useDownloadStore } from '../stores/downloadStore';
import { useWorkspaceContentProjection } from '../hooks/useApplicationProjection';
import { useModelDownloadsProjection } from '../hooks/useModelDownloadsProjection';
import { useTranscriptionModelsProjection } from '../hooks/useTranscriptionModelsProjection';
import { hardwareService, modelLibrary } from '../services';
import { OrphanedFilesSection } from './OrphanedFilesSection';
import { createStyles } from './StorageSettingsScreen.styles';
import type { RootStackParamList } from '../navigation/types';

export const StorageSettingsScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [storageUsed, setStorageUsed] = useState(0);
  const [availableStorage, setAvailableStorage] = useState(0);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const downloadedModels = useAppStore(state => state.downloadedModels);
  const downloadedImageModels = useAppStore(
    state => state.downloadedImageModels,
  );
  const workspaceContent = useWorkspaceContentProjection();
  const transcriptionModels = useTranscriptionModelsProjection();
  const modelDownloads = useModelDownloadsProjection();
  const conversationCount = workspaceContent.status === 'ready'
    ? workspaceContent.conversations.length
    : null;
  const projectCount = workspaceContent.status === 'ready'
    ? workspaceContent.projects.length
    : null;
  const conversationCountLabel = conversationCount ?? (
    workspaceContent.status === 'stopped' ? 'Unavailable' : 'Loading…'
  );
  const projectCountLabel = projectCount ?? (
    workspaceContent.status === 'stopped' ? 'Unavailable' : 'Loading…'
  );
  const transcriptionModelCount = transcriptionModels.models.filter(
    model => model.installed,
  ).length;
  const speechModelCount = modelDownloads.filter(
    model => model.modelType === 'tts' && model.status === 'completed',
  ).length;
  const downloads = useDownloadStore(state => state.downloads);
  const removeFromStore = useDownloadStore(state => state.remove);

  const imageStorageUsed = useMemo(
    () => downloadedImageModels.reduce((total, m) => total + (m.size || 0), 0),
    [downloadedImageModels],
  );
  const staleDownloads = useMemo(
    () =>
      Object.values(downloads).filter(
        entry => !entry.modelId || !entry.fileName || !entry.combinedTotalBytes,
      ),
    [downloads],
  );

  const loadStorageInfo = useCallback(async () => {
    const used = await modelLibrary.getStorageUsed();
    const available = await modelLibrary.getAvailableStorage();
    setStorageUsed(used + imageStorageUsed);
    setAvailableStorage(available);
  }, [imageStorageUsed]);

  useEffect(() => {
    loadStorageInfo();
  }, [loadStorageInfo]);

  const handleClearStaleDownload = useCallback(
    (modelKey: string) => removeFromStore(modelKey),
    [removeFromStore],
  );

  const handleClearAllStaleDownloads = useCallback(() => {
    setAlertState(
      showAlert(
        'Clear Stale Downloads',
        `Clear ${staleDownloads.length} stale download entry(s)?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Clear All',
            style: 'destructive',
            onPress: () => {
              setAlertState(hideAlert());
              for (const entry of staleDownloads) {
                removeFromStore(entry.modelKey);
              }
            },
          },
        ],
      ),
    );
  }, [removeFromStore, staleDownloads]);

  const totalStorage = storageUsed + availableStorage;
  const usedPercentage =
    totalStorage > 0 ? (storageUsed / totalStorage) * 100 : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="storage-settings-screen">
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Storage</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Storage Usage</Text>
          <View style={styles.storageBar}>
            <View
              style={[
                styles.storageUsed,
                { width: `${Math.min(usedPercentage, 100)}%` },
              ]}
            />
          </View>
          <View style={styles.storageLegend}>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: colors.primary }]}
              />
              <Text style={styles.legendText}>
                Used: {hardwareService.formatBytes(storageUsed)}
              </Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: colors.surfaceLight },
                ]}
              />
              <Text style={styles.legendText}>
                Free: {hardwareService.formatBytes(availableStorage)}
              </Text>
            </View>
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Breakdown</Text>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="cpu" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>LLM Models</Text>
            </View>
            <Text style={styles.infoValue}>{downloadedModels.length}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="image" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Image Models</Text>
            </View>
            <Text style={styles.infoValue}>{downloadedImageModels.length}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="mic" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Transcription Models</Text>
            </View>
            <Text style={styles.infoValue}>{transcriptionModelCount}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="volume-2" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Speech Models</Text>
            </View>
            <Text style={styles.infoValue}>{speechModelCount}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="hard-drive" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Model Storage</Text>
            </View>
            <Text style={styles.infoValue}>{hardwareService.formatBytes(storageUsed)}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="message-circle" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Conversations</Text>
            </View>
            <Text style={styles.infoValue}>{conversationCountLabel}</Text>
          </View>
          <View style={[styles.infoRow, styles.lastRow]}>
            <View style={styles.infoRowLeft}>
              <Icon name="folder" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Projects</Text>
            </View>
            <Text style={styles.infoValue}>{projectCountLabel}</Text>
          </View>
        </Card>

        <View style={styles.section}>
          <Button
            title="Auto Setup"
            variant="outline"
            onPress={() => navigation.navigate('AutoSetup')}
            testID="storage-auto-setup"
          />
        </View>

        {staleDownloads.length > 0 && (
          <Card style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Stale Downloads</Text>
              <TouchableOpacity
                style={styles.clearAllButton}
                onPress={handleClearAllStaleDownloads}
              >
                <Text style={styles.clearAllText}>Clear All</Text>
              </TouchableOpacity>
            </View>
            <Text
              style={[
                styles.hint,
                { textAlign: 'left' as const, marginBottom: SPACING.md },
              ]}
            >
              These download entries have invalid or missing data and can be
              safely cleared.
            </Text>
            {staleDownloads.map(entry => (
              <View key={entry.modelKey} style={styles.orphanedRow}>
                <View style={styles.orphanedInfo}>
                  <Text style={styles.orphanedName}>
                    Download #{entry.downloadId}
                  </Text>
                  <Text style={styles.orphanedMeta}>
                    {entry.fileName || 'Unknown file'} •{' '}
                    {entry.modelId || 'Unknown model'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleClearStaleDownload(entry.modelKey)}
                >
                  <Icon name="x" size={18} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </Card>
        )}

        <OrphanedFilesSection onStorageChange={loadStorageInfo} />

        <Text style={styles.hint}>
          To free up space, you can delete models from the Models tab.
        </Text>
      </ScrollView>
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </SafeAreaView>
  );
};
