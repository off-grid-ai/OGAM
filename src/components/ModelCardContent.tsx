import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { LoadingDots } from './LoadingDots';
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
  // Additional curated facts shown with the model facts in compact mode.
  chips?: string[];
}

interface DenseModelCardContentProps {
  model: {
    name: string;
    author: string;
    description?: string;
    downloads?: number;
    modelType?: 'text' | 'vision' | 'code';
    paramCount?: number;
    minRamGB?: number;
  };
  fileSize: number;
  quantization?: string;
  isVisionModel: boolean;
  supportsAcceleration?: boolean;
  recommended?: RecommendedConfig;
  isTrending?: boolean;
  credibilitySource?: ModelCredibility['source'];
  credibilityLabel?: string;
  incompatibleReason?: string;
  facts?: string[];
  capabilities?: { tools?: boolean; thinking?: boolean; vision?: boolean; predicted?: boolean };
  sourceBadge?: string;
  nameTestID?: string;
  factsTestID?: string;
}

/**
 * Dense rows use typography for hierarchy instead of a cluster of badges. The
 * name and outcome stay primary; technical facts share one scannable line.
 */
export const DenseModelCardContent: React.FC<DenseModelCardContentProps> = ({
  model,
  fileSize,
  quantization,
  isVisionModel,
  supportsAcceleration,
  recommended,
  isTrending,
  credibilitySource,
  credibilityLabel,
  incompatibleReason,
  facts: additionalFacts = [],
  capabilities,
  sourceBadge,
  nameTestID,
  factsTestID,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const description = cardDescription(model.description, recommended?.highlightText);
  const modelType = isVisionModel || model.modelType === 'vision' ? 'Vision'
    : model.modelType === 'code' ? 'Code' : model.modelType === 'text' ? 'Text' : undefined;
  const facts = [...new Set([
    fileSize > 0 ? huggingFaceService.formatFileSize(fileSize) : undefined,
    quantization && quantization !== 'Unknown' ? quantization : undefined,
    capabilities?.vision || isVisionModel ? undefined : modelType,
    model.paramCount ? `${model.paramCount}B params` : undefined,
    supportsAcceleration ? 'NPU/GPU' : undefined,
    ...(recommended?.chips ?? []),
    ...additionalFacts,
    model.downloads ? `${formatCompactNumber(model.downloads)} dl` : undefined,
    incompatibleReason,
  ].filter((value): value is string => !!value))];
  const hasVerifiedMark =
    credibilitySource === 'verified-quantizer' || credibilitySource === 'official';
  const sourceLabels = [
    model.author && model.author !== 'Unknown' ? model.author : undefined,
    credibilitySource && credibilitySource !== 'community' && !hasVerifiedMark ? credibilityLabel : undefined,
  ].filter((value): value is string => !!value);

  return (
    <>
      <View style={styles.denseTitleRow}>
        <Text style={styles.denseName} numberOfLines={1} testID={nameTestID}>{model.name}</Text>
        <View style={styles.denseSourceGroup}>
          {sourceBadge === 'Remote' ? <Icon name="cloud" size={14} color={colors.textMuted} accessibilityLabel="Remote model" />
            : sourceBadge ? <Text style={styles.denseSource}>{sourceBadge}</Text> : null}
          {hasVerifiedMark && (
            <MaterialIcon
              name="verified"
              size={12}
              color={colors.primary}
              accessibilityLabel={credibilitySource === 'official' ? 'Official' : 'Verified'}
            />
          )}
          {sourceLabels.length > 0 && <Text style={styles.denseSource} numberOfLines={1}>
            {sourceLabels.join(' · ')}
          </Text>}
          {(recommended || isTrending) && (
            <MaterialIcon name="whatshot" size={14} color={colors.trending} accessibilityLabel={isTrending ? 'Trending' : 'Recommended'} />
          )}
        </View>
      </View>
      {!!description && (
        <Text style={styles.denseDescription} numberOfLines={1}>{description}</Text>
      )}
      {facts.length > 0 && (
        <Text style={styles.denseMeta} numberOfLines={2} testID={factsTestID}>{facts.join(' · ')}</Text>
      )}
      {(capabilities?.vision || isVisionModel || capabilities?.tools || capabilities?.thinking) && (
        <View style={styles.capabilityRow}>
          {(capabilities?.vision || isVisionModel) && <View style={styles.capabilityBadge} accessibilityLabel="Vision">
            <Icon name="eye" size={13} color={colors.info} />
          </View>}
          {capabilities?.tools && <View style={styles.capabilityBadge} accessibilityLabel={capabilities.predicted ? 'Tool calling likely' : 'Tool calling'}>
            <Icon name="tool" size={13} color={colors.warning} />
          </View>}
          {capabilities?.thinking && <View style={styles.capabilityBadge} accessibilityLabel={capabilities.predicted ? 'Thinking likely' : 'Thinking'}>
            <Icon name="zap" size={13} color={colors.primary} />
          </View>}
        </View>
      )}
    </>
  );
};

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/**
 * The ONE description string a card shows: the model's description plus any
 * recommended highlight line, deduped (a curated entry whose description IS its
 * highlight must not print twice) and joined. Rendered identically on every card
 * in the common muted description slot — no special-case colour or position.
 */
function cardDescription(description?: string, highlightText?: string): string | undefined {
  const parts = [description, highlightText].filter((v): v is string => !!v);
  const unique = parts.filter((v, i) => parts.indexOf(v) === i);
  return unique.length ? unique.join(' ') : undefined;
}

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
  const description = cardDescription(model.description, recommended?.highlightText);

  return (
    <>
      <Text style={styles.name}>{model.name}</Text>
      <View style={styles.authorRow}>
        {model.author && model.author !== 'Unknown' && <View style={styles.authorTag}>
          <Text style={styles.authorTagText}>{model.author}</Text>
        </View>}
        {credibilityInfo && (credibility?.source === 'official' || credibility?.source === 'verified-quantizer') && (
          <MaterialIcon name="verified" size={14} color={colors.primary} accessibilityLabel={credibilityInfo.label} />
        )}
        {credibilityInfo && credibility?.source === 'lmstudio' && (
          <View style={[styles.credibilityBadge, { backgroundColor: `${credibilityInfo.color}25` }]}>
            {credibility?.source === 'lmstudio' && (
              <Text style={[styles.credibilityIcon, { color: credibilityInfo.color }]}>★</Text>
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
        {recommended && <MaterialIcon name="whatshot" size={14} color={colors.trending} accessibilityLabel="Recommended" />}
        {/* GPU/NPU capability badge — a LiteRT or Q4_0/Q8_0 quant this device can accelerate. */}
        {supportsAcceleration && (
          <View style={styles.accelBadge} testID="npu-gpu-badge">
            <Text style={styles.accelBadgeText}>NPU/GPU</Text>
          </View>
        )}
      </View>
      {!!description && (
        <Text style={styles.description} numberOfLines={2}>
          {description}
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
  isQueued?: boolean;
  isPaused?: boolean;
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
  onPause?: () => void;
  onResume?: () => void;
}

const HIT_SLOP = { top: 14, bottom: 14, left: 14, right: 14 };

function ActionButton({ icon, color, haptic, onPress, disabled, testID, accessibilityLabel, styles }: {
  icon: string; color: string; haptic: string; onPress: () => void;
  disabled?: boolean; testID?: string; accessibilityLabel?: string; styles: ReturnType<typeof createStyles>;
}) {
  return (
    <TouchableOpacity
      style={styles.iconButton}
      onPress={() => { triggerHaptic(haptic as any); onPress(); }}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
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
  if (!onSelect && !onDelete && !onRepairVision) return <Icon name="check-circle" size={16} color={colors.primary} testID={tid('downloaded')} />;
  return (
    <>
      {isRepairingVision ? (
        <View style={styles.iconButton} testID={tid('repairing-vision')}>
          <LoadingDots color={colors.warning} />
        </View>
      ) : (
        onRepairVision && <ActionButton icon="tool" color={colors.warning} haptic="impactLight" onPress={onRepairVision} testID={tid('repair-vision')} styles={styles} />
      )}
      {!isActive && onSelect && <ActionButton icon="check-circle" color={colors.primary} haptic="selection" onPress={onSelect} styles={styles} />}
      {onDelete && <ActionButton icon="trash-2" color={colors.error} haptic="notificationWarning" onPress={onDelete} testID={tid('delete') ?? 'delete-model-button'} accessibilityLabel="Delete model" styles={styles} />}
    </>
  );
}

export const ModelCardActions: React.FC<ModelCardActionsProps> = ({
  isDownloaded, isDownloading, isQueued, isPaused, isActive, isCompatible,
  testID, onDownload, onSelect, onDelete, onRepairVision, isRepairingVision, onCancel, onPause, onResume,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const tid = (suffix: string) => testID ? `${testID}-${suffix}` : undefined;

  if (isDownloading || isQueued || isPaused) {
    return <>
      {isPaused && onResume && <ActionButton icon="play" color={colors.primary} haptic="impactLight" onPress={onResume} testID={tid('resume')} accessibilityLabel="Resume download" styles={styles} />}
      {isDownloading && onPause && <ActionButton icon="pause" color={colors.primary} haptic="impactLight" onPress={onPause} testID={tid('pause')} accessibilityLabel="Pause download" styles={styles} />}
      {onCancel && <ActionButton icon="x" color={colors.error} haptic="notificationWarning" onPress={onCancel} testID={tid('cancel')} accessibilityLabel="Cancel download" styles={styles} />}
    </>;
  }
  if (!isDownloaded && onDownload) {
    return <ActionButton icon="download" color={colors.primary} haptic="impactLight" onPress={onDownload} disabled={!isCompatible} testID={tid('download')} styles={styles} />;
  }
  if (isDownloaded) {
    return <DownloadedActions isActive={isActive} testID={testID} colors={colors} styles={styles} onSelect={onSelect} onDelete={onDelete} onRepairVision={onRepairVision} isRepairingVision={isRepairingVision} />;
  }
  return null;
};
