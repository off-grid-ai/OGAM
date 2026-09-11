import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { modelsFailureMessage } from '@offgrid/application';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { AnimatedPressable } from './AnimatedPressable';
import { useAppStore } from '../stores';
import { useActiveLocalModelId } from '../hooks/useActiveMobileModel';
import { useModelsProjection } from '../hooks/useApplicationProjection';
import { modelSupportsMtp } from '../services/mtpDetection';
import { applicationFacade } from '../services/applicationFacade';

/**
 * In-chat suggestion: this model can draft its own tokens, and you are not using it.
 *
 * It lives in the CHAT rather than in settings because nobody goes looking for a setting whose
 * benefit they have not been told about — and MTP is worth telling: the model verifies several
 * drafted tokens per forward pass, so the same reply arrives sooner. Only models built with MTP
 * layers can do it, which is why this appears for those models and stays silent for the rest
 * instead of advertising a speed-up most models cannot deliver.
 *
 * Turning it on RELOADS the model, because speculative decoding is fixed when llama.cpp builds the
 * graph. The card says so before you tap, since an unannounced reload in the middle of a
 * conversation reads as a hang.
 */
export const MtpAdviceCard: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [dismissed, setDismissed] = useState(false);
  const [supported, setSupported] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const speculativeDecoding =
    useModelsProjection().settings.speculativeDecoding === true;
  const downloadedModels = useAppStore(s => s.downloadedModels);
  const activeModelId = useActiveLocalModelId('text');
  const activeModel = downloadedModels.find(m => m.id === activeModelId);
  const modelPath = activeModel?.engine === 'litert' ? undefined : activeModel?.filePath;

  useEffect(() => {
    let cancelled = false;
    modelSupportsMtp(modelPath).then(value => { if (!cancelled) setSupported(value); });
    return () => { cancelled = true; };
  }, [modelPath]);

  if (!supported || speculativeDecoding || dismissed) return null;

  const enable = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const outcome = await applicationFacade().models.settings.save({
        origin: 'local',
        patch: { speculativeDecoding: true },
      });
      if (!outcome.ok) setError(modelsFailureMessage(outcome.failure));
      else if (outcome.value.syncFailure) {
        setError('The setting was saved on this device, but it could not sync yet.');
      }
    } catch {
      setError('This setting could not be saved. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.card} testID="mtp-advice">
      <View style={styles.headerRow}>
        <Icon name="zap" size={14} color={colors.primary} style={styles.leadIcon} />
        <Text style={styles.title}>This model can reply faster</Text>
        <AnimatedPressable onPress={() => setDismissed(true)} hitSlop={8} accessibilityLabel="Dismiss" testID="mtp-advice-dismiss">
          <Icon name="x" size={16} color={colors.textSecondary} />
        </AnimatedPressable>
      </View>
      <Text style={styles.intro}>
        {activeModel?.name ?? 'This model'} was built to draft several tokens at once and check them
        in one pass. Same answers, less waiting.
      </Text>
      {error ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite" testID="mtp-advice-error">
          {error}
        </Text>
      ) : null}
      <AnimatedPressable
        style={styles.action}
        onPress={enable}
        disabled={pending}
        testID="mtp-advice-enable"
      >
        <Icon name="check-circle" size={13} color={colors.primary} style={styles.tipIcon} />
        <Text style={styles.actionText}>
          {pending
            ? 'Turning on speculative decoding…'
            : 'Turn on speculative decoding and reload the model'}
        </Text>
      </AnimatedPressable>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  card: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.sm, padding: SPACING.md,
    borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, marginBottom: SPACING.xs },
  leadIcon: { marginRight: SPACING.xs },
  title: { ...TYPOGRAPHY.h3, color: colors.text, flex: 1 },
  intro: { ...TYPOGRAPHY.meta, color: colors.textSecondary, marginBottom: SPACING.sm },
  errorText: { ...TYPOGRAPHY.meta, color: colors.error, marginBottom: SPACING.sm },
  action: { flexDirection: 'row' as const, alignItems: 'center' as const },
  tipIcon: { marginRight: SPACING.xs },
  actionText: { ...TYPOGRAPHY.meta, color: colors.primary, flex: 1 },
});
