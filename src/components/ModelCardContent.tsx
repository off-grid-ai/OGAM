import React from 'react';
import { View, Text } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { useThemedStyles, useTheme } from '../theme';
import { createStyles } from './ModelCard.styles';
import { ModelCredibility } from '../types';
import { fitTierLabel, type FitTier } from '../services/memoryBudget';
import type { ThemeColors as TC } from '../theme';
export { ModelCardActions } from './ModelCardActions';
export { ModelInfoBadges } from './ModelInfoBadges';

/** Chip accent per fit tier: emerald for a comfortable easy/fits, muted for a tight (snug, still
 *  loadable) fit. Browse never shows 'wontFit' (those models are filtered out), so it isn't styled. */
const fitTierColor = (colors: TC, tier: FitTier): string =>
  tier === 'tight' ? colors.textMuted : colors.primary;

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
function cardDescription(
  description?: string,
  highlightText?: string,
): string | undefined {
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
    fitTier?: FitTier;
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

/** The compact card's badge row (fit chip + NPU/GPU + type + params + RAM). Extracted to module
 *  scope so CompactModelCardContent stays under the complexity gate; renders null when empty. */
const InfoBadgesRow: React.FC<{
  model: {
    modelType?: 'text' | 'vision' | 'code';
    paramCount?: number;
    minRamGB?: number;
    fitTier?: FitTier;
  };
  supportsAcceleration?: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: TC;
}> = ({ model, supportsAcceleration, styles, colors }) => {
  if (
    !model.modelType &&
    !model.paramCount &&
    !supportsAcceleration &&
    !model.fitTier
  )
    return null;
  return (
    <View style={[styles.infoRow, styles.infoRowCompact]}>
      {/* Device-fit chip: how snugly the best quant fits THIS phone (Easy/Fits/Tight). Browse shows
          loadable models with this instead of hiding over-budget ones. */}
      {model.fitTier && (
        <View
          style={[
            styles.infoBadge,
            { borderColor: fitTierColor(colors, model.fitTier) },
          ]}
          testID={`fit-chip-${model.fitTier}`}
        >
          <Text
            style={[
              styles.infoText,
              { color: fitTierColor(colors, model.fitTier) },
            ]}
          >
            {fitTierLabel(model.fitTier)}
          </Text>
        </View>
      )}
      {supportsAcceleration && (
        <View style={styles.accelBadge} testID="npu-gpu-badge">
          <Text style={styles.accelBadgeText}>NPU/GPU</Text>
        </View>
      )}
      {model.modelType && (
        <View
          style={[
            styles.infoBadge,
            modelTypeBadgeStyle(styles, model.modelType),
          ]}
        >
          <Text
            style={[
              styles.infoText,
              modelTypeTextStyle(styles, model.modelType),
            ]}
          >
            {modelTypeLabel(model.modelType)}
          </Text>
        </View>
      )}
      {/* `!!` coerces a falsy 0/undefined to false — `{0 && …}` would render a bare "0" text node
          outside <Text> and crash RN (CodeRabbit). A 0-param / 0-RAM badge is meaningless anyway. */}
      {!!model.paramCount && (
        <View style={styles.infoBadge}>
          <Text style={styles.infoText}>{model.paramCount}B params</Text>
        </View>
      )}
      {!!model.minRamGB && (
        <View style={styles.infoBadge}>
          <Text style={styles.infoText}>{model.minRamGB}GB+ RAM</Text>
        </View>
      )}
    </View>
  );
};

export const CompactModelCardContent: React.FC<
  CompactModelCardContentProps
> = ({
  model,
  credibility,
  credibilityInfo,
  isTrending,
  recommended,
  supportsAcceleration,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const description = cardDescription(
    model.description,
    recommended?.highlightText,
  );

  return (
    <>
      <View style={styles.compactTopRow}>
        <View style={styles.compactNameGroup}>
          <Text
            style={[
              styles.name,
              styles.compactName,
              recommended && styles.compactNameRecommended,
            ]}
            numberOfLines={1}
          >
            {model.name}
          </Text>
          <View style={styles.authorTag}>
            <Text style={styles.authorTagText}>{model.author}</Text>
          </View>
          {credibilityInfo && (
            <View
              style={[
                styles.credibilityBadge,
                { backgroundColor: `${credibilityInfo.color}25` },
              ]}
            >
              {credibility?.source === 'lmstudio' && (
                <Text
                  style={[
                    styles.credibilityIcon,
                    { color: credibilityInfo.color },
                  ]}
                >
                  ★
                </Text>
              )}
              <Text
                style={[
                  styles.credibilityText,
                  { color: credibilityInfo.color },
                ]}
              >
                {credibilityInfo.label}
              </Text>
            </View>
          )}
          {(isTrending || recommended) && (
            <MaterialIcon name="whatshot" size={14} color={colors.trending} />
          )}
          {recommended && (
            <View style={styles.recommendedPill}>
              <Text style={styles.recommendedPillText}>
                {recommended.pillLabel ?? 'Recommended'}
              </Text>
            </View>
          )}
        </View>
        {model.downloads !== undefined && model.downloads > 0 && (
          <View style={styles.authorTag}>
            <Text style={styles.authorTagText}>
              {formatNumber(model.downloads)} dl
            </Text>
          </View>
        )}
      </View>
      {/* One common description line for EVERY compact card: model description +
          any recommended highlight, same slot (under the name), same muted style. */}
      {!!description && (
        <Text style={styles.descriptionCompact} numberOfLines={2}>
          {description}
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
      ) : (
        <InfoBadgesRow
          model={model}
          supportsAcceleration={supportsAcceleration}
          styles={styles}
          colors={colors}
        />
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

export const StandardModelCardContent: React.FC<
  StandardModelCardContentProps
> = ({
  model,
  credibility,
  credibilityInfo,
  isActive,
  recommended,
  supportsAcceleration,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const description = cardDescription(
    model.description,
    recommended?.highlightText,
  );

  return (
    <>
      <Text style={styles.name}>{model.name}</Text>
      <View style={styles.authorRow}>
        <View style={styles.authorTag}>
          <Text style={styles.authorTagText}>{model.author}</Text>
        </View>
        {credibilityInfo && (
          <View
            style={[
              styles.credibilityBadge,
              { backgroundColor: `${credibilityInfo.color}25` },
            ]}
          >
            {credibility?.source === 'lmstudio' && (
              <Text
                style={[
                  styles.credibilityIcon,
                  { color: credibilityInfo.color },
                ]}
              >
                ★
              </Text>
            )}
            {credibility?.source === 'official' && (
              <Text
                style={[
                  styles.credibilityIcon,
                  { color: credibilityInfo.color },
                ]}
              >
                ✓
              </Text>
            )}
            {credibility?.source === 'verified-quantizer' && (
              <Text
                style={[
                  styles.credibilityIcon,
                  { color: credibilityInfo.color },
                ]}
              >
                ◆
              </Text>
            )}
            <Text
              style={[styles.credibilityText, { color: credibilityInfo.color }]}
            >
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
              <Text style={styles.recommendedPillText}>
                {recommended.pillLabel ?? 'Recommended'}
              </Text>
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
      {!!description && (
        <Text style={styles.description} numberOfLines={2}>
          {description}
        </Text>
      )}
    </>
  );
};
