import React from 'react';
import { View, Text } from 'react-native';
import { TouchableOpacity } from '../../../components/Touchable';
import { SwipeToDelete } from '../../../components/SwipeToDelete';
import { AnimatedListItem } from '../../../components/AnimatedListItem';
import { ListGroup } from '../../../components/ListGroup';
import { useThemedStyles } from '../../../theme';
import { createStyles } from '../styles';
import { Conversation } from '../../../types';
import { formatWhen } from '../../../utils/localTime';
import { chatTitle } from '../../../utils/chatTitle';

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
  const styles = useThemedStyles(createStyles);

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
      <ListGroup testID="recent-conversations">
      {conversations.map((conv, index) => (
        <SwipeToDelete
          key={conv.id}
          onDelete={() => onDeleteConversation(conv)}
          label={conv.title}
          testID="delete-conversation-button"
        >
          <AnimatedListItem
            index={index}
            staggerMs={40}
            trigger={focusTrigger}
            style={styles.conversationItem}
            onPress={() => onContinueChat(conv.id)}
            testID={`conversation-item-${index}`}
            // In words: grouped, the row also read its chevron glyph aloud (hand test 41).
            accessibilityRole="button"
            accessibilityLabel={`${chatTitle(conv.title)}, ${formatDate(conv.updatedAt)}`}
          >
            {/* One line, as on Chats: the title and when. No reply preview and no chevron; a short
                group of four keeps its card (Mac, 2026-11-07: the two-line chat rows read like settings). */}
            <Text style={styles.conversationTitle} numberOfLines={1}>
              {chatTitle(conv.title)}
            </Text>
            <Text style={styles.conversationMeta}>{formatDate(conv.updatedAt)}</Text>
          </AnimatedListItem>
        </SwipeToDelete>
      ))}
      </ListGroup>
    </View>
  );
};
