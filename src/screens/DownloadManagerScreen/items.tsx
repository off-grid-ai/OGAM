import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Card } from '../../components';
import { useTheme, useThemedStyles } from '../../theme';
import { BackgroundDownloadReasonCode } from '../../types';
import { needsVisionRepair as checkNeedsVisionRepair } from '../../utils/visionRepair';
import { getDownloadStatusLabel, isRetryable } from '../../utils/downloadErrors';
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

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0)} ${sizes[i]}`;
}

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
}

export const ActiveDownloadCard: React.FC<ActiveDownloadCardProps> = ({ item, onRemove, onRetry }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const progressColor =
    item.status === 'failed'
      ? colors.error
      : item.status === 'retrying' || item.status === 'waiting_for_network'
        ? colors.warning
        : colors.primary;

  const getStatusIcon = () => {
    if (item.status === 'failed') return 'alert-circle';
    if (item.status === 'retrying') return 'refresh-cw';
    if (item.status === 'waiting_for_network') return 'wifi-off';
    return null;
  };

  const getStatusIconColor = () => {
    if (item.status === 'failed') return colors.error;
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
          <View style={[styles.progressBarFill, { width: `${Math.round(item.progress * 100)}%` as const, backgroundColor: progressColor }]} />
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
        {!!getStatusLabel(item) && (
          <View style={styles.statusIconRow}>
            {getStatusIcon() && (
              <Icon name={getStatusIcon()!} size={14} color={getStatusIconColor()} />
            )}
            <Text style={[styles.statusText, item.status === 'failed' && { color: colors.error }]}>
              {getStatusLabel(item)}
            </Text>
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

export const CompletedDownloadCard: React.FC<CompletedDownloadCardProps> = ({ item, onDelete, onRepairVision, isRepairingVision = false }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const needsVisionRepair = checkNeedsVisionRepair(item);

  return (
    <Card style={styles.downloadCard}>
      <View style={styles.downloadHeader}>
        <View style={styles.modelTypeIcon}>
          <Icon
            name={item.modelType === 'image' ? 'image' : item.modelType === 'tts' ? 'volume-2' : item.modelType === 'stt' ? 'mic' : item.isVisionModel ? 'eye' : 'message-square'}
            size={16}
            color={item.modelType === 'image' ? colors.info : item.modelType === 'tts' || item.modelType === 'stt' ? colors.success : item.isVisionModel ? colors.warning : colors.primary}
          />
        </View>
        <View style={styles.downloadInfo}>
          <Text style={styles.fileName} numberOfLines={1}>{item.fileName}</Text>
          <Text style={styles.modelId} numberOfLines={1}>{item.author}</Text>
        </View>
        {needsVisionRepair && !isRepairingVision && onRepairVision && (
          <TouchableOpacity
            style={styles.repairButton}
            testID="repair-vision-button"
            onPress={() => onRepairVision(item)}
          >
            <Icon name="eye" size={18} color={colors.warning} />
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
      <View style={styles.downloadMeta}>
        {!!item.quantization && (
          <View style={[styles.quantBadge, item.modelType === 'image' && styles.imageBadge]}>
            <Text style={[styles.quantText, item.modelType === 'image' && styles.imageQuantText]}>
              {item.quantization}
            </Text>
          </View>
        )}
        <Text style={styles.sizeText}>{formatBytes(item.fileSize)}</Text>
        {item.downloadedAt && (
          <Text style={styles.dateText}>{new Date(item.downloadedAt).toLocaleDateString()}</Text>
        )}
        {isRepairingVision && (
          <View style={styles.repairingBadge} testID="repairing-vision-badge">
            <ActivityIndicator size="small" color={colors.warning} />
            <Text style={styles.repairingBadgeText}>Repairing</Text>
          </View>
        )}
      </View>
    </Card>
  );
};
