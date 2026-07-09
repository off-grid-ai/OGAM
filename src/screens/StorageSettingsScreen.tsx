import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import { SPACING } from '../constants';
import { useAppStore, useChatStore } from '../stores';
import { useDownloadStore } from '../stores/downloadStore';
import { hardwareService, modelManager } from '../services';
import { OrphanedFilesSection } from './OrphanedFilesSection';
import { imageBackendLabel } from '../utils/imageBackend';
import { createStyles } from './StorageSettingsScreen.styles';

export const StorageSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [storageUsed, setStorageUsed] = useState(0);
  const [availableStorage, setAvailableStorage] = useState(0);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const {
    downloadedModels,
    downloadedImageModels,
  } = useAppStore();
  const { conversations } = useChatStore();
  const downloads = useDownloadStore(s => s.downloads);
  const removeFromStore = useDownloadStore(s => s.remove);

  const imageStorageUsed = downloadedImageModels.reduce((total, m) => total + (m.size || 0), 0);

  // A "stale" entry is a store entry missing the basic fields needed to
  // display or finalize it. Now sourced from the unified download store.
  const staleDownloads = Object.values(downloads).filter(entry => {
    return !entry.modelId || !entry.fileName || !entry.combinedTotalBytes;
  });

  const loadStorageInfo = useCallback(async () => {
    const used = await modelManager.getStorageUsed();
    const available = await modelManager.getAvailableStorage();
    setStorageUsed(used + imageStorageUsed);
    setAvailableStorage(available);
  }, [imageStorageUsed]);

  useEffect(() => {
    loadStorageInfo();
  }, [loadStorageInfo]);

  const handleClearStaleDownload = useCallback(
    (modelKey: string) => {
      removeFromStore(modelKey);
    },
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
  }, [staleDownloads, removeFromStore]);

  const totalStorage = storageUsed + availableStorage;
  const usedPercentage = totalStorage > 0 ? (storageUsed / totalStorage) * 100 : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
            <View style={[styles.storageUsed, { width: `${Math.min(usedPercentage, 100)}%` }]} />
          </View>
          <View style={styles.storageLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
              <Text style={styles.legendText}>Used: {hardwareService.formatBytes(storageUsed)}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.surfaceLight }]} />
              <Text style={styles.legendText}>Free: {hardwareService.formatBytes(availableStorage)}</Text>
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
              <Icon name="hard-drive" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Model Storage</Text>
            </View>
            <Text style={styles.infoValue}>{hardwareService.formatBytes(storageUsed)}</Text>
          </View>
          <View style={[styles.infoRow, styles.lastRow]}>
            <View style={styles.infoRowLeft}>
              <Icon name="message-circle" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Conversations</Text>
            </View>
            <Text style={styles.infoValue}>{conversations.length}</Text>
          </View>
        </Card>

        {downloadedModels.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>LLM Models</Text>
            {downloadedModels.map((model, index) => (
              <View
                key={model.id}
                style={[styles.modelRow, index === downloadedModels.length - 1 && styles.lastRow]}
              >
                <View style={styles.modelInfo}>
                  <Text style={styles.modelName} numberOfLines={1}>{model.name}</Text>
                  <Text style={styles.modelMeta}>{model.quantization}</Text>
                </View>
                <Text style={styles.modelSize}>{hardwareService.formatModelSize(model)}</Text>
              </View>
            ))}
          </Card>
        )}

        {downloadedImageModels.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Image Models</Text>
            {downloadedImageModels.map((model, index) => (
              <View
                key={model.id}
                style={[styles.modelRow, index === downloadedImageModels.length - 1 && styles.lastRow]}
              >
                <View style={styles.modelInfo}>
                  <Text style={styles.modelName} numberOfLines={1}>{model.name}</Text>
                  <Text style={styles.modelMeta}>
                    {imageBackendLabel(model.backend, 'GPU')}
                    {model.style ? ` • ${model.style}` : ''}
                  </Text>
                </View>
                <Text style={styles.modelSize}>{hardwareService.formatBytes(model.size)}</Text>
              </View>
            ))}
          </Card>
        )}

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
            <Text style={[styles.hint, { textAlign: 'left' as const, marginBottom: SPACING.md }]}>
              These download entries have invalid or missing data and can be safely cleared.
            </Text>
            {staleDownloads.map(entry => (
              <View key={entry.modelKey} style={styles.orphanedRow}>
                <View style={styles.orphanedInfo}>
                  <Text style={styles.orphanedName}>Download #{entry.downloadId}</Text>
                  <Text style={styles.orphanedMeta}>
                    {entry.fileName || 'Unknown file'} • {entry.modelId || 'Unknown model'}
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
