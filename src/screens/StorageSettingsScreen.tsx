import { statFile } from '../utils/fileStat';
import { videoModelDirectory } from '../services/videoModelFiles';
import { videoModelDisplayName } from '../utils/modelHelpers';
import {
  deleteVideoPack,
  documentIndexBytes,
  generatedVideoBytes,
  searchModelBytes,
} from '../services/storageBreakdown';
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
} from 'react-native';
import { isClassifierModel } from '../services/classifierModel';
import { TouchableOpacity } from '../components/Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import { SPACING } from '../constants';
import { useAppStore, useChatStore } from '../stores';
import { useDownloadStore } from '../stores/downloadStore';
import { hardwareService, modelManager } from '../services';
import { OrphanedFilesSection } from './OrphanedFilesSection';
import { createStyles } from './StorageSettingsScreen.styles';
import { useWhisperStore } from '../stores/whisperStore';
import { useModelDownloads } from '../services/modelDownloadService/useModelDownloads';
import type { RootStackParamList } from '../navigation/types';
import { AliveScreen } from '../components/AliveScreen';
import { ScreenHeader } from '../components/ScreenHeader';

export const StorageSettingsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [storageUsed, setStorageUsed] = useState(0);
  const [availableStorage, setAvailableStorage] = useState(0);
  const [extra, setExtra] = useState({ videos: 0, search: 0, index: 0 });
  // Until the first measurement lands, sizes read "Measuring…", never a false "0 B".
  const [measured, setMeasured] = useState(false);
  const size = (bytes: number) => (measured ? hardwareService.formatBytes(bytes) : 'Measuring…');
  const generatedVideoCount = useAppStore(s => s.generatedVideos.length);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const { downloadedModels, downloadedImageModels, downloadedVideoModels, settings } =
    useAppStore();
  // The intent classifier is a utility model, not one of your chat models.
  const chatModelCount = downloadedModels.filter(m => !isClassifierModel(m.id, settings.classifierModelId)).length;
  const { conversations } = useChatStore();
  const transcriptionModelCount = useWhisperStore(s => s.presentModelIds.length);
  const speechModelCount = useModelDownloads().filter(
    model => model.modelType === 'tts' && model.status === 'completed',
  ).length;
  const downloads = useDownloadStore(s => s.downloads);
  const removeFromStore = useDownloadStore(s => s.remove);

  const imageStorageUsed = downloadedImageModels.reduce(
    (total, m) => total + (m.size || 0),
    0,
  );

  // A "stale" entry is a store entry missing the basic fields needed to
  // display or finalize it. Now sourced from the unified download store.
  const staleDownloads = Object.values(downloads).filter(entry => {
    return !entry.modelId || !entry.fileName || !entry.combinedTotalBytes;
  });

  const loadStorageInfo = useCallback(async () => {
    const videoSizes = await Promise.all(downloadedVideoModels.flatMap(model =>
      model.files.map(async file => {
        const facts = await statFile(`${videoModelDirectory(model.id)}/${file.name}`);
        return facts?.isFile ? facts.size : 0;
      }),
    ));
    const videoStorageUsed = videoSizes.reduce((total, bytes) => total + bytes, 0);
    const used = await modelManager.getStorageUsed();
    const available = await modelManager.getAvailableStorage();
    const [videos, search, index] = await Promise.all([generatedVideoBytes(), searchModelBytes(), documentIndexBytes()]);
    setExtra({ videos, search, index });
    setStorageUsed(used + imageStorageUsed + videoStorageUsed + search);
    setAvailableStorage(available);
    setMeasured(true);
  }, [imageStorageUsed, downloadedVideoModels]);

  const confirmDeleteVideoPack = (id: string, name: string) => {
    setAlertState(
      showAlert('Delete video model?', `Delete "${name}" from this phone?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setAlertState(hideAlert());
            deleteVideoPack(id).then(loadStorageInfo).catch(() => undefined);
          },
        },
      ]),
    );
  };

  useEffect(() => {
    loadStorageInfo();
    // A new or deleted video changes the Videos and Films row.
  }, [loadStorageInfo, generatedVideoCount]);

  const handleClearStaleDownload = useCallback(
    (modelKey: string) => {
      removeFromStore(modelKey);
    },
    [removeFromStore],
  );

  const handleClearAllStaleDownloads = useCallback(() => {
    setAlertState(
      showAlert(
        'Clear unfinished downloads',
        `Clear ${staleDownloads.length} ${staleDownloads.length === 1 ? 'download' : 'downloads'}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Clear all',
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
    <AliveScreen style={styles.container}>
      <ScreenHeader title="Storage" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Storage used</Text>
          <View style={styles.storageBar}>
            <View style={[styles.storageUsed, { width: `${Math.min(usedPercentage, 100)}%` }]} />
          </View>
          <View style={styles.storageLegend}>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: colors.textSecondary }]}
              />
              <Text style={styles.legendText}>
                Used: {size(storageUsed)}
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
                Free: {size(availableStorage)}
              </Text>
            </View>
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Breakdown</Text>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="cpu" size={18} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Chat models</Text>
            </View>
            <Text style={styles.infoValue}>{chatModelCount}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="image" size={18} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Image models</Text>
            </View>
            <Text style={styles.infoValue}>{downloadedImageModels.length}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="video" size={18} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Video models</Text>
            </View>
            <Text style={styles.infoValue}>{downloadedVideoModels.length}</Text>
          </View>
          {downloadedVideoModels.map(model => (
            <View key={model.id} style={styles.infoRow}>
              <Text style={[styles.infoLabel, styles.indented]} numberOfLines={1}>
                {videoModelDisplayName(model.id, model.name)}
              </Text>
              <TouchableOpacity
                onPress={() => confirmDeleteVideoPack(model.id, videoModelDisplayName(model.id, model.name))}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${videoModelDisplayName(model.id, model.name)}`}
                testID={`storage-delete-video-${model.id}`}
                hitSlop={14}
              >
                <Icon name="trash-2" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="search" size={18} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Document search model</Text>
            </View>
            <Text style={styles.infoValue}>{size(extra.search)}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="mic" size={18} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Speech-to-text models</Text>
            </View>
            <Text style={styles.infoValue}>{transcriptionModelCount}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="volume-2" size={18} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Voices</Text>
            </View>
            <Text style={styles.infoValue}>{speechModelCount}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="hard-drive" size={18} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Chat, image, video and search models</Text>
            </View>
            <Text style={styles.infoValue}>{size(storageUsed)}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="film" size={18} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Videos and films</Text>
            </View>
            <Text style={styles.infoValue}>
              {generatedVideoCount} · {size(extra.videos)}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="file-text" size={18} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Document search index</Text>
            </View>
            <Text style={styles.infoValue}>{size(extra.index)}</Text>
          </View>
          <View style={[styles.infoRow, styles.lastRow]}>
            <View style={styles.infoRowLeft}>
              <Icon name="message-circle" size={18} color={colors.textSecondary} />
              <Text style={styles.infoLabel}>Conversations</Text>
            </View>
            <Text style={styles.infoValue}>{conversations.length}</Text>
          </View>
        </Card>

        <View style={styles.section}>
          <Button
            title="Choose models for this phone"
            variant="outline"
            size="small"
            style={styles.sizedToText}
            onPress={() => navigation.navigate('AutoSetup')}
            testID="storage-auto-setup"
          />
        </View>

        {staleDownloads.length > 0 && (
          <Card style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Unfinished downloads</Text>
              <TouchableOpacity
                style={styles.clearAllButton}
                onPress={handleClearAllStaleDownloads}
              >
                <Text style={styles.clearAllText}>Clear all</Text>
              </TouchableOpacity>
            </View>
            <Text
              style={[
                styles.hint,
                { textAlign: 'left' as const, marginBottom: SPACING.md },
              ]}
            >
              These stopped before they finished. Clearing them is safe.
            </Text>
            {staleDownloads.map(entry => (
              <View key={entry.modelKey} style={styles.orphanedRow}>
                <View style={styles.orphanedInfo}>
                  <Text style={styles.orphanedName} numberOfLines={1}>{entry.fileName || 'Unnamed file'}</Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleClearStaleDownload(entry.modelKey)}
                >
                  <Icon name="x" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </Card>
        )}

        <OrphanedFilesSection onStorageChange={loadStorageInfo} />

        <Text style={styles.hint}>
          To get more space back, delete models you no longer use in Models.
        </Text>
      </ScrollView>

      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </AliveScreen>
  );
};
