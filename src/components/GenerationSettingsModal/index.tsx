import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../AppSheet';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { llmService } from '../../services';
import { createStyles } from './styles';
import { ConversationActionsSection } from './ConversationActionsSection';
import { AgentChip } from '../AgentChip';
import { useChatStore } from '../../stores/chatStore';
import { ChatContextSection } from './ChatContextSection';
import { ImageGenerationSection } from './ImageGenerationSection';
import { TextGenerationSection } from './TextGenerationSection';
import { ResearchSettingsSection, type ResearchDepth } from './ResearchSettingsSection';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { SWEET_SPOT_SIZE, DEFAULT_IMAGE_GUIDANCE, DEFAULT_IMAGE_STEPS } from '../../utils/imageGenAdvice';

const chatRowStyles = StyleSheet.create({
  agentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, gap: 12 },
  modelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
});

const DEFAULT_SETTINGS = {
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 4096,
  nThreads: 0,
  nBatch: 512,
  // Reset the image params too, from the same single source the pipeline honors — a
  // reset previously left a custom image size/guidance untouched (Q12).
  imageWidth: SWEET_SPOT_SIZE,
  imageHeight: SWEET_SPOT_SIZE,
  imageGuidanceScale: DEFAULT_IMAGE_GUIDANCE,
  imageSteps: DEFAULT_IMAGE_STEPS,
};

interface GenerationSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onOpenProject?: () => void;
  onOpenModels?: () => void;
  activeConversationId?: string | null;
  onOpenGallery?: () => void;
  onDeleteConversation?: () => void;
  onOpenTTSSettings?: () => void;
  researchMode?: boolean;
  onResearchModeChange?: (enabled: boolean) => void;
  researchDepth?: ResearchDepth;
  onResearchDepthChange?: (depth: ResearchDepth) => void;
  researchBusy?: boolean;
  researchStatus?: string | null;
  conversationImageCount?: number;
  activeProjectName?: string | null;
  isRemote?: boolean;
}

export const GenerationSettingsModal: React.FC<GenerationSettingsModalProps> = ({
  visible,
  onClose,
  onOpenProject,
  onOpenModels,
  activeConversationId,
  onOpenGallery,
  onDeleteConversation,
  onOpenTTSSettings,
  researchMode = false,
  onResearchModeChange,
  researchDepth = 'deep',
  onResearchDepthChange,
  researchBusy = false,
  researchStatus,
  conversationImageCount = 0,
  activeProjectName,
  isRemote,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { updateSettings } = useAppStore();

  const [performanceStats, setPerformanceStats] = useState(llmService.getPerformanceStats());
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [textSettingsOpen, setTextSettingsOpen] = useState(false);
  const [ttsSettingsOpen, setTtsSettingsOpen] = useState(false);
  // TTS settings come from the voice feature via a slot. Without it there is no TTS section.
  const TtsSection = getSlot(SLOTS.generationSettingsTts);

  useEffect(() => {
    if (visible) {
      setPerformanceStats(llmService.getPerformanceStats());
    }
  }, [visible]);

  const handleResetDefaults = () => {
    updateSettings(DEFAULT_SETTINGS);
  };

  const hasConversationActions = !!(onOpenProject || onOpenGallery || onDeleteConversation);

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['50%', '90%']}
      title="Chat Settings"
    >
      {performanceStats.lastTokensPerSecond > 0 && (
        <View style={styles.statsBar}>
          <Text style={styles.statsLabel}>Last Generation:</Text>
          <Text style={styles.statsValue}>
            {performanceStats.lastTokensPerSecond.toFixed(1)} tok/s
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
        <View style={chatRowStyles.agentRow}>
          <Text style={[chatRowStyles.rowTitle, { color: colors.text }]}>Agent</Text>
          <AgentChip onSelect={(id) => { if (activeConversationId) useChatStore.getState().setConversationAgent(activeConversationId, id); }} colors={colors} styles={{ headerProjectRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 }, headerSubtitle: { fontSize: 14 } }} />
        </View>
        {onOpenModels && (
          <TouchableOpacity onPress={onOpenModels} style={chatRowStyles.modelRow} testID="chat-settings-change-model">
            <Text style={[chatRowStyles.rowTitle, { color: colors.text }]}>Models</Text>
            <Icon name="chevron-right" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
        {onResearchModeChange && onResearchDepthChange && (
          <ResearchSettingsSection
            enabled={researchMode}
            onEnabledChange={onResearchModeChange}
            depth={researchDepth}
            onDepthChange={onResearchDepthChange}
            busy={researchBusy}
            status={researchStatus}
          />
        )}
        <ConversationActionsSection
          onClose={onClose}
          onOpenProject={onOpenProject}
          onOpenGallery={onOpenGallery}
          onDeleteConversation={onDeleteConversation}
          conversationImageCount={conversationImageCount}
          activeProjectName={activeProjectName}
        />
        <ChatContextSection />

        {/* IMAGE GENERATION SETTINGS */}
        <TouchableOpacity
          style={[
            styles.accordionHeader,
            !hasConversationActions && styles.accordionHeaderNoMargin,
          ]}
          onPress={() => setImageSettingsOpen(!imageSettingsOpen)}
          activeOpacity={0.7}
        >
          <Text style={styles.accordionTitle}>IMAGE GENERATION</Text>
          <Icon
            name={imageSettingsOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        {imageSettingsOpen && <ImageGenerationSection />}

        {/* TEXT GENERATION SETTINGS */}
        <TouchableOpacity
          style={styles.accordionHeader}
          onPress={() => setTextSettingsOpen(!textSettingsOpen)}
          activeOpacity={0.7}
        >
          <Text style={styles.accordionTitle}>TEXT GENERATION</Text>
          <Icon
            name={textSettingsOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        {textSettingsOpen && (
          <>
            {isRemote && (
              <View style={styles.remoteNotice}>
                <Icon name="info" size={13} color={colors.textMuted} />
                <Text style={styles.remoteNoticeText}>
                  These settings only apply to local models and won't affect the current remote session.
                </Text>
              </View>
            )}
            <TextGenerationSection />
          </>
        )}

        {/* TTS SETTINGS (voice feature) */}
        {TtsSection && (
          <>
            <TouchableOpacity
              style={styles.accordionHeader}
              onPress={() => setTtsSettingsOpen(!ttsSettingsOpen)}
              activeOpacity={0.7}
            >
              <Text style={styles.accordionTitle}>TEXT TO SPEECH</Text>
              <Icon
                name={ttsSettingsOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </TouchableOpacity>
            {ttsSettingsOpen && (
              <TtsSection onNavigateToTTSSettings={onOpenTTSSettings} />
            )}
          </>
        )}

        <TouchableOpacity style={styles.resetButton} onPress={handleResetDefaults}>
          <Text style={styles.resetButtonText}>Reset to Defaults</Text>
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </AppSheet>
  );
};
