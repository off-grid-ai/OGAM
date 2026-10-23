import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useThemedStyles, useTheme } from '../theme';
import { QUANTIZATION_INFO, CREDIBILITY_LABELS } from '../constants';
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
  type ModelCardCapabilities,
  speedHint,
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
    quantization?: string;
  };
  file?: ModelFile;
  downloadedModel?: DownloadedModel;
  isDownloaded?: boolean;
  isDownloading?: boolean;
  /** Accepted but waiting for a concurrency slot — shows a "Queued" label instead of a
   *  0% progress bar, so the user gets clear feedback the tap registered. */
  isQueued?: boolean;
  isPaused?: boolean;
  downloadProgress?: number;
  downloadBytes?: { downloaded: number; total: number; bytesPerSecond?: number };
  /** Concurrent downloads behind this card (main+mmproj / grouped) → "N downloads". */
  downloadCount?: number;
  isActive?: boolean;
  isCompatible?: boolean;
  incompatibleReason?: string;
  /** A size in words ("Smaller", "Recommended", "Best") shown instead of the quantization name. */
  sizeLabel?: string;
  testID?: string;
  onPress?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  onSelect?: () => void;
  onRepairVision?: () => void;
  isRepairingVision?: boolean;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
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
  /** Facts the owning surface knows (RAM, remote capabilities, model style). */
  facts?: string[];
  capabilities?: ModelCardCapabilities;
  sourceBadge?: string;
  trailing?: React.ReactNode;
  disabled?: boolean;
  nameTestID?: string;
  factsTestID?: string;
  footer?: React.ReactNode;
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
  facts?: string[];
  capabilities?: ModelCardCapabilities;
  sourceBadge?: string;
  nameTestID?: string;
  factsTestID?: string;
}

const ModelCardHeading: React.FC<ModelCardHeadingProps> = ({
  dense, model, fileSize, quantization, isVisionModel, supportsAcceleration,
  recommended, isTrending, credibility, credibilityInfo, isActive, incompatibleReason,
  facts, capabilities, sourceBadge, nameTestID, factsTestID,
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
    facts={facts}
    capabilities={capabilities}
    sourceBadge={sourceBadge}
    nameTestID={nameTestID}
    factsTestID={factsTestID}
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
  actions?: React.ReactNode;
}> = ({ progress, bytes, queued, paused, count, actions }) => {
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
  const caption = [
    presented.bytesText,
    queued || paused ? undefined : presented.rateText,
    countLabel,
  ].filter(Boolean).join(' · ');
  return (
    <View style={styles.progressSection}>
      <View style={styles.progressTransferRow}>
        <View style={styles.progressDetails}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${queued ? 0 : percentage}%` }]} />
          </View>
          <View style={styles.progressCaptionRow}>
            <Text style={styles.progressBytesText}>{caption}</Text>
            {queued ? (
              <View style={styles.progressLabelRow}>
                <Icon name={QUEUED_ICON} size={12} color={colors.textMuted} accessibilityLabel="Queued" />
                <Text style={[styles.progressText, styles.queuedText]}>Queued</Text>
              </View>
            ) : paused ? (
              <View style={styles.progressLabelRow}>
                <Icon name={PAUSED_ICON} size={12} color={colors.textSecondary} accessibilityLabel="Paused" />
                <Text style={styles.progressText}>Paused</Text>
              </View>
            ) : (
              <Text style={styles.progressText}>{presented.percentageText ?? 'In progress'}</Text>
            )}
          </View>
        </View>
        {actions && <View style={styles.progressActions}>{actions}</View>}
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
      <View style={styles.failedDetails}>
        <View style={styles.progressBar}>
          <View style={[styles.failedProgressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.failedProgressCaption}>
          {presented.percentageText ?? 'Stopped'}
          {totalBytes > 0 ? ` · ${formatBytes(bytesDownloaded)} / ${formatBytes(totalBytes)}` : ''}
        </Text>
        <View style={styles.failedMessageRow}>
          <Icon name="alert-circle" size={13} color={colors.error} />
          <Text style={styles.failedMessageText}>{errorMessage}</Text>
        </View>
      </View>
      <View style={styles.failedActionsRow}>
        <TouchableOpacity style={styles.iconButton} onPress={onRetry} hitSlop={14} accessibilityRole="button" accessibilityLabel="Retry download">
          <Icon name="refresh-cw" size={13} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={onRemove} hitSlop={14} accessibilityRole="button" accessibilityLabel="Remove download">
          <Icon name="trash-2" size={13} color={colors.error} />
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
  sizeLabel,
  testID,
  onPress,
  onDownload,
  onDelete,
  onSelect,
  onRepairVision,
  isRepairingVision,
  onCancel,
  onPause,
  onResume,
  compact,
  isTrending,
  recommended,
  supportsAcceleration,
  failedState,
  facts,
  capabilities,
  sourceBadge,
  trailing,
  disabled,
  nameTestID,
  factsTestID,
  footer,
}) => {
  const styles = useThemedStyles(createStyles);
  const useDenseLayout = compact;

  const quantInfo = resolveQuantInfo(file, downloadedModel);
  const fileSize = resolveFileSize(file, downloadedModel);
  const isVisionModel = !!(model.modelType === 'vision' || file?.mmProjFile || (downloadedModel?.engine === 'llama' && downloadedModel.isVisionModel));
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
  const reportedQuantization = [file?.quantization, downloadedModel?.quantization, model.quantization]
    .find(value => value && value !== 'Unknown');
  const quantization = reportedQuantization ||
    /(?:^|[-_.])((?:Q\d+(?:_[A-Z0-9]+)*)|F16|F32|FP16|INT8)(?:[-_.]|$)/i.exec(`${model.id} ${model.name}`)?.[1]?.toUpperCase();
  const actionsInProgress = !!compact && (isDownloading || isQueued || isPaused);
  const actionButtons = !failedState && (
    <ModelCardActions
      modelName={model.name}
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
      onPause={onPause}
      onResume={onResume}
    />
  );

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
      disabled={disabled || !onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={model.name}
      accessibilityHint={speedHint(capabilities)}
      accessibilityState={{ selected: !!isActive, disabled: !!disabled }}
      testID={testID}
    >
      <View style={[styles.cardRow, useDenseLayout && styles.cardRowDense]}>
        <View style={styles.cardContent}>
          <ModelCardHeading
            dense={!!useDenseLayout}
            model={model}
            fileSize={fileSize}
            quantization={sizeLabel ? undefined : quantization}
            isVisionModel={isVisionModel}
            supportsAcceleration={supportsAcceleration}
            recommended={recommended}
            isTrending={isTrending}
            credibility={credibility}
            credibilityInfo={credibilityInfo}
            isActive={isActive}
            incompatibleReason={!isCompatible ? (incompatibleReason ?? 'Too large') : undefined}
            facts={sizeLabel ? [sizeLabel, ...(facts ?? [])] : facts}
            capabilities={capabilities}
            sourceBadge={sourceBadge}
            nameTestID={nameTestID}
            factsTestID={factsTestID}
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
            <DownloadProgressSection progress={downloadProgress} bytes={downloadBytes} queued={isQueued} paused={isPaused} count={downloadCount} actions={actionsInProgress && (onPause || onResume || onCancel) ? actionButtons : undefined} />
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

        {trailing ?? (!actionsInProgress && actionButtons)}
      </View>
      {footer}
    </TouchableOpacity>
  );
};

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}
