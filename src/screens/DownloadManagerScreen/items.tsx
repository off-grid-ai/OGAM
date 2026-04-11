import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Card } from '../../components';
import { useTheme, useThemedStyles } from '../../theme';
import { hardwareService } from '../../services';
import { DownloadedModel, BackgroundDownloadInfo, ONNXImageModel } from '../../types';
import { needsVisionRepair as checkNeedsVisionRepair } from '../../utils/visionRepair';
import { createStyles } from './styles';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DownloadItem = {
  type: 'active' | 'completed';
  modelType: 'text' | 'image' | 'tts' | 'stt';
  downloadId?: number;
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
  reason?: string;
};

export interface DownloadItemsData {
  downloadProgress: Record<string, { progress: number; bytesDownloaded: number; totalBytes: number; reason?: string }>;
  activeDownloads: BackgroundDownloadInfo[];
  activeBackgroundDownloads: Record<number, { modelId: string; fileName: string; author: string; quantization: string; totalBytes: number } | null>;
  downloadedModels: DownloadedModel[];
  downloadedImageModels: ONNXImageModel[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0)} ${sizes[i]}`;
}

export function extractQuantization(fileName: string): string {
  if (fileName.toLowerCase().includes('coreml')) return 'Core ML';
  const upperName = fileName.toUpperCase();
  const patterns = ['Q2_K', 'Q3_K_S', 'Q3_K_M', 'Q4_0', 'Q4_K_S', 'Q4_K_M', 'Q5_K_S', 'Q5_K_M', 'Q6_K', 'Q8_0'];
  for (const pattern of patterns) {
    if (upperName.includes(pattern.replace('_', ''))) return pattern;
    if (upperName.includes(pattern)) return pattern;
  }
  const match = /[QqFf]\d+_?[KkMmSs]*/.exec(fileName);
  return match ? match[0].toUpperCase() : 'Unknown';
}

export function getStatusText(status: string): string {
  if (status === 'running') return 'Downloading...';
  if (status === 'pending') return 'Queued';
  if (status === 'paused') return 'Paused';
  if (status === 'unknown') return 'Stuck - Remove & retry';
  return status;
}

export function buildDownloadItems(data: DownloadItemsData): DownloadItem[] {
  const items: DownloadItem[] = [];

  Object.entries(data.downloadProgress).forEach(([key, progress]) => {
    const [_modelId, fileName] = key.split('/').slice(-2);
    const fullModelId = key.substring(0, key.lastIndexOf('/'));
    if (!fileName || !fullModelId || fileName === 'undefined' || fullModelId === 'undefined' ||
        Number.isNaN(progress.totalBytes) || Number.isNaN(progress.bytesDownloaded)) {
      return;
    }
    // Skip image download entries whose model is already in Downloaded Models
    if (fullModelId.startsWith('image:')) {
      const imageId = fullModelId.replace('image:', '');
      if (data.downloadedImageModels.some(m => m.id === imageId)) return;
    }
    items.push({
      type: 'active',
      modelType: fullModelId.startsWith('image:') ? 'image' : 'text',
      modelId: fullModelId,
      fileName,
      author: fullModelId.split('/')[0] ?? 'Unknown',
      quantization: extractQuantization(fileName),
      fileSize: progress.totalBytes,
      bytesDownloaded: progress.bytesDownloaded,
      progress: progress.progress,
      status: 'downloading',
      reason: progress.reason,
    });
  });

  // Background downloads not already covered by downloadProgress
  data.activeDownloads.forEach(download => {
    const metadata = data.activeBackgroundDownloads[download.downloadId];
    if (!metadata) return;
    const key = `${metadata.modelId}/${metadata.fileName}`;
    if (data.downloadProgress[key]) return;
    if (!metadata.fileName || !metadata.modelId ||
        metadata.fileName === 'undefined' || metadata.modelId === 'undefined' ||
        Number.isNaN(metadata.totalBytes) || Number.isNaN(download.bytesDownloaded)) {
      return;
    }
    items.push({
      type: 'active',
      modelType: metadata.modelId.startsWith('image:') ? 'image' : 'text',
      downloadId: download.downloadId,
      modelId: metadata.modelId,
      fileName: download.title ?? metadata.fileName,
      author: metadata.author,
      quantization: metadata.quantization,
      fileSize: metadata.totalBytes,
      bytesDownloaded: download.bytesDownloaded,
      progress: metadata.totalBytes > 0 ? download.bytesDownloaded / metadata.totalBytes : 0,
      status: download.status,
    });
  });

  // Completed text models
  data.downloadedModels.forEach(model => {
    const totalSize = hardwareService.getModelTotalSize(model);
    items.push({
      type: 'completed',
      modelType: 'text',
      modelId: model.id,
      fileName: model.fileName,
      author: model.author,
      quantization: model.quantization,
      fileSize: totalSize,
      bytesDownloaded: totalSize,
      progress: 1,
      status: 'completed',
      downloadedAt: model.downloadedAt,
      filePath: model.filePath,
      isVisionModel: model.isVisionModel,
      mmProjPath: model.mmProjPath,
    });
  });

  // Completed image models
  data.downloadedImageModels.forEach(model => {
    items.push({
      type: 'completed',
      modelType: 'image',
      modelId: model.id,
      fileName: model.name,
      author: 'Image Generation',
      quantization: '',
      fileSize: model.size,
      bytesDownloaded: model.size,
      progress: 1,
      status: 'completed',
      filePath: model.modelPath,
    });
  });

  return items;
}

// ─── Item components ──────────────────────────────────────────────────────────

interface ActiveDownloadCardProps {
  item: DownloadItem;
  onRemove: (item: DownloadItem) => void;
}

export const ActiveDownloadCard: React.FC<ActiveDownloadCardProps> = ({ item, onRemove }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Card style={styles.downloadCard}>
      <View style={styles.downloadHeader}>
        <View style={styles.downloadInfo}>
          <Text style={styles.fileName} numberOfLines={1}>{item.fileName}</Text>
          <Text style={styles.modelId} numberOfLines={1}>{item.author}</Text>
        </View>
        <TouchableOpacity style={styles.cancelButton} onPress={() => onRemove(item)}>
          <Icon name="x" size={20} color={colors.error} />
        </TouchableOpacity>
      </View>
      <View style={styles.progressContainer}>
        <View style={styles.progressBarBackground}>
          <View style={[styles.progressBarFill, { width: `${Math.round(item.progress * 100)}%` as const }]} />
        </View>
        <Text style={styles.progressText}>
          {formatBytes(item.bytesDownloaded)} / {formatBytes(item.fileSize)}
        </Text>
      </View>
      <View style={styles.downloadMeta}>
        <View style={styles.quantBadge}>
          <Text style={styles.quantText}>{item.quantization}</Text>
        </View>
        <Text style={styles.statusText}>
          {getStatusText(item.status)}{item.reason ? ` · ${item.reason}` : ''}
        </Text>
      </View>
    </Card>
  );
};

interface CompletedDownloadCardProps {
  item: DownloadItem;
  onDelete: (item: DownloadItem) => void;
  onRepairVision?: (item: DownloadItem) => void;
}

export const CompletedDownloadCard: React.FC<CompletedDownloadCardProps> = ({ item, onDelete, onRepairVision }) => {
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
        {needsVisionRepair && onRepairVision && (
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
      </View>
    </Card>
  );
};
