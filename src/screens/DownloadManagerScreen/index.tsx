import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, ScrollView } from 'react-native';
import { TouchableOpacity } from '../../components/Touchable';
import { LIST_CLIPPING_PROPS } from '../../constants/listClipping';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { Card } from '../../components';
import { ListGroup } from '../../components/ListGroup';
import { CustomAlert, hideAlert } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';
import { ActiveDownloadCard, CompletedDownloadCard, formatBytes, type DownloadItem } from './items';
import { useDownloadManager } from './useDownloadManager';
import { isQueuedStatus, isDownloadingStatus, isFailedStatus, type DownloadStatus } from '../../stores/downloadStore';
import { AliveScreen } from '../../components/AliveScreen';

type FilterType = 'all' | 'text' | 'vision' | 'image' | 'voice';

const FILTERS: { id: FilterType; label: string }[] = [
  { id: 'all',    label: 'All' },
  { id: 'text',   label: 'Text' },
  { id: 'vision', label: 'Vision' },
  { id: 'image',  label: 'Image Gen' },
  // Voice covers both text-to-speech and speech-to-text models.
  { id: 'voice',  label: 'Voice Models' },
];

function matchesFilter(item: DownloadItem, filter: FilterType): boolean {
  if (filter === 'all')    return true;
  if (filter === 'vision') return item.modelType === 'text' && !!item.isVisionModel;
  if (filter === 'text')   return item.modelType === 'text' && !item.isVisionModel;
  if (filter === 'image')  return item.modelType === 'image';
  if (filter === 'voice')  return item.modelType === 'tts' || item.modelType === 'stt';
  return true;
}

export const DownloadManagerScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const {
    activeItems,
    completedItems,
    alertState,
    setAlertState,
    handleRemoveDownload,
    handleRetryDownload,
    handlePauseDownload,
    handleResumeDownload,
    handleDeleteItem,
    handleRepairVision,
    isRepairingVision,
    totalStorageUsed,
  } = useDownloadManager();

  const filteredActive = activeItems.filter(item => matchesFilter(item, activeFilter));
  const filteredCompleted = completedItems.filter(item => matchesFilter(item, activeFilter));
  // Split "active" into truly-downloading vs queued via the SAME classifier the per-row
  // clock uses, so the header count can't claim a queued item is actively downloading.
  const activeQueuedCount = filteredActive.filter(i => isQueuedStatus(i.status as DownloadStatus)).length;
  // Count only rows actually transferring — NOT (total - queued), which wrongly folded
  // a failed row into "downloading" and made this diverge from the ModelsScreen badge
  // (isActiveStatus, which excludes failed). Using the shared isDownloadingStatus makes
  // downloading + queued equal the badge's isActiveStatus set exactly (B7/T001).
  const activeDownloadingCount = filteredActive.filter(i => i.status === 'downloading' || isDownloadingStatus(i.status as DownloadStatus)).length;
  // Failed/retriable rows are shown here as cards; surface their count too so this screen and the
  // ModelsScreen badge agree on "outstanding download work" (badge = downloading + queued + failed).
  const activeFailedCount = filteredActive.filter(i => isFailedStatus(i.status as DownloadStatus)).length;
  const activePausedCount = filteredActive.filter(i => i.status === 'paused').length;

  const renderHeader = useCallback(() => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterBarContent}
    >
      {FILTERS.map(f => {
        const active = activeFilter === f.id;
        return (
          <TouchableOpacity
            key={f.id}
            style={[styles.filterChip, active && styles.filterChipActive]}
            onPress={() => setActiveFilter(f.id)}
          >
            <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  ), [activeFilter, styles]);

  return (
    <AliveScreen style={styles.container} testID="downloaded-models-screen">
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} testID="back-button">
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Downloads</Text>
      </View>

      <FlatList
        {...LIST_CLIPPING_PROPS}
        data={[{ key: 'content' }]}
        ListHeaderComponent={renderHeader}
        renderItem={() => (
          <View style={styles.content}>
            {/* Active Downloads — only show when there are active items */}
            {filteredActive.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Downloading</Text>
                  {/* The count is what is moving; with nothing moving, the words beside it say why. */}
                  {activeDownloadingCount > 0 && (
                    <View style={styles.countBadge}>
                      <Text testID="dm-active-downloading-count" style={styles.countText}>{activeDownloadingCount}</Text>
                    </View>
                  )}
                  {activeQueuedCount > 0 && (
                    <Text testID="dm-active-queued-count" style={[styles.countText, { color: colors.textSecondary }]}>
                      {activeQueuedCount} queued
                    </Text>
                  )}
                  {activePausedCount > 0 && (
                    <Text testID="dm-active-paused-count" style={[styles.countText, { color: colors.textSecondary }]}>
                      {activePausedCount} paused
                    </Text>
                  )}
                  {activeFailedCount > 0 && (
                    <Text testID="dm-active-failed-count" style={[styles.countText, { color: colors.error ?? colors.textSecondary }]}>
                      {activeFailedCount} failed
                    </Text>
                  )}
                </View>
                <ListGroup style={styles.downloadCardInset}>
                  {filteredActive.map(item => (
                    <ActiveDownloadCard key={`active-${item.modelId}-${item.fileName}`} item={item} onRemove={handleRemoveDownload} onRetry={handleRetryDownload} onPause={handlePauseDownload} onResume={handleResumeDownload} />
                  ))}
                </ListGroup>
              </View>
            )}

            {/* Downloaded Models */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>On this phone</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{filteredCompleted.length}</Text>
                </View>
              </View>
              {filteredCompleted.length > 0 ? (
                <ListGroup style={styles.downloadCardInset}>
                  {filteredCompleted.map(item => (
                    <CompletedDownloadCard key={`completed-${item.modelId}-${item.fileName}`} item={item} onDelete={handleDeleteItem} onRepairVision={handleRepairVision} onPauseRepair={handlePauseDownload} onResumeRepair={handleResumeDownload} onCancelRepair={handleRemoveDownload} isRepairingVision={isRepairingVision(item.modelId)} />
                  ))}
                </ListGroup>
              ) : (
                <Card style={styles.emptyCard}>
                  <Icon name="package" size={24} color={colors.textMuted} />
                  <Text style={styles.emptyText}>
                    {activeFilter === 'all' ? 'No models downloaded yet' : `No ${FILTERS.find(f => f.id === activeFilter)?.label ?? ''} models`}
                  </Text>
                </Card>
              )}
            </View>

            {/* Storage Info */}
            {completedItems.length > 0 && (
              <View style={styles.storageSection}>
                <View style={styles.storageRow}>
                  <Icon name="hard-drive" size={16} color={colors.textMuted} />
                  <Text style={styles.storageText}>
                    {formatBytes(totalStorageUsed)} used on this phone
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}
        keyExtractor={item => item.key}
        contentContainerStyle={styles.listContent}
      />

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
