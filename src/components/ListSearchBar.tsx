import React, { useState } from 'react';
import { View, TextInput, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { TouchableOpacity } from './Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

interface ListSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** Spoken label of the clear button, e.g. "Clear chat search". */
  clearLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The search field above a list (Chats, Projects), in the composer's look: a rounded field with a
 * hairline edge floating on the living field, the edge turning emerald while you type. It stays put
 * above the list. Rendered outside the list, so the field stays mounted, and keeps the
 * keyboard, while the list re-renders on each keystroke.
 */
export const ListSearchBar: React.FC<ListSearchBarProps> = ({ value, onChangeText, placeholder, clearLabel, testID, style }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.bar, style]}>
      <View style={[styles.row, focused && styles.rowFocused]}>
        <Icon name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          testID={testID}
        />
        {value ? (
          <TouchableOpacity onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel={clearLabel} hitSlop={SPACING.sm}>
            <Icon name="x" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  // No slab across the screen: the field floats on the living field like the chat composer.
  bar: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    zIndex: 1,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface,
    ...shadows.small,
  },
  // Focus draws light to the field: an emerald edge and a soft ring (the composer's focus).
  rowFocused: {
    borderColor: colors.heroBorder,
    boxShadow: `0px 0px 0px 4px ${colors.selectedFill}, 0px 0px 24px ${colors.selectedFill}`,
  },
  input: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    flex: 1,
    paddingVertical: SPACING.sm,
  },
});
