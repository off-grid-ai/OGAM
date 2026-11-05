import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

/**
 * An icon is a font glyph, so a row that groups it for a screen reader read the private-use
 * character aloud (", Security", hand test 40). iOS builds a group's label from its children
 * and skips a child whose label is empty, so every icon defaults to an empty label. An icon that
 * means something on its own still passes its own accessibilityLabel, which wins.
 */
type IconClass = { defaultProps?: Record<string, unknown> };

for (const Icon of [Feather, MaterialCommunityIcons, MaterialIcons] as unknown as IconClass[]) {
  Icon.defaultProps = { ...Icon.defaultProps, accessibilityLabel: '' };
}
