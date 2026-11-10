import React from 'react';
import { View, Text } from 'react-native';
import { TouchableOpacity } from '../../components/Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { ModelCard } from '../../components/ModelCard';
import { GROUPED_CARD_ROW } from '../../components/ListGroup';
import { useTheme, useThemedStyles } from '../../theme';
import { useDownloadStore } from '../../stores/downloadStore';
import { BackgroundDownloadReasonCode } from '../../types';
import { needsVisionRepair as checkNeedsVisionRepair } from '../../utils/visionRepair';
import { getDownloadStatusLabel, isRetryable } from '../../utils/downloadErrors';
import { formatShortDate } from '../../utils/localTime';
import { downloadStatusIcon } from '../../utils/downloadStatusIcon';
import { createStyles } from './styles';
import { presentProgress } from '../../utils/progressPresentation';
import { SPACING } from '../../constants';
import { isMMProjFile } from '../../services/mmproj';
import { isRawModelName, modelDisplayName, splitGgufModelName } from '@offgrid/models';

/** The name a person knows a download by: the model's own name, else what the shared resolver
 *  reads from its file ("K2 Horizon 3.7B", never `K2-Horizon-4B-Q4_K_M`). Stripping the extension
 *  here first hid the file name from the resolver, so rows showed it raw (review page, Downloads). */
export function downloadDisplayName(item: Pick<DownloadItem, 'name' | 'fileName'>): string {
  if (item.name?.trim() && !isRawModelName(item.name)) return item.name;
  const file = item.name?.trim() || item.fileName;
  return modelDisplayName(file)
    ?? splitGgufModelName(file).replace(/\.(gguf|bin|onnx|zip|tar|litertlm|task)$/i, '');
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type DownloadItem = {
  type: 'active' | 'completed';
  modelType: 'text' | 'image' | 'video' | 'tts' | 'stt' | 'embedding';
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

  // Failed or paused before a byte arrived: there is no progress to draw, so no bar and no "0 B" line
  // (hand test 47: a paused row said 6.28 GB, then 0 B / 6.3 GB 0%, then Paused).
  const nothingReceived =
    (item.status === 'failed' || item.status === 'paused') && percentage === 0;

  // On the title line, as on a downloaded row, so a failed or paused row has no line of its own
  // for two icons (hand test 46).
  const transferActions = (
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
                  accessibilityLabel={`Retry ${downloadDisplayName(item)}`}
                  onPress={() => onRetry(item)}
                >
                  <Icon
                    name="refresh-cw"
                    size={14}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              )}
            <TouchableOpacity
              style={styles.transferIconButton}
              hitSlop={SPACING.md}
              testID="failed-remove-button"
              accessibilityRole="button"
              accessibilityLabel={`Remove ${downloadDisplayName(item)}`}
              onPress={() => onRemove(item)}
            >
              <Icon name="trash-2" size={14} color={colors.textMuted} />
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
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.transferIconButton}
              testID="remove-download-button"
              accessibilityRole="button"
              accessibilityLabel={`Remove ${downloadDisplayName(item)}`}
              hitSlop={6}
              onPress={() => onRemove(item)}
            >
              <Icon name="x" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </>
        )}
      </View>
  );

  return (
    <ModelCard
      compact
      style={GROUPED_CARD_ROW}
      model={{ id: item.modelId, name: downloadDisplayName(item), author: item.author,
        modelType: item.isVisionModel ? 'vision' : item.modelType === 'text' ? 'text' : undefined }}
      file={{ name: splitGgufModelName(item.fileName), size: item.fileSize, quantization: item.quantization, downloadUrl: '' }}
      trailing={transferActions}
      facts={[
        item.modelType === 'tts'
          ? 'Voice'
          : item.modelType === 'stt'
            ? 'Speech'
            : item.modelType === 'video'
              ? 'Video'
              : item.modelType === 'image'
                ? 'Image'
                : 'Text',
      ]}
      footer={
        <>
          <View style={styles.progressContainer}>
            {/* A failed download that never started has no progress to show: no bar row at all
                (hand test 34: an empty bar read as stuck). It keeps the bar once some bytes arrived. */}
            {nothingReceived ? null : (
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
            </View>
            )}
            {/* Nothing received: no bytes line and no percent, so no empty line above the error. */}
            {nothingReceived ? null : (
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
            )}
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
    <View>
      <ModelCard
        compact
        style={GROUPED_CARD_ROW}
        model={{
          id: item.modelId,
          name: downloadDisplayName(item),
          author: item.author,
          modelType: item.isVisionModel
            ? 'vision'
            : item.modelType === 'text'
              ? 'text'
              : undefined,
        }}
        file={{ name: splitGgufModelName(item.fileName), size: item.fileSize, quantization: item.quantization, downloadUrl: '' }}
        // The date joins size and quant on the one Mono line, not a sentence line of its own.
        facts={item.downloadedAt ? [formatShortDate(item.downloadedAt)] : undefined}
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
