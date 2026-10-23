import React from 'react';
import { View, TextInput, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
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
 * The search field above a list (Chats, Projects): it stays put, with a shadow along its bottom edge
 * that the list scrolls under. Rendered outside the list, so the field stays mounted, and keeps the
 * keyboard, while the list re-renders on each keystroke.
 */
export const ListSearchBar: React.FC<ListSearchBarProps> = ({ value, onChangeText, placeholder, clearLabel, testID, style }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.bar, style]}>
      <View style={styles.row}>
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
  bar: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
    backgroundColor: colors.background,
    zIndex: 1,
    ...shadows.edge,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  input: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    flex: 1,
    paddingVertical: SPACING.sm,
  },
});
