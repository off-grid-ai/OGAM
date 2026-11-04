import React from 'react';
import { FlatList, Image, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { MediaStyle, MediaStyleKind } from '@offgrid/models';
import { TouchableOpacity } from '../Touchable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../constants';
import { LIST_CLIPPING_PROPS } from '../../constants/listClipping';
import { stylePreview, stylesFor } from '../../services/mediaStyles';

const THUMB = 60;

/**
 * The styles a picture or a clip can take, as one row of previews. Nothing is chosen by default;
 * a tap chooses a style, a second tap or Clear goes back to the prompt as typed.
 */
export const StyleRow: React.FC<{
  kind: MediaStyleKind;
  selectedId: string | undefined;
  onChange: (styleId: string | null) => void;
  testID?: string;
  /** Drawn as the top of the composer, with no card of its own. */
  attached?: boolean;
  /** Opens every style at once; the row only shows the first few. */
  onShowAll?: () => void;
  /** Only the line that names the chosen style, with Clear and All; the previews are put away. */
  collapsed?: boolean;
}> = ({ kind, selectedId, onChange, testID = 'style-row', attached = false, onShowAll, collapsed = false }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const selected = stylesFor(kind).find(style => style.id === selectedId);
  return (
    <View style={attached ? styles.attached : styles.row} testID={testID} accessibilityLabel="Style">
      <View style={[styles.header, attached && styles.headerAttached, collapsed && styles.headerCollapsed]}>
        <Text style={styles.label}>{selected ? `Style · ${selected.name}` : 'Style'}</Text>
        <View style={styles.actions}>
          {selected ? (
            <TouchableOpacity
              testID={`${testID}-clear`}
              accessibilityRole="button"
              accessibilityLabel="Clear style"
              hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}
              onPress={() => onChange(null)}
            >
              <Icon name="x" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
          {onShowAll ? (
            <TouchableOpacity
              testID={`${testID}-all`}
              accessibilityRole="button"
              accessibilityLabel="All styles"
              hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}
              onPress={onShowAll}
              style={styles.all}
            >
              <Text style={styles.allText}>All</Text>
              <Icon name="chevron-right" size={14} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      {collapsed ? null : (
      <FlatList
        {...LIST_CLIPPING_PROPS}
        horizontal
        data={stylesFor(kind) as MediaStyle[]}
        keyExtractor={style => style.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.list, attached && styles.listAttached]}
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
      )}
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
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={style.name}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.tile}
    >
      <View style={[styles.thumb, selected && styles.thumbSelected]}>
        <Image source={stylePreview(kind, style.id)} style={styles.image} />
        {selected ? (
          <View style={styles.check}>
            <Icon name="check" size={11} color={colors.background} />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.name, selected && styles.nameSelected]}>
        {style.name}
      </Text>
    </TouchableOpacity>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  // The app's elevated card (as the chat list's rows), flush with the composer's edges.
  row: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.md,
    paddingTop: SPACING.sm + 2,
    paddingBottom: SPACING.sm,
    marginBottom: SPACING.sm,
    overflow: 'hidden' as const,
    ...shadows.small,
  },
  // On the composer the row lines up with the input below: 16 in from the left, the send button's 12 from the right.
  attached: { paddingTop: SPACING.md, paddingBottom: SPACING.xs },
  headerAttached: { paddingLeft: SPACING.lg, paddingRight: SPACING.md },
  listAttached: { paddingHorizontal: SPACING.lg },
  headerCollapsed: { paddingBottom: 0 },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    minHeight: 20,
  },
  actions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.lg },
  all: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2 },
  allText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
  label: { ...TYPOGRAPHY.label, color: colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 1 },
  list: { paddingHorizontal: SPACING.md, gap: SPACING.sm },
  tile: { width: THUMB, alignItems: 'center' as const, gap: SPACING.xs },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden' as const,
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
  name: { ...TYPOGRAPHY.meta, color: colors.textSecondary, maxWidth: THUMB, textAlign: 'center' as const },
  nameSelected: { color: colors.primary },
});
