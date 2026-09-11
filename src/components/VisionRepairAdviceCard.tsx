import React, { useState } from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { AnimatedPressable } from './AnimatedPressable';
import { LoadingDots } from './LoadingDots';
import { useAppStore } from '../stores';
import { useActiveLocalModelId } from '../hooks/useActiveMobileModel';
import { modelLibrary } from '../services';
import { needsVisionRepair } from '../utils/visionRepair';
import { visionRepairMessage } from '@offgrid/application';

/**
 * In-chat notice: the model you are talking to was built to read images and cannot right now.
 *
 * It lives in the CHAT because that is where the loss is discovered. A vision model whose projector
 * is missing still carries its vision label, so the composer refuses the attachment while the model
 * looks capable - and the repair sits in the Download Manager, which nobody visits to solve a
 * problem they have just been told does not exist. The user's own words: they may not know it can
 * be fixed from there at all.
 *
 * Repair happens HERE rather than sending the user somewhere else, and the outcome is reported
 * through the shared message rule so this card and the Download Manager cannot describe the same
 * event differently.
 */
export const VisionRepairAdviceCard: React.FC<{ onRepaired?: () => void }> = ({
  onRepaired,
}) => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [dismissed, setDismissed] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const downloadedModels = useAppStore(s => s.downloadedModels);
  const activeModelId = useActiveLocalModelId('text');

  const activeModel = downloadedModels.find(m => m.id === activeModelId);
  const broken =
    activeModel?.engine === 'llama' &&
    needsVisionRepair({
      isVisionModel: activeModel.isVisionModel,
      mmProjPath: activeModel.mmProjPath,
      mmProjFileName: activeModel.mmProjFileName,
      name: activeModel.name,
      fileName: activeModel.fileName,
    });

  if (!broken || dismissed || !activeModel) return null;

  const repair = async (): Promise<void> => {
    setRepairing(true);
    try {
      const repairResult = await modelLibrary.executeVisionRepair({
        type: 'repair-model',
        model: activeModel,
      });
      if (repairResult.status === 'failed') throw new Error(repairResult.error);
      if (repairResult.status === 'installed-reconciliation-pending') {
        setResult(repairResult.message);
        onRepaired?.();
        return;
      }
      const outcome = repairResult.outcome;
      const [, body] = visionRepairMessage(outcome, activeModel.name);
      setResult(body);
      // Only a repair that actually landed is worth reloading for; the other outcomes leave the
      // model exactly as it was and the card keeps its explanation on screen.
      if (outcome.kind === 'repaired' || outcome.kind === 'linked')
        onRepaired?.();
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Could not repair vision.');
    } finally {
      setRepairing(false);
    }
  };

  return (
    <View style={styles.card} testID="vision-repair-advice">
      <View style={styles.headerRow}>
        <Icon
          name="image"
          size={14}
          color={colors.warning}
          style={styles.leadIcon}
        />
        <Text style={styles.title}>This model can&apos;t see images</Text>
        <AnimatedPressable
          onPress={() => setDismissed(true)}
          hitSlop={8}
          accessibilityLabel="Dismiss"
          testID="vision-repair-advice-dismiss"
        >
          <Icon name="x" size={16} color={colors.textSecondary} />
        </AnimatedPressable>
      </View>
      <Text style={styles.intro}>
        Its vision file is missing. Get it without re-downloading the model.
      </Text>
      {result ? (
        <Text style={styles.result} testID="vision-repair-advice-result">
          {result}
        </Text>
      ) : (
        <AnimatedPressable
          style={styles.action}
          onPress={repair}
          disabled={repairing}
          testID="vision-repair-advice-repair"
        >
          {repairing ? (
            <LoadingDots color={colors.primary} style={styles.tipIcon} />
          ) : (
            <Icon
              name="download"
              size={13}
              color={colors.primary}
              style={styles.tipIcon}
            />
          )}
          <Text style={styles.actionText}>
            {repairing ? 'Fetching…' : 'Get vision file'}
          </Text>
        </AnimatedPressable>
      )}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  card: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.xs,
  },
  leadIcon: { marginRight: SPACING.xs },
  title: { ...TYPOGRAPHY.h3, color: colors.text, flex: 1 },
  intro: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    marginBottom: SPACING.sm,
  },
  action: { flexDirection: 'row' as const, alignItems: 'center' as const },
  tipIcon: { marginRight: SPACING.xs },
  actionText: { ...TYPOGRAPHY.meta, color: colors.primary, flex: 1 },
  result: { ...TYPOGRAPHY.meta, color: colors.textSecondary },
});
