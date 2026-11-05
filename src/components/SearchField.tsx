import React, { useState } from 'react';
import { View, TextInput, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { TouchableOpacity } from './Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** Spoken label of the clear button, e.g. "Clear chat search". */
  clearLabel?: string;
  onSubmitEditing?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The app's one search field (Chats, Projects, Models): the composer's look, a rounded field with a
 * hairline edge and a magnifier, the edge turning emerald while you type.
 */
export const SearchField: React.FC<SearchFieldProps> = ({ value, onChangeText, placeholder, clearLabel = 'Clear search', onSubmitEditing, testID, style }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.row, focused && styles.rowFocused, style]}>
      {/* Decoration: the field's own label says it searches, so the glyph is hidden. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon name="search" size={16} color={colors.textMuted} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={onSubmitEditing}
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
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
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
