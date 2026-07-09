import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { createModelRowStyles } from './styles';

export interface ModelRowProps {
  /** Model display name (title line). */
  name: string;
  /** Primary meta, e.g. the formatted size ("2.41 GB"). */
  size: string;
  /** Secondary meta, e.g. the quant or engine ("Q4_0", "LiteRT"). */
  quant?: string;
  /** Show the Vision badge. */
  isVision?: boolean;
  /** Optional RAM-fit hint under the meta row (home sheet shows this; chat omits it). */
  ramHint?: string;
  /** Highlight as the active/selected model. */
  isActive?: boolean;
  /** Show the trailing checkmark (currently loaded). */
  isLoaded?: boolean;
  /** Accent: text models use the primary (emerald) accent, image models the info accent. */
  variant?: 'text' | 'image';
  disabled?: boolean;
  onPress?: () => void;
  testID?: string;
}

/**
 * The one local-model row used by every model picker (chat + home). Purely
 * presentational — callers map their model shape to these props — so the two sheets
 * render an identical card and can't drift into differential designs.
 */
export const ModelRow: React.FC<ModelRowProps> = ({
  name, size, quant, isVision, ramHint, isActive, isLoaded, variant = 'text', disabled, onPress, testID,
}) => {
  const styles = useThemedStyles(createModelRowStyles);
  const { colors } = useTheme();
  const isImage = variant === 'image';
  return (
    <TouchableOpacity
      style={[styles.row, isActive && (isImage ? styles.rowSelectedImage : styles.rowSelectedText)]}
      onPress={onPress}
      disabled={disabled || !onPress}
      testID={testID}
    >
      <View style={styles.info}>
        <Text
          style={[styles.name, isActive && (isImage ? styles.nameSelectedImage : styles.nameSelectedText)]}
          numberOfLines={1}
        >
          {name}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.metaText}>{size}</Text>
          {!!quant && (
            <>
              <Text style={styles.separator}>•</Text>
              <Text style={styles.metaMuted}>{quant}</Text>
            </>
          )}
          {isVision && (
            <>
              <Text style={styles.separator}>•</Text>
              <View style={styles.visionBadge}>
                <Icon name="eye" size={10} color={colors.info} />
                <Text style={styles.visionBadgeText}>Vision</Text>
              </View>
            </>
          )}
        </View>
        {!!ramHint && <Text style={styles.ramHint}>{ramHint}</Text>}
      </View>
      {isLoaded && (
        <View style={[styles.checkmark, isImage ? styles.checkmarkImage : styles.checkmarkText]}>
          <Icon name="check" size={16} color={colors.background} />
        </View>
      )}
    </TouchableOpacity>
  );
};
