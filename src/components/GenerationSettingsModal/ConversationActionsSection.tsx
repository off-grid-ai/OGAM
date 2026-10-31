import React from 'react';
import { View, Text } from 'react-native';
import { TouchableOpacity } from '../Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';

interface ConversationActionsSectionProps {
  onClose: () => void;
  onOpenProject?: () => void;
  onOpenGallery?: () => void;
  onDeleteConversation?: () => void;
  conversationImageCount: number;
  activeProjectName?: string | null;
}

export const ConversationActionsSection: React.FC<ConversationActionsSectionProps> = ({
  onClose,
  onOpenProject,
  onOpenGallery,
  onDeleteConversation,
  conversationImageCount,
  activeProjectName,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const hasActions = onOpenProject || onOpenGallery || onDeleteConversation;
  if (!hasActions) {
    return null;
  }

  const handleOpenProject = () => {
    onClose();
    setTimeout(onOpenProject!, 350);
  };

  const handleOpenGallery = () => {
    onClose();
    setTimeout(onOpenGallery!, 200);
  };

  const handleDeleteConversation = () => {
    onClose();
    setTimeout(onDeleteConversation!, 200);
  };

  return (
    <View>
      {onOpenProject && (
        <TouchableOpacity style={styles.actionRow} onPress={handleOpenProject}>
          <Icon name="folder" size={16} color={colors.textSecondary} />
          <Text style={styles.actionText}>
            Project: {activeProjectName || 'Default'}
          </Text>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      {onOpenGallery && conversationImageCount > 0 && (
        <TouchableOpacity style={styles.actionRow} onPress={handleOpenGallery}>
          <Icon name="image" size={16} color={colors.textSecondary} />
          <Text style={styles.actionText}>
            Gallery ({conversationImageCount})
          </Text>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      {onDeleteConversation && (
        <TouchableOpacity style={styles.actionRow} onPress={handleDeleteConversation}>
          <Icon name="trash-2" size={16} color={colors.error} />
          <Text style={styles.actionTextError}>Delete Conversation</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};
