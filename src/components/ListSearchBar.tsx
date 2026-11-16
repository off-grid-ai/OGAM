import React from 'react';
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
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The search field above a list (Chats, Projects, Notes, Vault). It sits right under the screen
 * header and carries the header's surface, so the two read as one bar and the list scrolls under
 * its shadow instead of being cut at the field's edge. Rendered outside the list, so the field stays
 * mounted, and keeps the keyboard, while the list re-renders on each keystroke.
 */
export const ListSearchBar: React.FC<ListSearchBarProps> = ({ style, ...field }) => {
  const { colors, shadows } = useTheme();
  return (
    <View style={[barStyle, headerSurface(colors, shadows), style]}>
      <SearchField {...field} />
    </View>
  );
};

const barStyle: ViewStyle = {
  paddingHorizontal: SPACING.xl,
  paddingTop: SPACING.md,
  paddingBottom: SPACING.sm,
  zIndex: 1,
};
