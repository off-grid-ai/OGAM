import React, { useState, type ReactNode } from 'react';
import { View, TextInput, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { TouchableOpacity } from './Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { cardLift } from '../theme/surface';

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** Spoken label of the clear button, e.g. "Clear chat search". */
  clearLabel?: string;
  onSubmitEditing?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Controls inside the field, after a hairline: the list's own sort, filter and import. */
  trailing?: ReactNode;
}

/**
 * The app's one search field (Chats, Projects, Models): the composer's look, a rounded field with a
 * hairline edge and a magnifier, the edge turning emerald while you type.
 */
// A 44 pt frame around the 16 pt clear glyph, pulled back so the field keeps its height.
const CLEAR_FRAME = { width: 44, height: 44, margin: -14, alignItems: 'center' as const, justifyContent: 'center' as const };

export const SearchField: React.FC<SearchFieldProps> = ({ value, onChangeText, placeholder, clearLabel = 'Clear search', onSubmitEditing, testID, style, trailing }) => {
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
        // A placeholder is not a name: it goes once you type. The field keeps it as its label.
        accessibilityLabel={placeholder}
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
        <TouchableOpacity onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel={clearLabel} style={CLEAR_FRAME}>
          <Icon name="x" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}
      {trailing ? (
        <>
          <View style={styles.divider} />
          <View style={styles.trailing}>{trailing}</View>
        </>
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
    minHeight: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface,
    // A sheet laid on the bar, as cards are on the page: the field is the thing you act on, so it
    // lifts instead of lying flat beside loose icons (Mac, 2026-11-19: "feels flat ... misplaced").
    boxShadow: cardLift(colors),
  },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' as const, marginVertical: SPACING.sm, backgroundColor: colors.borderLight },
  trailing: { flexDirection: 'row' as const, alignItems: 'center' as const, marginRight: -SPACING.sm },
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
