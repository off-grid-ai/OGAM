import React from 'react';
import { Text, View } from 'react-native';
import { huggingFaceService } from '../services/huggingface';
import { useThemedStyles } from '../theme';
import { createStyles } from './ModelCard.styles';

interface ModelInfoBadgesProps {
  fileSize: number;
  sizeRange: { min: number; max: number; count: number } | null;
  quantInfo: { quality: string; recommended: boolean } | null;
  quantization: string | undefined;
  isVisionModel: boolean;
  needsRepair: boolean;
  isRepairingVision?: boolean;
  isCompatible: boolean;
  incompatibleReason: string | undefined;
}

export const ModelInfoBadges: React.FC<ModelInfoBadgesProps> = ({
  fileSize,
  sizeRange,
  quantInfo,
  quantization,
  isVisionModel,
  needsRepair,
  isRepairingVision = false,
  isCompatible,
  incompatibleReason,
}) => {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.infoRow}>
      {fileSize > 0 && (
        <View style={styles.infoBadge}>
          <Text style={styles.infoText}>
            {huggingFaceService.formatFileSize(fileSize)}
          </Text>
        </View>
      )}
      {sizeRange && (
        <View style={[styles.infoBadge, styles.sizeBadge]}>
          <Text style={styles.infoText}>
            {sizeRange.min === sizeRange.max
              ? huggingFaceService.formatFileSize(sizeRange.min)
              : `${huggingFaceService.formatFileSize(
                  sizeRange.min,
                )} - ${huggingFaceService.formatFileSize(sizeRange.max)}`}
          </Text>
        </View>
      )}
      {sizeRange && (
        <View style={styles.infoBadge}>
          <Text style={styles.infoText}>
            {sizeRange.count} {sizeRange.count === 1 ? 'file' : 'files'}
          </Text>
        </View>
      )}
      {!!quantization && (
        <View
          style={[
            styles.infoBadge,
            quantInfo?.recommended && styles.recommendedBadge,
          ]}
        >
          <Text
            style={[
              styles.infoText,
              quantInfo?.recommended && styles.recommendedText,
            ]}
          >
            {quantization}
          </Text>
        </View>
      )}
      {quantInfo && (
        <View style={styles.infoBadge}>
          <Text style={styles.infoText}>{quantInfo.quality}</Text>
        </View>
      )}
      {isVisionModel && !needsRepair && (
        <View style={styles.visionBadge}>
          <Text style={styles.visionText}>Vision</Text>
        </View>
      )}
      {isVisionModel && needsRepair && (
        <View style={styles.warningBadge}>
          <Text style={styles.warningText}>
            {isRepairingVision ? 'Repairing...' : 'Needs repair'}
          </Text>
        </View>
      )}
      {!isCompatible && (
        <View style={styles.warningBadge}>
          <Text style={styles.warningText}>
            {incompatibleReason ?? 'Too large'}
          </Text>
        </View>
      )}
    </View>
  );
};
