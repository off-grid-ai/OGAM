import React from 'react';
import { View, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppSheet } from '../../components/AppSheet';
import { VoiceModelsUpsell } from './VoiceModelsUpsell';
import { useSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

// The pro Voice panel is a ScrollView, which collapses to zero height inside a
// content-sized sheet. Give the content a definite height so it renders.
const PANEL_HEIGHT = Math.round(Dimensions.get('window').height * 0.6);

/**
 * Voice (TTS) model picker — reuses the pro Voice panel (engine selection +
 * link to voice options) rendered via the modelsScreen.voiceTab slot. Renders an
 * empty-state line in free builds where the slot isn't registered.
 */
export const VoiceModelsSheet: React.FC<Props> = ({ visible, onClose }) => {
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation();
  // Reactive: picks up the pro Voice panel live when Pro is activated at runtime
  // (loadProFeatures registers the slot), without needing an app restart.
  const VoicePanel = useSlot(SLOTS.modelsScreenVoiceTab);

  // Free build: show the same Pro upsell the Models → Voice tab uses, instead of
  // a dead-end "not available" line. Close the sheet first so the Pro screen
  // isn't presented while this bottom sheet is still dismissing (iOS).
  const handleGetPro = () => {
    onClose();
    (navigation as unknown as { navigate: (name: string) => void }).navigate('ProDetail');
  };

  return (
    <AppSheet visible={visible} onClose={onClose} title="VOICE MODEL" enableDynamicSizing>
      <View style={styles.content}>
        {VoicePanel ? <VoicePanel /> : <VoiceModelsUpsell onGetPro={handleGetPro} />}
      </View>
    </AppSheet>
  );
};

const createStyles = (_colors: ThemeColors) => ({
  content: { height: PANEL_HEIGHT },
});
