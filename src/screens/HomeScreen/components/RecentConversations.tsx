import React from 'react';
import { View, Text } from 'react-native';
import { TouchableOpacity } from '../../../components/Touchable';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedListItem } from '../../../components/AnimatedListItem';
import { useTheme, useThemedStyles } from '../../../theme';
import { createStyles } from '../styles';
import { Conversation } from '../../../types';
import { formatWhen } from '../../../utils/localTime';
import { useConversationPreviewLine } from '../../../hooks/useConversationPreviewLine';

const formatDate = (dateStr: string): string => formatWhen(dateStr);

type Props = {
  conversations: Conversation[];
  /** Total chats across all conversations — shown next to "See all". */
  totalCount?: number;
  focusTrigger: number;
  onContinueChat: (conversationId: string) => void;
  onDeleteConversation: (conversation: Conversation) => void;
  onSeeAll: () => void;
};

export const RecentConversations: React.FC<Props> = ({
  conversations,
  totalCount,
  focusTrigger,
  onContinueChat,
  onDeleteConversation,
  onSeeAll,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const previewLine = useConversationPreviewLine();

  const renderRightActions = (conversation: Conversation) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => onDeleteConversation(conversation)}
      testID="delete-conversation-button"
    >
      <Icon name="trash-2" size={16} color={colors.error} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent</Text>
        <TouchableOpacity onPress={onSeeAll} testID="conversation-list-button">
          <Text style={styles.seeAll}>
            See all{typeof totalCount === 'number' ? ` (${totalCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
      {conversations.map((conv, index) => (
        <Swipeable
          key={conv.id}
          renderRightActions={() => renderRightActions(conv)}
          overshootRight={false}
          containerStyle={styles.swipeableContainer}
        >
          <AnimatedListItem
            index={index}
            staggerMs={40}
            trigger={focusTrigger}
            style={styles.conversationItem}
            onPress={() => onContinueChat(conv.id)}
            testID={`conversation-item-${index}`}
          >
            <View style={styles.conversationInfo}>
              <View style={styles.conversationHeader}>
                <Text style={styles.conversationTitle} numberOfLines={1}>
                  {conv.title}
                </Text>
                <Text style={styles.conversationMeta}>
                  {formatDate(conv.updatedAt)}
                </Text>
              </View>
              {(() => {
                const preview = previewLine(conv.messages);
                return preview ? (
                  <Text style={styles.conversationPreview} numberOfLines={1}>
                    {preview}
                  </Text>
                ) : null;
              })()}
            </View>
            <Icon name="chevron-right" size={14} color={colors.textMuted} />
          </AnimatedListItem>
        </Swipeable>
      ))}
    </View>
  );
};
