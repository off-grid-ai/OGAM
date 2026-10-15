import React from 'react';
import { View, Dimensions } from 'react-native';
import { AppSheet } from '../../components/AppSheet';
import { VoiceModelsEmptyState } from './VoiceModelsEmptyState';
import { useSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onClosed?: () => void;
  onBackToModels?: () => void;
};

// The pro Voice panel is a ScrollView, which collapses to zero height inside a
// content-sized sheet. Give the content a definite height so it renders.
const PANEL_HEIGHT = Math.round(Dimensions.get('window').height * 0.6);

/**
 * Voice (TTS) model picker — reuses the voice panel (engine selection + link to voice options) that the
 * optional pro bundle registers via the modelsScreen.voiceTab slot. In a build without the bundle the
 * slot is empty and the empty state explains that, with no route to a purchase: voice is free, and the
 * only thing a build can lack is the code.
 */
export const VoiceModelsSheet: React.FC<Props> = ({
  visible,
  onClose,
  onClosed,
  onBackToModels,
}) => {
  const styles = useThemedStyles(createStyles);
  // Reactive: picks up the pro Voice panel live when the bundle is loaded at runtime
  // (loadProFeatures registers the slot), without needing an app restart.
  const VoicePanel = useSlot(SLOTS.modelsScreenVoiceTab);

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      onBackPress={onBackToModels}
      title="VOICE MODEL"
      enableDynamicSizing
    >
      <View style={styles.content}>
        {VoicePanel ? <VoicePanel /> : <VoiceModelsEmptyState />}
      </View>
    </AppSheet>
  );
};

const createStyles = (_colors: ThemeColors) => ({
  content: { height: PANEL_HEIGHT },
});
