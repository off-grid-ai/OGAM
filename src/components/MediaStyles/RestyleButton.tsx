import React from 'react';
import { Text, View } from 'react-native';
import type { MediaStyleKind } from '@offgrid/models';
import { TouchableOpacity } from '../Touchable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../constants';
import { restyleRequestFor, useRestyleStore } from '../../stores/restyleStore';

/** Under a finished picture: the same prompt again, in another style. The same pill as the clip's Extend. */
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
        hitSlop={{ top: 4, bottom: 4 }}
        style={styles.button}
        onPress={() => {
          const request = restyleRequestFor(conversationId, messageId, kind);
          if (request) useRestyleStore.getState().open(request);
        }}
      >
        <Text style={[styles.label, { color: colors.text }]}>Restyle</Text>
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
  label: { ...TYPOGRAPHY.bodySmall },
});
