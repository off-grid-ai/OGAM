import React from 'react';
import { FlatList, Image, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import type { MediaStyle, MediaStyleKind } from '@offgrid/models';
import { TouchableOpacity } from '../Touchable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../constants';
import { LIST_CLIPPING_PROPS } from '../../constants/listClipping';
import { stylePreview, stylesFor } from '../../services/mediaStyles';

const THUMB = 56;

/**
 * The styles a picture or a clip can take, as one row of previews. Nothing is chosen by default;
 * a tap chooses a style, a second tap or Clear goes back to the prompt as typed.
 */
export const StyleRow: React.FC<{
  kind: MediaStyleKind;
  selectedId: string | undefined;
  onChange: (styleId: string | null) => void;
  testID?: string;
}> = ({ kind, selectedId, onChange, testID = 'style-row' }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const selected = stylesFor(kind).find(style => style.id === selectedId);
  return (
    <View style={styles.row} testID={testID} accessibilityLabel="Style">
      <View style={styles.header}>
        <Text style={styles.label}>{selected ? `Style · ${selected.name}` : 'Style'}</Text>
        {selected ? (
          <TouchableOpacity
            testID={`${testID}-clear`}
            accessibilityRole="button"
            accessibilityLabel="Clear style"
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            onPress={() => onChange(null)}
          >
            <Icon name="x" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
      <FlatList
        {...LIST_CLIPPING_PROPS}
        horizontal
        data={stylesFor(kind) as MediaStyle[]}
        keyExtractor={style => style.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <StyleTile
            kind={kind}
            style={item}
            selected={item.id === selectedId}
            onPress={() => onChange(item.id === selectedId ? null : item.id)}
            testID={`${testID}-${item.id}`}
          />
        )}
      />
    </View>
  );
};

const StyleTile: React.FC<{
  kind: MediaStyleKind;
  style: MediaStyle;
  selected: boolean;
  onPress: () => void;
  testID: string;
}> = ({ kind, style, selected, onPress, testID }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const reducedMotion = useReducedMotion();
  // The chosen tile lifts slightly: a clear, quick state change rather than a bare border swap.
  const lift = useAnimatedStyle(() => ({
    transform: [{ scale: reducedMotion ? 1 : withTiming(selected ? 1.06 : 1, { duration: 150 }) }],
  }));
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={style.name}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.tile}
    >
      <Animated.View style={[styles.thumb, selected && styles.thumbSelected, lift]}>
        <Image source={stylePreview(kind, style.id)} style={styles.image} />
        {selected ? (
          <View style={styles.check}>
            <Icon name="check" size={11} color={colors.background} />
          </View>
        ) : null}
      </Animated.View>
      <Text numberOfLines={1} style={[styles.name, selected && styles.nameSelected]}>
        {style.name}
      </Text>
    </TouchableOpacity>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  row: { paddingTop: SPACING.sm, paddingBottom: SPACING.xs },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    minHeight: 20,
  },
  label: { ...TYPOGRAPHY.label, color: colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 1 },
  list: { paddingHorizontal: SPACING.md, gap: SPACING.sm },
  tile: { width: THUMB + 4, alignItems: 'center' as const, gap: SPACING.xs },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden' as const,
    ...shadows.small,
  },
  thumbSelected: { borderWidth: 2, borderColor: colors.primary },
  image: { width: '100%' as const, height: '100%' as const },
  check: {
    position: 'absolute' as const,
    top: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  name: { ...TYPOGRAPHY.meta, color: colors.textSecondary, maxWidth: THUMB + 4 },
  nameSelected: { color: colors.primary },
});
