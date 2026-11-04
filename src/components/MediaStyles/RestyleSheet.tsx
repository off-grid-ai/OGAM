import React from 'react';
import { Text } from 'react-native';
import { AppSheet } from '../AppSheet';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useRestyleStore } from '../../stores/restyleStore';
import { useMediaStyleStore } from '../../stores/mediaStyleStore';
import { StyleRow } from './StyleRow';

/**
 * Restyle: the same prompt again, in the style picked here. The pick becomes the chat's style and
 * the new turn is sent at once, so the loop is one tap after the result.
 */
export const RestyleSheet: React.FC<{
  onSend: (prompt: string, kind: 'image' | 'video') => void;
}> = ({ onSend }) => {
  const styles = useThemedStyles(createStyles);
  const request = useRestyleStore(state => state.request);
  const close = useRestyleStore(state => state.close);
  const setStyle = useMediaStyleStore(state => state.setStyle);
  return (
    <AppSheet visible={!!request} onClose={close} title="Restyle" sheet="chat:restyle" enableDynamicSizing>
      {request ? (
        <>
          <Text style={styles.prompt} numberOfLines={2}>
            {request.prompt}
          </Text>
          <StyleRow
            kind={request.kind}
            selectedId={request.styleId}
            testID="restyle-row"
            onChange={styleId => {
              setStyle(request.conversationId, request.kind, styleId);
              close();
              onSend(request.prompt, request.kind);
            }}
          />
        </>
      ) : null}
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors) => ({
  prompt: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
  },
});
