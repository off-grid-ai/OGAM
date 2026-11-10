import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SPACING } from '../constants';
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
 * The search field above a list (Chats, Projects): the app's SearchField floating on the living field,
 * no slab behind it. Rendered outside the list, so the field stays mounted, and keeps the keyboard,
 * while the list re-renders on each keystroke.
 */
export const ListSearchBar: React.FC<ListSearchBarProps> = ({ style, ...field }) => (
  <View style={[barStyle, style]}>
    <SearchField {...field} />
  </View>
);

const barStyle: ViewStyle = {
  paddingHorizontal: SPACING.xl,
  paddingTop: SPACING.md,
  paddingBottom: SPACING.sm,
  zIndex: 1,
};
