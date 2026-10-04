import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { LoadingDots } from '../../components/LoadingDots';
import Icon from 'react-native-vector-icons/Feather';
import { Card } from '../../components/Card';
import { useTheme, useThemedStyles } from '../../theme';
import { BackgroundDownloadReasonCode } from '../../types';
import { needsVisionRepair as checkNeedsVisionRepair } from '../../utils/visionRepair';
import { getDownloadStatusLabel, isRetryable } from '../../utils/downloadErrors';
import { downloadStatusIcon } from '../../utils/downloadStatusIcon';
import { formatBytes } from '../../utils/formatBytes';
import { createStyles } from './styles';
import { presentProgress } from '../../utils/progressPresentation';
import { SPACING } from '../../constants';
import { isDownloadingStatus, isPausedStatus } from '../../utils/downloadStatus';

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
  bytesPerSecond?: number;
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
  if (status === 'preparing') return 'Preparing...';
  if (status === 'running' || status === 'downloading') return 'Downloading...';
  if (status === 'pending' || status === 'queued') return 'Queued';
  if (status === 'paused') return 'Paused';
  if (status === 'verifying') return 'Verifying...';
  if (status === 'processing') return 'Preparing...';
  if (status === 'retrying') return 'Retrying connection...';
  if (status === 'waiting_for_network') return 'Waiting for network';
  if (status === 'failed') return 'Needs attention';
  if (status === 'unknown') return 'Stuck - Remove & retry';
  if (status === 'interrupted') return 'Interrupted';
  return status;
}

function getStatusLabel(item: DownloadItem): string {
  if (item.status === 'running') return '';
  if (item.status === 'failed' || item.status === 'retrying' || item.status === 'pending' || item.status === 'waiting_for_network') {
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
  onPause: (item: DownloadItem) => void;
  onResume: (item: DownloadItem) => void;
}

const DownloadControlActions: React.FC<ActiveDownloadCardProps> = ({
  item,
  onRemove,
  onPause,
  onResume,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const paused = isPausedStatus(item.status);
  const canPauseOrResume = isDownloadingStatus(item.status) || paused;
  return (
    <View style={styles.downloadActionsRow}>
      {canPauseOrResume && (
        <TouchableOpacity
          style={styles.downloadActionButton}
          hitSlop={SPACING.md}
          accessibilityLabel={paused ? 'Resume download' : 'Pause download'}
          testID={paused ? 'resume-download-button' : 'pause-download-button'}
          onPress={() => paused ? onResume(item) : onPause(item)}
        >
          <Icon name={paused ? 'play' : 'pause'} size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={styles.downloadActionButton}
        hitSlop={SPACING.md}
        accessibilityLabel="Cancel download"
        testID="remove-download-button"
        onPress={() => onRemove(item)}
      >
        <Icon name="x" size={20} color={colors.error} />
      </TouchableOpacity>
    </View>
  );
};

export const ActiveDownloadCard: React.FC<ActiveDownloadCardProps> = ({ item, onRemove, onRetry, onPause, onResume }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const needsAttention = item.status === 'failed' || item.status === 'interrupted';
  const progressColor =
    needsAttention
      ? colors.error
      : item.status === 'retrying' || item.status === 'waiting_for_network'
        ? colors.warning
        : colors.primary;
  const presented = presentProgress({
    progress: item.progress,
    bytesDownloaded: item.bytesDownloaded,
    totalBytes: item.fileSize,
    bytesPerSecond: item.bytesPerSecond,
    status: item.status,
  });
  const percentage = presented.progress.percentage ?? 0;

  // Icon per status is owned by downloadStatusIcon() so this row and ModelCard match
  // (queued -> clock, previously text-only here).
  const getStatusIcon = () => downloadStatusIcon(item.status);

  const getStatusIconColor = () => {
    if (needsAttention) return colors.error;
    if (item.status === 'retrying') return colors.warning;
    if (item.status === 'waiting_for_network') return colors.warning;
    return colors.textMuted;
  };

  return (
    <Card style={styles.downloadCard}>
      <View style={styles.downloadHeader}>
        <View style={styles.downloadInfo}>
          <Text style={styles.fileName} numberOfLines={1}>{item.fileName}</Text>
          <Text style={styles.modelId} numberOfLines={1}>{item.author}</Text>
        </View>
        {needsAttention ? (
          <View style={styles.failedActionsRow}>
            {isRetryable(item.reasonCode) && (
              <TouchableOpacity
                style={styles.retryButton}
                hitSlop={SPACING.md}
                testID="failed-retry-button"
                onPress={() => onRetry(item)}
              >
                <Icon name="refresh-cw" size={14} color={colors.primary} />
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.removeButton}
              hitSlop={SPACING.md}
              testID="failed-remove-button"
              onPress={() => onRemove(item)}
            >
              <Icon name="trash-2" size={14} color={colors.error} />
              <Text style={styles.removeButtonText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <DownloadControlActions
            item={item}
            onRemove={onRemove}
            onRetry={onRetry}
            onPause={onPause}
            onResume={onResume}
          />
        )}
      </View>
      <View style={styles.progressContainer}>
        <View style={styles.progressBarBackground}>
          <View style={[styles.progressBarFill, { width: `${percentage}%` as const, backgroundColor: progressColor }]} />
        </View>
        <Text style={styles.progressText} testID="download-progress-detail">
          {[presented.percentageText, presented.detailText].filter(Boolean).join(' · ')}
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
              <Icon name={getStatusIcon()!} size={14} color={getStatusIconColor()} accessibilityLabel={getStatusText(item.status)} />
            )}
            {/* Queued is icon-only (clock) — the word is redundant next to it. Other states
                (failed/retrying/network) keep their explanatory text. */}
            {item.status !== 'pending' && item.status !== 'queued' && !!getStatusLabel(item) && (
              <Text style={[styles.statusText, needsAttention && { color: colors.error }]}>
                {getStatusLabel(item)}
              </Text>
            )}
          </View>
        )}
      </View>
    </Card>
  );
};

interface CompletedDownloadCardProps {
  item: DownloadItem;
  onDelete: (item: DownloadItem) => void;
  onRepairVision?: (item: DownloadItem) => void;
  isRepairingVision?: boolean;
  repairDownload?: DownloadItem;
}

/** Feather icon for a completed model row. A vision model missing its projector reads as
 *  "needs repair" (wrench), not "has vision" (eye) — actionable-broken, not a working capability. */
function modelTypeIconName(item: DownloadItem, needsVisionRepair: boolean): string {
  if (item.modelType === 'image') return 'image';
  if (item.modelType === 'tts') return 'volume-2';
  if (item.modelType === 'stt') return 'mic';
  if (needsVisionRepair) return 'tool';
  if (item.isVisionModel) return 'eye';
  return 'message-square';
}

function modelTypeIconColor(item: DownloadItem, needsVisionRepair: boolean, colors: ReturnType<typeof useTheme>['colors']): string {
  if (item.modelType === 'image') return colors.info;
  if (item.modelType === 'tts' || item.modelType === 'stt') return colors.success;
  if (needsVisionRepair || item.isVisionModel) return colors.warning;
  return colors.primary;
}

export const CompletedDownloadCard: React.FC<CompletedDownloadCardProps> = ({ item, onDelete, onRepairVision, isRepairingVision = false, repairDownload }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const needsVisionRepair = checkNeedsVisionRepair(item);
  const completedMeta = [
    item.author,
    formatBytes(item.fileSize),
    item.quantization,
    item.downloadedAt
      ? new Date(item.downloadedAt).toLocaleDateString()
      : undefined,
  ].filter(Boolean).join(' · ');
  const repairProgress = isRepairingVision && repairDownload
    ? presentProgress({
        progress: repairDownload.progress,
        bytesDownloaded: repairDownload.bytesDownloaded,
        totalBytes: repairDownload.fileSize,
        bytesPerSecond: repairDownload.bytesPerSecond,
        status: repairDownload.status,
      })
    : undefined;

  return (
    <Card style={styles.downloadCard}>
      <View style={[styles.downloadHeader, styles.completedHeader]}>
        <View style={styles.modelTypeIcon}>
          <Icon
            name={modelTypeIconName(item, needsVisionRepair)}
            size={16}
            color={modelTypeIconColor(item, needsVisionRepair, colors)}
          />
        </View>
        <View style={styles.downloadInfo}>
          <Text style={styles.fileName} numberOfLines={1}>{item.fileName}</Text>
          <Text style={styles.modelId} numberOfLines={1}>{completedMeta}</Text>
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
      {isRepairingVision && (
        <View style={styles.repairingBadge} testID="repairing-vision-badge">
          <LoadingDots color={colors.primary} />
          <Text style={styles.repairingBadgeText}>Repairing</Text>
        </View>
      )}
      {repairProgress && (
        <View style={styles.progressContainer} testID="repair-vision-progress">
          <View style={styles.progressBarBackground}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${repairProgress.progress.percentage ?? 0}%` as const,
                  backgroundColor: colors.primary,
                },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {[repairProgress.percentageText, repairProgress.detailText].filter(Boolean).join(' · ')}
          </Text>
        </View>
      )}
    </Card>
  );
};
