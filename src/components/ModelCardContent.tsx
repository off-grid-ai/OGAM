import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { useThemedStyles, useTheme } from '../theme';
import type { ThemeColors } from '../theme';
import { createStyles } from './ModelCard.styles';
import { huggingFaceService } from '../services/huggingface';
import { ModelCredibility } from '../types';
import { triggerHaptic } from '../utils/haptics';

interface CredibilityInfo {
  color: string;
  label: string;
}

// ── Compact header (name + author tag + optional downloads + description + type badges) ──

export interface RecommendedConfig {
  pillLabel?: string;
  /** An extra descriptive line for a curated/recommended model (e.g. "Up to 2x
   *  faster than CPU via GPU"). Rendered as part of the SAME common description
   *  line as every other card — not a separately coloured/positioned highlight. */
  highlightText?: string;
  // When provided, replaces the default modelType/paramCount/RAM chips in
  // compact mode. Lets curated entries surface custom badges (e.g. "Vision",
  // "GPU") instead of the auto-derived ones.
  chips?: string[];
}

/**
 * The ONE description string a card shows: the model's description plus any
 * recommended highlight line, deduped (a curated entry whose description IS its
 * highlight must not print twice) and joined. Rendered identically on every card
 * in the common muted description slot — no special-case colour or position.
 */
export function cardDescription(description?: string, highlightText?: string): string | undefined {
  const parts = [description, highlightText].filter((v): v is string => !!v);
  const unique = parts.filter((v, i) => parts.indexOf(v) === i);
  return unique.length ? unique.join(' ') : undefined;
}

interface CompactModelCardContentProps {
  model: {
    name: string;
    author: string;
    description?: string;
    downloads?: number;
    modelType?: 'text' | 'vision' | 'code';
    paramCount?: number;
    minRamGB?: number;
  };
  credibility?: ModelCredibility;
  credibilityInfo: CredibilityInfo | null;
  isTrending?: boolean;
  recommended?: RecommendedConfig;
  /** Model can run on the GPU/NPU (LiteRT or Q4_0/Q8_0 GGUF) → show the badge. */
  supportsAcceleration?: boolean;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

type ModelType = 'text' | 'vision' | 'code';

function modelTypeLabel(modelType: ModelType): string {
  if (modelType === 'vision') return 'Vision';
  if (modelType === 'code') return 'Code';
  return 'Text';
}

function modelTypeBadgeStyle(
  styles: ReturnType<typeof createStyles>,
  modelType: ModelType,
) {
  if (modelType === 'vision') return styles.visionBadge;
  if (modelType === 'code') return styles.codeBadge;
  return null;
}

function modelTypeTextStyle(
  styles: ReturnType<typeof createStyles>,
  modelType: ModelType,
) {
  if (modelType === 'vision') return styles.visionText;
  if (modelType === 'code') return styles.codeText;
  return null;
}

export const CompactModelCardContent: React.FC<CompactModelCardContentProps> = ({
  model,
  credibility,
  credibilityInfo,
  isTrending,
  recommended,
  supportsAcceleration,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <>
      <View style={styles.compactTopRow}>
        <View style={styles.compactNameGroup}>
          <Text style={[styles.name, styles.compactName, recommended && styles.compactNameRecommended]} numberOfLines={1}>
            {model.name}
          </Text>
          <View style={styles.authorTag}>
            <Text style={styles.authorTagText}>{model.author}</Text>
          </View>
          {credibilityInfo && (
            <View style={[styles.credibilityBadge, { backgroundColor: `${credibilityInfo.color}25` }]}>
              {credibility?.source === 'lmstudio' && (
                <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>★</Text>
              )}
              <Text style={[styles.credibilityText, { color: credibilityInfo.color }]}>
                {credibilityInfo.label}
              </Text>
            </View>
          )}
          {(isTrending || recommended) && <MaterialIcon name="whatshot" size={14} color={colors.trending} />}
          {recommended && (
            <View style={styles.recommendedPill}>
              <Text style={styles.recommendedPillText}>{recommended.pillLabel ?? 'Recommended'}</Text>
            </View>
          )}
        </View>
        {model.downloads !== undefined && model.downloads > 0 && (
          <View style={styles.authorTag}>
            <Text style={styles.authorTagText}>{formatNumber(model.downloads)} dl</Text>
          </View>
        )}
      </View>
      {/* One common description line for EVERY compact card: model description +
          any recommended highlight, same slot (under the name), same muted style. */}
      {cardDescription(model.description, recommended?.highlightText) && (
        <Text style={styles.descriptionCompact} numberOfLines={2}>
          {cardDescription(model.description, recommended?.highlightText)}
        </Text>
      )}
      {recommended?.chips && recommended.chips.length > 0 ? (
        <View style={[styles.infoRow, styles.infoRowCompact]}>
          {recommended.chips.map(chip => (
            <View key={chip} style={styles.recommendedChip}>
              <Text style={styles.recommendedChipText}>{chip}</Text>
            </View>
          ))}
        </View>
      ) : (model.modelType || model.paramCount || supportsAcceleration) && (
        <View style={[styles.infoRow, styles.infoRowCompact]}>
          {/* Capability badge: this model can run on the GPU/NPU (a LiteRT model or a
              Q4_0/Q8_0 GGUF). K-quants silently fall back to CPU, so they get no badge. */}
          {supportsAcceleration && (
            <View style={styles.accelBadge} testID="npu-gpu-badge">
              <Text style={styles.accelBadgeText}>NPU/GPU</Text>
            </View>
          )}
          {model.modelType && (
            <View style={[styles.infoBadge, modelTypeBadgeStyle(styles, model.modelType)]}>
              <Text style={[styles.infoText, modelTypeTextStyle(styles, model.modelType)]}>
                {modelTypeLabel(model.modelType)}
              </Text>
            </View>
          )}
          {model.paramCount && (
            <View style={styles.infoBadge}>
              <Text style={styles.infoText}>{model.paramCount}B params</Text>
            </View>
          )}
          {model.minRamGB && (
            <View style={styles.infoBadge}>
              <Text style={styles.infoText}>{model.minRamGB}GB+ RAM</Text>
            </View>
          )}
        </View>
      )}
    </>
  );
};

// ── Standard (non-compact) header ──

interface StandardModelCardContentProps {
  model: {
    name: string;
    author: string;
    description?: string;
  };
  credibility?: ModelCredibility;
  credibilityInfo: CredibilityInfo | null;
  isActive?: boolean;
  recommended?: RecommendedConfig;
  /** Model can run on the GPU/NPU (LiteRT or Q4_0/Q8_0 GGUF) → show the badge. */
  supportsAcceleration?: boolean;
}

export const StandardModelCardContent: React.FC<StandardModelCardContentProps> = ({
  model,
  credibility,
  credibilityInfo,
  isActive,
  recommended,
  supportsAcceleration,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <>
      <Text style={styles.name}>{model.name}</Text>
      <View style={styles.authorRow}>
        <View style={styles.authorTag}>
          <Text style={styles.authorTagText}>{model.author}</Text>
        </View>
        {credibilityInfo && (
          <View style={[styles.credibilityBadge, { backgroundColor: `${credibilityInfo.color}25` }]}>
            {credibility?.source === 'lmstudio' && (
              <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>★</Text>
            )}
            {credibility?.source === 'official' && (
              <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>✓</Text>
            )}
            {credibility?.source === 'verified-quantizer' && (
              <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>◆</Text>
            )}
            <Text style={[styles.credibilityText, { color: credibilityInfo.color }]}>
              {credibilityInfo.label}
            </Text>
          </View>
        )}
        {isActive && (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>Active</Text>
          </View>
        )}
        {recommended && (
          <>
            <MaterialIcon name="whatshot" size={14} color={colors.trending} />
            <View style={styles.recommendedPill}>
              <Text style={styles.recommendedPillText}>{recommended.pillLabel ?? 'Recommended'}</Text>
            </View>
          </>
        )}
        {/* GPU/NPU capability badge — a LiteRT or Q4_0/Q8_0 quant this device can accelerate. */}
        {supportsAcceleration && (
          <View style={styles.accelBadge} testID="npu-gpu-badge">
            <Text style={styles.accelBadgeText}>NPU/GPU</Text>
          </View>
        )}
      </View>
      {cardDescription(model.description, recommended?.highlightText) && (
        <Text style={styles.description} numberOfLines={2}>
          {cardDescription(model.description, recommended?.highlightText)}
        </Text>
      )}
    </>
  );
};

// ── Info badges row (size, quant, vision, compatibility) ──

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
          <Text style={styles.infoText}>{huggingFaceService.formatFileSize(fileSize)}</Text>
        </View>
      )}
      {sizeRange && (
        <View style={[styles.infoBadge, styles.sizeBadge]}>
          <Text style={styles.infoText}>
            {sizeRange.min === sizeRange.max
              ? huggingFaceService.formatFileSize(sizeRange.min)
              : `${huggingFaceService.formatFileSize(sizeRange.min)} - ${huggingFaceService.formatFileSize(sizeRange.max)}`}
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
      {/* Label chip renders for any non-empty quantization string — llama quants
          (Q4_K_M etc.) get the green "recommended" highlight via quantInfo, and
          non-table values (e.g. "LiteRT" for the curated LiteRT entries) still
          render as a plain label instead of disappearing. */}
      {!!quantization && (
        <View style={[styles.infoBadge, quantInfo?.recommended && styles.recommendedBadge]}>
          <Text style={[styles.infoText, quantInfo?.recommended && styles.recommendedText]}>
            {quantization}
          </Text>
        </View>
      )}
      {/* Quality chip stays gated on quantInfo so we don't render a phantom
          second chip for non-llama quant strings. */}
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
          <Text style={styles.warningText}>{isRepairingVision ? 'Repairing...' : 'Needs repair'}</Text>
        </View>
      )}
      {!isCompatible && (
        <View style={styles.warningBadge}>
          <Text style={styles.warningText}>{incompatibleReason ?? 'Too large'}</Text>
        </View>
      )}
    </View>
  );
};

// ── Action icon buttons (download / select / delete) ──

interface ModelCardActionsProps {
  isDownloaded: boolean | undefined;
  isDownloading: boolean | undefined;
  isActive: boolean | undefined;
  isCompatible: boolean;
  incompatibleReason: string | undefined;
  testID: string | undefined;
  onDownload: (() => void) | undefined;
  onSelect: (() => void) | undefined;
  onDelete: (() => void) | undefined;
  onRepairVision: (() => void) | undefined;
  isRepairingVision?: boolean;
  onCancel: (() => void) | undefined;
}

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

function ActionButton({ icon, color, haptic, onPress, disabled, testID, styles }: {
  icon: string; color: string; haptic: string; onPress: () => void;
  disabled?: boolean; testID?: string; styles: ReturnType<typeof createStyles>;
}) {
  return (
    <TouchableOpacity
      style={styles.iconButton}
      onPress={() => { triggerHaptic(haptic as any); onPress(); }}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      testID={testID}
    >
      <Icon name={icon} size={16} color={color} />
    </TouchableOpacity>
  );
}

function DownloadedActions({ isActive, testID, colors, styles, onSelect, onDelete, onRepairVision, isRepairingVision }: Readonly<{
  isActive?: boolean; testID?: string; colors: ThemeColors; styles: any;
  onSelect?: () => void; onDelete?: () => void; onRepairVision?: () => void; isRepairingVision?: boolean;
}>) {
  const tid = (s: string) => testID ? `${testID}-${s}` : undefined;
  if (!onSelect && !onDelete && !onRepairVision) return <Icon name="check-circle" size={16} color={colors.primary} />;
  return (
    <>
      {isRepairingVision ? (
        <View style={styles.iconButton} testID={tid('repairing-vision')}>
          <ActivityIndicator size="small" color={colors.warning} />
        </View>
      ) : (
        onRepairVision && <ActionButton icon="eye" color={colors.warning} haptic="impactLight" onPress={onRepairVision} testID={tid('repair-vision')} styles={styles} />
      )}
      {!isActive && onSelect && <ActionButton icon="check-circle" color={colors.primary} haptic="selection" onPress={onSelect} styles={styles} />}
      {onDelete && <ActionButton icon="trash-2" color={colors.error} haptic="notificationWarning" onPress={onDelete} styles={styles} />}
    </>
  );
}

export const ModelCardActions: React.FC<ModelCardActionsProps> = ({
  isDownloaded, isDownloading, isActive, isCompatible,
  testID, onDownload, onSelect, onDelete, onRepairVision, isRepairingVision, onCancel,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const tid = (suffix: string) => testID ? `${testID}-${suffix}` : undefined;

  if (isDownloading && onCancel) {
    return <ActionButton icon="x" color={colors.error} haptic="notificationWarning" onPress={onCancel} testID={tid('cancel')} styles={styles} />;
  }
  if (!isDownloaded && onDownload) {
    return <ActionButton icon="download" color={colors.primary} haptic="impactLight" onPress={onDownload} disabled={!isCompatible} testID={tid('download')} styles={styles} />;
  }
  if (isDownloaded) {
    return <DownloadedActions isActive={isActive} testID={testID} colors={colors} styles={styles} onSelect={onSelect} onDelete={onDelete} onRepairVision={onRepairVision} isRepairingVision={isRepairingVision} />;
  }
  return null;
};


