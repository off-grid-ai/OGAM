import React from 'react';
import { Image, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { MediaStyleKind } from '@offgrid/models';
import { TouchableOpacity } from '../Touchable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../constants';
import { stylePreview, stylesFor } from '../../services/mediaStyles';

const COLUMNS = 4;

/** Every style at once, as a grid of square previews: for a sheet, where a sideways strip would hide most of them. */
export const StyleGrid: React.FC<{
  kind: MediaStyleKind;
  selectedId: string | undefined;
  onPick: (styleId: string) => void;
  testID?: string;
}> = ({ kind, selectedId, onPick, testID = 'style-grid' }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const all = stylesFor(kind);
  // Pad the last row so every tile keeps the same width.
  const rows: (typeof all[number] | null)[][] = [];
  for (let i = 0; i < all.length; i += COLUMNS) {
    const row: (typeof all[number] | null)[] = all.slice(i, i + COLUMNS);
    while (row.length < COLUMNS) row.push(null);
    rows.push(row);
  }
  return (
    <View style={styles.grid} testID={testID}>
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((style, c) =>
            style ? (
              <TouchableOpacity
                key={style.id}
                testID={`${testID}-${style.id}`}
                accessibilityRole="button"
                accessibilityLabel={style.name}
                accessibilityState={{ selected: style.id === selectedId }}
                onPress={() => onPick(style.id)}
                style={styles.cell}
              >
                <View style={[styles.thumb, style.id === selectedId && styles.thumbSelected]}>
                  <Image source={stylePreview(kind, style.id)} style={styles.image} />
                  {style.id === selectedId ? (
                    <View style={styles.check}>
                      <Icon name="check" size={11} color={colors.background} />
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={[styles.name, style.id === selectedId && styles.nameSelected]}>
                  {style.name}
                </Text>
              </TouchableOpacity>
            ) : (
              <View key={`empty-${c}`} style={styles.cell} />
            ),
          )}
        </View>
      ))}
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  grid: { gap: SPACING.md },
  row: { flexDirection: 'row' as const, gap: SPACING.sm },
  cell: { flex: 1, gap: SPACING.xs, alignItems: 'center' as const },
  thumb: {
    width: '100%' as const,
    aspectRatio: 1,
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
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  name: { ...TYPOGRAPHY.meta, color: colors.textSecondary },
  nameSelected: { color: colors.primary },
});
