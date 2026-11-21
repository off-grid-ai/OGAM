import React, { type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SPACING } from '../constants';
import { useTheme } from '../theme';
import { headerSurface } from './ScreenHeader';
import { SearchField } from './SearchField';

interface ListSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** Spoken label of the clear button, e.g. "Clear chat search". */
  clearLabel: string;
  onSubmitEditing?: () => void;
  testID?: string;
  /** testID of the bar itself (the field takes `testID`). */
  barTestID?: string;
  style?: StyleProp<ViewStyle>;
  /** Controls after the field on the same row, e.g. the Models tabs' sort and filter toggles. */
  children?: ReactNode;
  /** A line inside the bar, under the field, that stays put with it, e.g. a count and a bulk action. */
  below?: ReactNode;
}

/**
 * The search field above a list (Chats, Projects, Notes, Vault). It sits right under the screen
 * header and carries the header's surface, so the two read as one bar and the list scrolls under
 * its shadow instead of being cut at the field's edge. Rendered outside the list, so the field stays
 * mounted, and keeps the keyboard, while the list re-renders on each keystroke.
 */
export const ListSearchBar: React.FC<ListSearchBarProps> = ({ style, children, below, barTestID, ...field }) => {
  const { colors, shadows } = useTheme();
  const fieldRow = children ? (
    <View style={rowStyle}>
      <SearchField {...field} style={fieldInRow} />
      {children}
    </View>
  ) : (
    <SearchField {...field} />
  );
  return (
    <View style={[barStyle, headerSurface(colors, shadows), style]} testID={barTestID}>
      {fieldRow}
      {below}
    </View>
  );
};

const barStyle: ViewStyle = {
  paddingHorizontal: SPACING.xl,
  paddingTop: SPACING.md,
  paddingBottom: SPACING.sm,
  zIndex: 1,
};

const rowStyle: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm };
const fieldInRow: ViewStyle = { flex: 1 };
