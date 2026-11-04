import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { MediaStyleKind } from '@offgrid/models';
import { useChatStore } from '../../stores/chatStore';
import { NEW_CHAT_STYLE_KEY, useMediaStyleStore } from '../../stores/mediaStyleStore';
import { SPACING } from '../../constants';
import { StyleRow } from './StyleRow';

/**
 * The chat's style for pictures or clips, in the image and video settings: the same choice the composer shows,
 * so a pick in either place is the chat's style.
 */
export const ChatStyleSetting: React.FC<{ kind: MediaStyleKind }> = ({ kind }) => {
  const chatKey = useChatStore(state => state.activeConversationId) ?? NEW_CHAT_STYLE_KEY;
  const selectedId = useMediaStyleStore(state => state.byChat[chatKey]?.[kind]);
  const setStyle = useMediaStyleStore(state => state.setStyle);
  return (
    // The card's padding is lg; the previews run to its edges so the row reads as scrollable.
    <View style={styles.bleed}>
      <StyleRow
        attached
        kind={kind}
        selectedId={selectedId}
        onChange={styleId => setStyle(chatKey, kind, styleId)}
        testID={`${kind}-settings-style`}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -SPACING.lg, marginTop: -SPACING.md, marginBottom: SPACING.sm },
});
