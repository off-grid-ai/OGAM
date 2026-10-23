import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { ModelCard } from '../../components/ModelCard';
import { useTheme, useThemedStyles } from '../../theme';
import { useDownloadStore } from '../../stores/downloadStore';
import { BackgroundDownloadReasonCode } from '../../types';
import { needsVisionRepair as checkNeedsVisionRepair } from '../../utils/visionRepair';
import { getDownloadStatusLabel, isRetryable } from '../../utils/downloadErrors';
import { downloadStatusIcon } from '../../utils/downloadStatusIcon';
import { createStyles } from './styles';
import { presentProgress } from '../../utils/progressPresentation';
import { SPACING } from '../../constants';
import { isMMProjFile } from '../../services/mmproj';
import { predictGgufCapabilities } from '../../utils/ggufCapabilities';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DownloadItem = {
  type: 'active' | 'completed';
  modelType: 'text' | 'image' | 'video' | 'tts' | 'stt';
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
  canPause?: boolean;
  canResume?: boolean;
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

function textCapabilities(item: DownloadItem) {
  if (item.modelType !== 'text' || !item.fileName.toLowerCase().endsWith('.gguf')) return undefined;
  const predicted = predictGgufCapabilities({
    id: item.modelId,
    name: item.name,
    fileName: item.fileName,
  });
  return { ...predicted, vision: !!item.isVisionModel, predicted: true };
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
  onPause: (item: DownloadItem) => void;
  onResume: (item: DownloadItem) => void;
}

export const ActiveDownloadCard: React.FC<ActiveDownloadCardProps> = ({
  item,
  onRemove,
  onRetry,
  onPause,
  onResume,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const progressColor =
    item.status === 'failed'
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
    if (item.status === 'failed') return colors.error;
    if (item.status === 'retrying') return colors.warning;
    if (item.status === 'waiting_for_network') return colors.warning;
    return colors.textMuted;
  };

  return (
    <ModelCard
      compact
      model={{
        id: item.modelId,
        name: item.fileName,
        author: item.author,
        modelType: item.isVisionModel
          ? 'vision'
          : item.modelType === 'text'
            ? 'text'
            : undefined,
      }}
      file={{
        name: item.fileName,
        size: item.fileSize,
        quantization: item.quantization,
        downloadUrl: '',
      }}
      capabilities={textCapabilities(item)}
      facts={[
        item.modelType === 'tts'
          ? 'Voice'
          : item.modelType === 'stt'
            ? 'Transcription'
            : item.modelType === 'video'
              ? 'Video'
              : item.modelType === 'image'
                ? 'Image'
                : 'Text',
      ]}
      footer={
        <>
          <View style={styles.progressContainer}>
            <View style={styles.transferRow}>
              <View
                style={[
                  styles.progressBarBackground,
                  styles.transferProgressBar,
                ]}
              >
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${percentage}%` as const,
                      backgroundColor: progressColor,
                    },
                  ]}
                />
              </View>
              <View style={styles.transferActions}>
                {item.status === 'failed' ? (
                  <>
                    {isRetryable(item.reasonCode) &&
                      !item.modelKey?.startsWith('model-download:') && (
                        <TouchableOpacity
                          style={styles.transferIconButton}
                          hitSlop={SPACING.md}
                          testID="failed-retry-button"
                          accessibilityRole="button"
                          accessibilityLabel={`Retry ${item.fileName}`}
                          onPress={() => onRetry(item)}
                        >
                          <Icon
                            name="refresh-cw"
                            size={14}
                            color={colors.primary}
                          />
                        </TouchableOpacity>
                      )}
                    <TouchableOpacity
                      style={styles.transferIconButton}
                      hitSlop={SPACING.md}
                      testID="failed-remove-button"
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.fileName}`}
                      onPress={() => onRemove(item)}
                    >
                      <Icon name="trash-2" size={14} color={colors.error} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {(item.canPause || item.canResume) && (
                      <TouchableOpacity
                        style={styles.transferIconButton}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.canResume ? 'Resume' : 'Pause'} ${item.fileName}`}
                        hitSlop={6}
                        onPress={() =>
                          item.canResume ? onResume(item) : onPause(item)
                        }
                      >
                        <Icon
                          name={item.canResume ? 'play' : 'pause'}
                          size={14}
                          color={colors.primary}
                        />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.transferIconButton}
                      testID="remove-download-button"
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.fileName}`}
                      hitSlop={6}
                      onPress={() => onRemove(item)}
                    >
                      <Icon name="x" size={16} color={colors.error} />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
            <View style={styles.transferCaptionRow}>
              <Text
                style={styles.progressText}
                testID="download-progress-detail"
              >
                {presented.detailText}
              </Text>
              <Text style={styles.progressText}>
                {presented.percentageText}
              </Text>
            </View>
          </View>
          <View style={styles.downloadMeta}>
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
        </>
      }
    />
  );
};

interface CompletedDownloadCardProps {
  item: DownloadItem;
  onDelete: (item: DownloadItem) => void;
  onRepairVision?: (item: DownloadItem) => void;
  onPauseRepair?: (item: DownloadItem) => void;
  onResumeRepair?: (item: DownloadItem) => void;
  onCancelRepair?: (item: DownloadItem) => void;
  isRepairingVision?: boolean;
}

export const CompletedDownloadCard: React.FC<CompletedDownloadCardProps> = ({
  item,
  onDelete,
  onRepairVision,
  onPauseRepair,
  onResumeRepair,
  onCancelRepair,
  isRepairingVision = false,
}) => {
  const needsVisionRepair = checkNeedsVisionRepair(item);
  // A vision repair drives a live download-store row keyed on the completed
  // model's modelKey (`repo/file` = item.modelId). Read it so the SAME
  // determinate progress bar the normal download shows lights up during the
  // ~900MB mmproj re-download, instead of a bare indeterminate spinner (OD2).
  const repairEntry = useDownloadStore(s => s.downloads[item.modelId]);
  const repairActive = isRepairingVision || !!repairEntry && isMMProjFile(repairEntry.fileName);
  const showRepairProgress = repairActive && !!repairEntry;
  return (
    <View style={{ marginHorizontal: SPACING.md }}>
      <ModelCard
        compact
        model={{
          id: item.modelId,
          name: item.fileName,
          author: item.author,
          modelType: item.isVisionModel
            ? 'vision'
            : item.modelType === 'text'
              ? 'text'
              : undefined,
          description: item.downloadedAt
            ? new Date(item.downloadedAt).toLocaleDateString()
            : undefined,
        }}
        file={{
          name: item.fileName,
          size: item.fileSize,
          quantization: item.quantization,
          downloadUrl: '',
        }}
        capabilities={textCapabilities(item)}
        isDownloaded
        isDownloading={showRepairProgress && repairEntry.status !== 'paused'}
        isPaused={showRepairProgress && repairEntry.status === 'paused'}
        isRepairingVision={repairActive}
        downloadProgress={repairEntry?.progress}
        downloadBytes={
          repairEntry
            ? {
                downloaded: repairEntry.bytesDownloaded,
                total: repairEntry.totalBytes,
                bytesPerSecond: repairEntry.bytesPerSecond,
              }
            : undefined
        }
        onRepairVision={
          needsVisionRepair && onRepairVision
            ? () => onRepairVision(item)
            : undefined
        }
        onPause={
          showRepairProgress &&
          repairEntry.status === 'running' &&
          onPauseRepair
            ? () => onPauseRepair(item)
            : undefined
        }
        onResume={
          showRepairProgress &&
          repairEntry.status === 'paused' &&
          onResumeRepair
            ? () => onResumeRepair(item)
            : undefined
        }
        onCancel={
          showRepairProgress && onCancelRepair
            ? () => onCancelRepair(item)
            : undefined
        }
        onDelete={() => onDelete(item)}
      />
    </View>
  );
};
