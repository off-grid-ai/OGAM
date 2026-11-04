import React from 'react';
import { View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { MediaStyleKind } from '@offgrid/models';
import { TouchableOpacity } from '../Touchable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { RADIUS, SPACING } from '../../constants';
import { restyleRequestFor, useRestyleStore } from '../../stores/restyleStore';

/** Under a finished picture: the same prompt again, in another style. Same size and edge as the clip's chips. */
export const RestyleButton: React.FC<{
  kind: MediaStyleKind;
  conversationId: string;
  messageId: string;
}> = ({ kind, conversationId, messageId }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.row}>
      <TouchableOpacity
        testID={`${kind}-restyle`}
        accessibilityRole="button"
        accessibilityLabel="Restyle"
        style={styles.button}
        onPress={() => {
          const request = restyleRequestFor(conversationId, messageId, kind);
          if (request) useRestyleStore.getState().open(request);
        }}
      >
        <Icon name="droplet" size={16} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  row: { flexDirection: 'row' as const, paddingTop: SPACING.sm, paddingBottom: SPACING.xs },
  button: {
    height: 36,
    minWidth: 44,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
