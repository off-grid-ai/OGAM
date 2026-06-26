import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { Card } from '../../components';
import { CustomAlert, hideAlert } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';
import { ActiveDownloadCard, CompletedDownloadCard, formatBytes, type DownloadItem } from './items';
import { useDownloadManager } from './useDownloadManager';

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
    handleDeleteItem,
    handleRepairVision,
    isRepairingVision,
    totalStorageUsed,
  } = useDownloadManager();

  const filteredActive = activeItems.filter(item => matchesFilter(item, activeFilter));
  const filteredCompleted = completedItems.filter(item => matchesFilter(item, activeFilter));

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
  ), [activeFilter, colors, styles]);

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="downloaded-models-screen">
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} testID="back-button">
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Download Manager</Text>
      </View>

      <FlatList
        data={[{ key: 'content' }]}
        ListHeaderComponent={renderHeader}
        renderItem={() => (
          <View style={styles.content}>
            {/* Active Downloads — only show when there are active items */}
            {filteredActive.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Icon name="download" size={16} color={colors.primary} />
                  <Text style={styles.sectionTitle}>Active Downloads</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>{filteredActive.length}</Text>
                  </View>
                </View>
                {filteredActive.map(item => (
                  <View key={`active-${item.modelId}-${item.fileName}`}>
                    <ActiveDownloadCard item={item} onRemove={handleRemoveDownload} onRetry={handleRetryDownload} />
                  </View>
                ))}
              </View>
            )}

            {/* Downloaded Models */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon name="check-circle" size={16} color={colors.success} />
                <Text style={styles.sectionTitle}>Downloaded Models</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{filteredCompleted.length}</Text>
                </View>
              </View>
              {filteredCompleted.length > 0 ? (
                filteredCompleted.map(item => (
                  <View key={`completed-${item.modelId}-${item.fileName}`}>
                    <CompletedDownloadCard item={item} onDelete={handleDeleteItem} onRepairVision={handleRepairVision} isRepairingVision={isRepairingVision(item.modelId)} />
                  </View>
                ))
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
                    Total storage used: {formatBytes(totalStorageUsed)}
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
    </SafeAreaView>
  );
};
