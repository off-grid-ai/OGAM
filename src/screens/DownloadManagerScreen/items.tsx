import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Card } from '../../components';
import { useTheme, useThemedStyles } from '../../theme';
import { useDownloadStore } from '../../stores/downloadStore';
import { BackgroundDownloadReasonCode } from '../../types';
import { needsVisionRepair as checkNeedsVisionRepair } from '../../utils/visionRepair';
import {
  getDownloadStatusLabel,
  isRetryable,
} from '../../utils/downloadErrors';
import { downloadStatusIcon } from '../../utils/downloadStatusIcon';
import { formatBytes } from '../../utils/formatBytes';
import { createStyles } from './styles';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DownloadItem = {
  type: 'active' | 'completed';
  modelType: 'text' | 'image' | 'tts' | 'stt';
  downloadId?: string;
  modelKey?: string;
  modelId: string;
  fileName: string;
  author: string;
  quantization: string;
  fileSize: number;
  bytesDownloaded: number;
  progress: number;
  status: string;
  downloadedAt?: string;
  filePath?: string;
  isVisionModel?: boolean;
  mmProjPath?: string;
  mmProjFileName?: string;
  reason?: string;
  reasonCode?: BackgroundDownloadReasonCode;
  name?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Re-export the canonical byte formatter so the Download Manager modules that
// import it from here keep working, with one shared implementation.
export { formatBytes } from '../../utils/formatBytes';

export function getStatusText(status: string): string {
  if (status === 'running') return 'Downloading...';
  if (status === 'pending') return 'Queued';
  if (status === 'paused') return 'Paused';
  if (status === 'retrying') return 'Retrying connection...';
  if (status === 'waiting_for_network') return 'Waiting for network';
  if (status === 'failed') return 'Needs attention';
  if (status === 'unknown') return 'Stuck - Remove & retry';
  return status;
}

function getStatusLabel(item: DownloadItem): string {
  if (item.status === 'running') return '';
  if (
    item.status === 'failed' ||
    item.status === 'retrying' ||
    item.status === 'pending' ||
    item.status === 'waiting_for_network'
  ) {
    return getDownloadStatusLabel(item.status, item.reasonCode, item.reason);
  }
  if (!item.reason && !item.reasonCode) return getStatusText(item.status);
  return getDownloadStatusLabel(item.status, item.reasonCode, item.reason);
}

// ─── Item components ──────────────────────────────────────────────────────────

interface ActiveDownloadCardProps {
  item: DownloadItem;
  onRemove: (item: DownloadItem) => void;
  onRetry: (item: DownloadItem) => void;
}

export const ActiveDownloadCard: React.FC<ActiveDownloadCardProps> = ({
  item,
  onRemove,
  onRetry,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const progressColor =
    item.status === 'failed'
      ? colors.error
      : item.status === 'retrying' || item.status === 'waiting_for_network'
      ? colors.warning
      : colors.primary;

  // Icon per status is owned by downloadStatusIcon() so this row and ModelCard match
  // (queued -> clock, previously text-only here).
  const getStatusIcon = () => downloadStatusIcon(item.status);

  const getStatusIconColor = () => {
    if (item.status === 'failed') return colors.error;
    if (item.status === 'retrying') return colors.warning;
    if (item.status === 'waiting_for_network') return colors.warning;
    return colors.textMuted;
  };

  return (
    <Card
      style={styles.downloadCard}
      testID={`active-download-${item.modelId}`}
    >
      <View style={styles.downloadHeader}>
        <View style={styles.downloadInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {item.fileName}
          </Text>
          <Text style={styles.modelId} numberOfLines={1}>
            {item.author}
          </Text>
        </View>
        {item.status !== 'failed' && (
          <TouchableOpacity
            style={styles.cancelButton}
            testID="remove-download-button"
            onPress={() => onRemove(item)}
          >
            <Icon name="x" size={20} color={colors.error} />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.progressContainer}>
        <View style={styles.progressBarBackground}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${Math.round(item.progress * 100)}%` as const,
                backgroundColor: progressColor,
              },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {formatBytes(item.bytesDownloaded)} / {formatBytes(item.fileSize)}
        </Text>
      </View>
      <View style={styles.downloadMeta}>
        {!!item.quantization && (
          <View style={styles.quantBadge}>
            <Text style={styles.quantText}>{item.quantization}</Text>
          </View>
        )}
        {(!!getStatusLabel(item) || !!getStatusIcon()) && (
          <View style={styles.statusIconRow}>
            {getStatusIcon() && (
              <Icon
                name={getStatusIcon()!}
                size={14}
                color={getStatusIconColor()}
                accessibilityLabel={getStatusText(item.status)}
              />
            )}
            {/* Queued is icon-only (clock) — the word is redundant next to it. Other states
                (failed/retrying/network) keep their explanatory text. */}
            {item.status !== 'pending' && !!getStatusLabel(item) && (
              <Text
                style={[
                  styles.statusText,
                  item.status === 'failed' && { color: colors.error },
                ]}
              >
                {getStatusLabel(item)}
              </Text>
            )}
          </View>
        )}
      </View>
      {item.status === 'failed' && (
        <View style={styles.failedActionsRow}>
          {isRetryable(item.reasonCode) && (
            <TouchableOpacity
              style={styles.retryButton}
              testID="failed-retry-button"
              onPress={() => onRetry(item)}
            >
              <Icon name="refresh-cw" size={14} color={colors.primary} />
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.removeButton}
            testID="failed-remove-button"
            onPress={() => onRemove(item)}
          >
            <Icon name="trash-2" size={14} color={colors.error} />
            <Text style={styles.removeButtonText}>Remove</Text>
          </TouchableOpacity>
        </View>
      )}
    </Card>
  );
};

interface CompletedDownloadCardProps {
  item: DownloadItem;
  onDelete: (item: DownloadItem) => void;
  onRepairVision?: (item: DownloadItem) => void;
  isRepairingVision?: boolean;
}

/** Feather icon for a completed model row. A vision model missing its projector reads as
 *  "needs repair" (wrench), not "has vision" (eye) — actionable-broken, not a working capability. */
function modelTypeIconName(
  item: DownloadItem,
  needsVisionRepair: boolean,
): string {
  if (item.modelType === 'image') return 'image';
  if (item.modelType === 'tts') return 'volume-2';
  if (item.modelType === 'stt') return 'mic';
  if (needsVisionRepair) return 'tool';
  if (item.isVisionModel) return 'eye';
  return 'message-square';
}

function modelTypeIconColor(
  item: DownloadItem,
  needsVisionRepair: boolean,
  colors: ReturnType<typeof useTheme>['colors'],
): string {
  if (item.modelType === 'image') return colors.info;
  if (item.modelType === 'tts' || item.modelType === 'stt')
    return colors.success;
  if (needsVisionRepair || item.isVisionModel) return colors.warning;
  return colors.primary;
}

export const CompletedDownloadCard: React.FC<CompletedDownloadCardProps> = ({
  item,
  onDelete,
  onRepairVision,
  isRepairingVision = false,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const needsVisionRepair = checkNeedsVisionRepair(item);
  // A vision repair drives a live download-store row keyed on the completed
  // model's modelKey (`repo/file` = item.modelId). Read it so the SAME
  // determinate progress bar the normal download shows lights up during the
  // ~900MB mmproj re-download, instead of a bare indeterminate spinner (OD2).
  const repairEntry = useDownloadStore(s => s.downloads[item.modelId]);
  const showRepairProgress = isRepairingVision && !!repairEntry;

  return (
    <Card style={styles.downloadCard}>
      <View style={styles.downloadHeader}>
        <View style={styles.modelTypeIcon}>
          <Icon
            name={modelTypeIconName(item, needsVisionRepair)}
            size={16}
            color={modelTypeIconColor(item, needsVisionRepair, colors)}
          />
        </View>
        <View style={styles.downloadInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {item.fileName}
          </Text>
          <Text style={styles.modelId} numberOfLines={1}>
            {item.author}
          </Text>
        </View>
        {needsVisionRepair && !isRepairingVision && onRepairVision && (
          <TouchableOpacity
            style={styles.repairButton}
            testID="repair-vision-button"
            onPress={() => onRepairVision(item)}
          >
            <Icon name="tool" size={18} color={colors.warning} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.deleteButton}
          testID="delete-model-button"
          onPress={() => onDelete(item)}
        >
          <Icon name="trash-2" size={18} color={colors.error} />
        </TouchableOpacity>
      </View>
      {showRepairProgress && (
        <View style={styles.progressContainer} testID="repair-vision-progress">
          <View style={styles.progressBarBackground}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.round(repairEntry.progress * 100)}%` as const,
                  backgroundColor: colors.primary,
                },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {formatBytes(repairEntry.bytesDownloaded)} /{' '}
            {formatBytes(repairEntry.totalBytes)}
          </Text>
        </View>
      )}
      <View style={styles.downloadMeta}>
        {!!item.quantization && (
          <View
            style={[
              styles.quantBadge,
              item.modelType === 'image' && styles.imageBadge,
            ]}
          >
            <Text
              style={[
                styles.quantText,
                item.modelType === 'image' && styles.imageQuantText,
              ]}
            >
              {item.quantization}
            </Text>
          </View>
        )}
        <Text style={styles.sizeText}>{formatBytes(item.fileSize)}</Text>
        {item.downloadedAt && (
          <Text style={styles.dateText}>
            {new Date(item.downloadedAt).toLocaleDateString()}
          </Text>
        )}
        {isRepairingVision && (
          <View style={styles.repairingBadge} testID="repairing-vision-badge">
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.repairingBadgeText}>Repairing</Text>
          </View>
        )}
      </View>
    </Card>
  );
};
