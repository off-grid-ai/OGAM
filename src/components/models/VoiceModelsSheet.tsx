import React from 'react';
import { View, Dimensions } from 'react-native';
import { AppSheet } from '../../components/AppSheet';
import { useSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

// The voice panel is a ScrollView, which collapses to zero height inside a
// content-sized sheet. Give the content a definite height so it renders.
const PANEL_HEIGHT = Math.round(Dimensions.get('window').height * 0.6);

/** Voice (TTS) model picker: the voice panel registered in the modelsScreen.voiceTab slot. */
export const VoiceModelsSheet: React.FC<Props> = ({ visible, onClose }) => {
  const styles = useThemedStyles(createStyles);
  // Reactive: picks up the panel as soon as it is registered.
  const VoicePanel = useSlot(SLOTS.modelsScreenVoiceTab);

  return (
    <AppSheet visible={visible} onClose={onClose} title="VOICE MODEL" enableDynamicSizing>
      <View style={styles.content}>
        {VoicePanel ? <VoicePanel /> : null}
      </View>
    </AppSheet>
  );
};

const createStyles = (_colors: ThemeColors) => ({
  content: { height: PANEL_HEIGHT },
});
