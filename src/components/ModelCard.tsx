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
  CompactModelCardContent,
  StandardModelCardContent,
  ModelInfoBadges,
  ModelCardActions,
  RecommendedConfig,
} from './ModelCardContent';

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
  downloadProgress?: number;
  downloadBytes?: { downloaded: number; total: number };
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

const DownloadProgressSection: React.FC<{
  progress: number;
  bytes?: { downloaded: number; total: number };
  tight?: boolean;
}> = ({ progress, bytes, tight }) => {
  const styles = useThemedStyles(createStyles);
  return (
  <View style={styles.progressSection}>
    <View style={[styles.progressContainer, tight && styles.progressContainerTight]}>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={[styles.progressText, tight && styles.progressTextTight]}>{Math.round(progress * 100)}%</Text>
    </View>
    {bytes && bytes.total > 0 && (
      <Text style={styles.progressBytesText}>
        {formatBytes(bytes.downloaded)} / {formatBytes(bytes.total)}
      </Text>
    )}
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
  const progress = totalBytes > 0 ? bytesDownloaded / totalBytes : 0;
  return (
    <View style={styles.failedSection}>
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.failedProgressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
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
  downloadProgress = 0,
  downloadBytes,
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
  failedState,
}) => {
  const styles = useThemedStyles(createStyles);

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
        compact && styles.cardCompact,
        recommended && compact && styles.cardRecommended,
        isActive && styles.cardActive,
        !isCompatible && styles.cardIncompatible,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
      testID={testID}
    >
<View style={styles.cardRow}>
        <View style={styles.cardContent}>
          {compact ? (
            <CompactModelCardContent
              model={model}
              credibility={credibility}
              credibilityInfo={credibilityInfo}
              isTrending={isTrending}
              recommended={recommended}
            />
          ) : (
            <StandardModelCardContent
              model={model}
              credibility={credibility}
              credibilityInfo={credibilityInfo}
              isActive={isActive}
              recommended={recommended}
            />
          )}

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

          {!compact && model.downloads !== undefined && model.downloads > 0 && (
            <View style={styles.statsRow}>
              <Text style={styles.statsText}>
                {formatNumber(model.downloads)} downloads
              </Text>
              {model.likes !== undefined && model.likes > 0 && (
                <Text style={styles.statsText}>{formatNumber(model.likes)} likes</Text>
              )}
            </View>
          )}

          {isDownloading && (
            <DownloadProgressSection progress={downloadProgress} bytes={downloadBytes} tight={!!recommended} />
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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
