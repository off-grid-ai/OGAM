import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { TouchableOpacity } from '../Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../AppSheet';
import { useTheme, useThemedStyles } from '../../theme';
import { llmService } from '../../services';
import { createStyles } from './styles';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { ConversationActionsSection } from './ConversationActionsSection';

interface GenerationSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onOpenProject?: () => void;
  onOpenGallery?: () => void;
  onDeleteConversation?: () => void;
  onOpenTTSSettings?: () => void;
  conversationImageCount?: number;
  activeProjectName?: string | null;
  isRemote?: boolean;
}

export const GenerationSettingsModal: React.FC<
  GenerationSettingsModalProps
> = ({
  visible,
  onClose,
  onOpenProject,
  onOpenGallery,
  onDeleteConversation,
  conversationImageCount = 0,
  activeProjectName,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [performanceStats, setPerformanceStats] = useState(llmService.getPerformanceStats());
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useEffect(() => {
    if (visible) {
      setPerformanceStats(llmService.getPerformanceStats());
    }
  }, [visible]);


  return (
    <AppSheet
      sheet="generation-settings"
      visible={visible}
      onClose={onClose}
      // A fixed short height for its few rows. Dynamic sizing measured the scroll view as zero and
      // opened the sheet as a bare header (hand test 72).
      snapPoints={['34%']}
      title="Chat settings"
    >
      {performanceStats.lastTokensPerSecond > 0 && (
        <View style={styles.statsBar}>
          <Text style={styles.statsLabel}>Last reply</Text>
          <Text style={styles.statsValue}>
            {performanceStats.lastTokensPerSecond.toFixed(1)} tokens a second
          </Text>
          <Text style={styles.statsSeparator}>•</Text>
          <Text style={styles.statsValue}>
            {performanceStats.lastTokenCount} tokens
          </Text>
          <Text style={styles.statsSeparator}>•</Text>
          <Text style={styles.statsValue}>
            {performanceStats.lastGenerationTime.toFixed(1)}s
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <ConversationActionsSection
          onClose={onClose}
          onOpenProject={onOpenProject}
          onOpenGallery={onOpenGallery}
          conversationImageCount={conversationImageCount}
          activeProjectName={activeProjectName}
        />

        {/* The model settings live in one place, Settings > Model settings, and this row opens it.
            The sheet used to copy every section (screen review). */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={() => {
            onClose();
            setTimeout(() => navigation.navigate('ModelSettings'), 200);
          }}
          accessibilityRole="button"
          testID="chat-settings-open-model-settings"
        >
          <Icon name="sliders" size={16} color={colors.textSecondary} />
          <Text style={styles.actionText}>Model settings</Text>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Deleting the chat is not a setting: it sits last, apart from them (hand test 61). */}
        {onDeleteConversation ? (
          <TouchableOpacity
            style={styles.resetButton}
            onPress={() => {
              onClose();
              setTimeout(onDeleteConversation, 200);
            }}
            accessibilityRole="button"
            testID="chat-settings-delete-chat"
          >
            <Text style={styles.deleteChatText}>Delete chat</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </AppSheet>
  );
};
