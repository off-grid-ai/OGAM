import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useThemedStyles, useTheme } from '../theme';
import { CREDIBILITY_LABELS } from '../constants';
import { QUANTIZATION_INFO } from '@offgrid/application';
import { ModelFile, DownloadedModel, ModelCredibility } from '../types';
import { needsVisionRepair } from '../utils/visionRepair';
import { getMmProjFileSize } from '../utils/modelHelpers';
import { createStyles } from './ModelCard.styles';
import {
  DenseModelCardContent,
  StandardModelCardContent,
  ModelInfoBadges,
  ModelCardActions,
  RecommendedConfig,
} from './ModelCardContent';
import { PAUSED_ICON, QUEUED_ICON } from '../utils/downloadStatusIcon';
import { formatBytes } from '../utils/formatBytes';
import { presentProgress } from '../utils/progressPresentation';

interface ModelCardProps {
  model: {
    id: string;
    name: string;
    author: string;
    description?: string;
    downloads?: number;
    likes?: number;
    credibility?: ModelCredibility;
    files?: ModelFile[];
    modelType?: 'text' | 'vision' | 'code';
    paramCount?: number;
    minRamGB?: number;
  };
  file?: ModelFile;
  downloadedModel?: DownloadedModel;
  isDownloaded?: boolean;
  isDownloading?: boolean;
  /** Accepted but waiting for a concurrency slot — shows a "Queued" label instead of a
   *  0% progress bar, so the user gets clear feedback the tap registered. */
  isQueued?: boolean;
  /** A person paused this download. The bytes on disk still show; the label says "Paused" so the
   *  card reads as neither idle nor downloading. */
  isPaused?: boolean;
  downloadProgress?: number;
  downloadBytes?: { downloaded: number; total: number; bytesPerSecond?: number };
  /** Concurrent downloads behind this card (main+mmproj / grouped) → "N downloads". */
  downloadCount?: number;
  isActive?: boolean;
  isCompatible?: boolean;
  incompatibleReason?: string;
  testID?: string;
  onPress?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  onSelect?: () => void;
  onRepairVision?: () => void;
  isRepairingVision?: boolean;
  onCancel?: () => void;
  compact?: boolean;
  isTrending?: boolean;
  recommended?: RecommendedConfig;
  /** Model can run on the GPU/NPU (LiteRT or Q4_0/Q8_0 GGUF) → show the badge. */
  supportsAcceleration?: boolean;
  failedState?: {
    errorMessage: string;
    bytesDownloaded: number;
    totalBytes: number;
    onRetry: () => void;
    onRemove: () => void;
  };
}

function resolveQuantInfo(file?: ModelFile, downloadedModel?: DownloadedModel) {
  const quant = file?.quantization ?? downloadedModel?.quantization;
  return quant ? (QUANTIZATION_INFO[quant] ?? null) : null;
}

function resolveFileSize(file?: ModelFile, downloadedModel?: DownloadedModel) {
  const main = file?.size ?? downloadedModel?.fileSize ?? 0;
  const mmProj = file?.mmProjFile?.size ?? getMmProjFileSize(downloadedModel);
  return main + mmProj;
}

function resolveCredibility(
  model: { credibility?: ModelCredibility },
  downloadedModel?: DownloadedModel,
) {
  return model.credibility ?? downloadedModel?.credibility;
}

interface ModelCardHeadingProps {
  dense: boolean;
  model: ModelCardProps['model'];
  fileSize: number;
  quantization?: string;
  isVisionModel: boolean;
  supportsAcceleration?: boolean;
  recommended?: RecommendedConfig;
  isTrending?: boolean;
  credibility?: ModelCredibility;
  credibilityInfo: { color: string; label: string } | null;
  isActive?: boolean;
  incompatibleReason?: string;
}

const ModelCardHeading: React.FC<ModelCardHeadingProps> = ({
  dense, model, fileSize, quantization, isVisionModel, supportsAcceleration,
  recommended, isTrending, credibility, credibilityInfo, isActive, incompatibleReason,
}) => dense ? (
  <DenseModelCardContent
    model={model}
    fileSize={fileSize}
    quantization={quantization}
    isVisionModel={isVisionModel}
    supportsAcceleration={supportsAcceleration}
    recommended={recommended}
    isTrending={isTrending}
    credibilitySource={credibility?.source}
    credibilityLabel={credibilityInfo?.label}
    incompatibleReason={incompatibleReason}
  />
) : (
  <StandardModelCardContent
    model={model}
    credibility={credibility}
    credibilityInfo={credibilityInfo}
    isActive={isActive}
    recommended={recommended}
    supportsAcceleration={supportsAcceleration}
  />
);

const ModelDownloadStats: React.FC<{
  compact?: boolean;
  downloads?: number;
  likes?: number;
  styles: ReturnType<typeof createStyles>;
}> = ({ compact, downloads = 0, likes = 0, styles }) => {
  if (compact || downloads <= 0) return null;
  return (
    <View style={styles.statsRow}>
      <Text style={styles.statsText}>{formatNumber(downloads)} downloads</Text>
      {likes > 0 && <Text style={styles.statsText}>{formatNumber(likes)} likes</Text>}
    </View>
  );
};

const DownloadProgressSection: React.FC<{
  progress: number;
  bytes?: { downloaded: number; total: number; bytesPerSecond?: number };
  queued?: boolean;
  paused?: boolean;
  /** Number of concurrent downloads behind this card (>1 → show "N downloads"). */
  count?: number;
}> = ({ progress, bytes, queued, paused, count }) => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const presented = presentProgress({
    progress,
    bytesDownloaded: bytes?.downloaded,
    totalBytes: bytes?.total,
    bytesPerSecond: bytes?.bytesPerSecond,
    status: queued ? 'pending' : paused ? 'paused' : 'running',
  });
  const percentage = presented.progress.percentage ?? 0;
  // Cumulative download → note how many files are running so the total reads clearly.
  const countLabel = count && count > 1 ? `${count} downloads` : '';
  // No rate while queued or paused: nothing is moving, so a stale rate would be a lie.
  const caption = [
    presented.bytesText,
    queued || paused ? undefined : presented.rateText,
    countLabel,
  ].filter(Boolean).join(' · ');
  const statusLabel = queued ? (
    <View style={styles.progressLabelRow}>
      <Icon name={QUEUED_ICON} size={12} color={colors.textMuted} accessibilityLabel="Queued" />
      <Text style={[styles.progressText, styles.queuedText]}>Queued</Text>
    </View>
  ) : paused ? (
    // Paused keeps the FILLED bar (the bytes are on disk) and says so, where queued shows an
    // empty one: the person stopped this, they did not just ask for it.
    <View style={styles.progressLabelRow}>
      <Icon name={PAUSED_ICON} size={12} color={colors.textSecondary} accessibilityLabel="Paused" />
      <Text style={[styles.progressText, styles.pausedText]}>Paused</Text>
    </View>
  ) : (
    <Text style={styles.progressText}>{presented.percentageText ?? 'In progress'}</Text>
  );
  return (
  <View style={styles.progressSection}>
    {/* Full-width bar so it uses the whole card width. Queued shows an EMPTY bar
        (0 progress) so it reads as "not started yet". */}
    <View style={styles.progressBar}>
      <View style={[styles.progressFill, { width: `${queued ? 0 : percentage}%` }]} />
    </View>
    {/* Caption row under the bar: bytes (+ "N downloads") on the LEFT, status on the
        RIGHT. "Queued" while waiting for a slot, otherwise the percent. */}
    <View style={styles.progressCaptionRow}>
      <Text style={styles.progressBytesText}>{caption}</Text>
      {statusLabel}
    </View>
  </View>
  );
};

const FailedSection: React.FC<{
  errorMessage: string;
  bytesDownloaded: number;
  totalBytes: number;
  onRetry: () => void;
  onRemove: () => void;
}> = ({ errorMessage, bytesDownloaded, totalBytes, onRetry, onRemove }) => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const presented = presentProgress({
    bytesDownloaded,
    totalBytes,
    status: 'failed',
  });
  const progress = presented.progress.percentage ?? 0;
  return (
    <View style={styles.failedSection}>
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.failedProgressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.progressText}>{presented.percentageText ?? 'Stopped'}</Text>
      </View>
      {totalBytes > 0 && (
        <Text style={styles.progressBytesText}>{formatBytes(bytesDownloaded)} / {formatBytes(totalBytes)}</Text>
      )}
      <View style={styles.failedMessageRow}>
        <Icon name="alert-circle" size={13} color={colors.error} />
        <Text style={styles.failedMessageText}>{errorMessage}</Text>
      </View>
      <View style={styles.failedActionsRow}>
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Icon name="refresh-cw" size={13} color={colors.primary} />
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.removeButton} onPress={onRemove}>
          <Icon name="trash-2" size={13} color={colors.error} />
          <Text style={styles.removeButtonText}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export const ModelCard: React.FC<ModelCardProps> = ({
  model,
  file,
  downloadedModel,
  isDownloaded,
  isDownloading,
  isQueued,
  isPaused,
  downloadProgress = 0,
  downloadBytes,
  downloadCount,
  isActive,
  isCompatible = true,
  incompatibleReason,
  testID,
  onPress,
  onDownload,
  onDelete,
  onSelect,
  onRepairVision,
  isRepairingVision,
  onCancel,
  compact,
  isTrending,
  recommended,
  supportsAcceleration,
  failedState,
}) => {
  const styles = useThemedStyles(createStyles);
  const useDenseLayout = compact;

  const quantInfo = resolveQuantInfo(file, downloadedModel);
  const fileSize = resolveFileSize(file, downloadedModel);
  const isVisionModel = !!(file?.mmProjFile || (downloadedModel?.engine === 'llama' && downloadedModel.isVisionModel));
  const needsRepair = needsVisionRepair(downloadedModel, file);

  const sizeRange = React.useMemo(() => {
    if (fileSize > 0 || !model.files || model.files.length === 0) return null;
    const sizes = model.files.map(f => f.size).filter(s => s > 0);
    if (sizes.length === 0) return null;
    return {
      min: Math.min(...sizes),
      max: Math.max(...sizes),
      count: model.files.length,
    };
  }, [model.files, fileSize]);

  const credibility = resolveCredibility(model, downloadedModel);
  const credibilityInfo = credibility ? CREDIBILITY_LABELS[credibility.source] : null;
  const quantization = file?.quantization ?? downloadedModel?.quantization;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        useDenseLayout && styles.cardDense,
        isActive && styles.cardActive,
        !isCompatible && styles.cardIncompatible,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
      testID={testID}
    >
      <View style={[styles.cardRow, useDenseLayout && styles.cardRowDense]}>
        <View style={styles.cardContent}>
          <ModelCardHeading
            dense={!!useDenseLayout}
            model={model}
            fileSize={fileSize}
            quantization={quantization}
            isVisionModel={isVisionModel}
            supportsAcceleration={supportsAcceleration}
            recommended={recommended}
            isTrending={isTrending}
            credibility={credibility}
            credibilityInfo={credibilityInfo}
            isActive={isActive}
            incompatibleReason={!isCompatible ? (incompatibleReason ?? 'Too large') : undefined}
          />

          {!useDenseLayout && (
            <ModelInfoBadges
              fileSize={fileSize}
              sizeRange={sizeRange}
              quantInfo={quantInfo}
              quantization={quantization}
              isVisionModel={isVisionModel}
              needsRepair={needsRepair}
              isRepairingVision={isRepairingVision}
              isCompatible={isCompatible}
              incompatibleReason={incompatibleReason}
            />
          )}

          <ModelDownloadStats compact={compact} downloads={model.downloads} likes={model.likes} styles={styles} />

          {(isDownloading || isQueued || isPaused) && (
            <DownloadProgressSection progress={downloadProgress} bytes={downloadBytes} queued={isQueued} paused={isPaused} count={downloadCount} />
          )}
          {failedState && (
            <FailedSection
              errorMessage={failedState.errorMessage}
              bytesDownloaded={failedState.bytesDownloaded}
              totalBytes={failedState.totalBytes}
              onRetry={failedState.onRetry}
              onRemove={failedState.onRemove}
            />
          )}
        </View>

        {!failedState && (
          <ModelCardActions
            isDownloaded={isDownloaded}
            isDownloading={isDownloading}
            isQueued={isQueued}
            isPaused={isPaused}
            isActive={isActive}
            isCompatible={isCompatible}
            incompatibleReason={incompatibleReason}
            testID={testID}
            onDownload={onDownload}
            onSelect={onSelect}
            onDelete={onDelete}
            onRepairVision={onRepairVision}
            isRepairingVision={isRepairingVision}
            onCancel={onCancel}
          />
        )}
      </View>
    </TouchableOpacity>
  );
};

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}
