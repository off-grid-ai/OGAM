import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { AnimatedPressable } from '../AnimatedPressable';
import { useAppStore } from '../../stores';
import { useDownloadStore } from '../../stores/downloadStore';
import { makeModelKey } from '../../utils/modelKey';
import { devicePicks, PICK_LABELS, type DevicePick } from '../../services/devicePicks';
import { startModelDownload } from '../../services/startModelDownload';
import { activeModelService } from '../../services/activeModelService';
import { formatFileSize } from '@offgrid/models';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Fast, Balanced and Best for this phone, side by side at the top of the models list. One tap
 * downloads the model and makes it the active one when the download finishes; then the card
 * offers to chat. Nothing to compare or look up: the phone's own picks, from the shared rule.
 */
export const DevicePicksRow: React.FC<{ ramGB: number }> = ({ ramGB }) => {
  const styles = useThemedStyles(createStyles);
  const picks = useMemo(() => devicePicks(ramGB), [ramGB]);
  if (picks.length === 0) return null;
  return (
    <View style={styles.row} testID="device-picks">
      {picks.map(pick => <PickCard key={pick.slot} pick={pick} />)}
    </View>
  );
};

const PickCard: React.FC<{ pick: DevicePick }> = ({ pick }) => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const downloaded = useAppStore(s => s.downloadedModels.find(m => m.id === pick.model.id && m.fileName === pick.file.name));
  const isActive = useAppStore(s => !!downloaded && s.activeModelId === downloaded.id);
  const entry = useDownloadStore(s => s.downloads[makeModelKey(pick.model.id, pick.file.name)]);
  const downloading = !!entry && entry.status !== 'failed' && entry.status !== 'completed';

  const download = (): void => {
    startModelDownload(pick.model.id, pick.file, {
      onRegistered: model => activeModelService.selectTextModel(model.id),
    }).catch(() => {});
  };

  let action: React.ReactNode;
  if (isActive) {
    action = (
      <AnimatedPressable style={styles.primary} onPress={() => navigation.navigate('Chat', {})} testID={`pick-${pick.slot}-chat`}>
        <Text style={styles.primaryText}>Chat now</Text>
      </AnimatedPressable>
    );
  } else if (downloaded) {
    action = (
      <AnimatedPressable style={styles.secondary} onPress={() => activeModelService.selectTextModel(downloaded.id)} testID={`pick-${pick.slot}-use`}>
        <Text style={styles.secondaryText}>Use</Text>
      </AnimatedPressable>
    );
  } else if (downloading) {
    action = <Text style={styles.progress} testID={`pick-${pick.slot}-progress`}>{`${Math.round((entry?.progress ?? 0) * 100)}%`}</Text>;
  } else {
    action = (
      <AnimatedPressable style={styles.iconButton} onPress={download} accessibilityLabel={`Download ${pick.model.name}`} testID={`pick-${pick.slot}-download`}>
        <Icon name="download" size={16} color={colors.primary} />
      </AnimatedPressable>
    );
  }

  return (
    <View style={[styles.card, isActive && styles.cardActive]} testID={`pick-${pick.slot}`}>
      <Text style={styles.slot}>{PICK_LABELS[pick.slot]}</Text>
      <Text style={styles.name} numberOfLines={2}>{pick.model.name}</Text>
      <Text style={styles.size}>{formatFileSize(pick.sizeBytes)}</Text>
      <View style={styles.actionRow}>{action}</View>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  row: { flexDirection: 'row' as const, gap: SPACING.sm, paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  card: {
    flex: 1, padding: SPACING.sm, borderRadius: 8, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  cardActive: { borderColor: colors.primary },
  slot: { ...TYPOGRAPHY.meta, color: colors.primary, marginBottom: SPACING.xs },
  name: { ...TYPOGRAPHY.bodySmall, color: colors.text, minHeight: 36 },
  size: { ...TYPOGRAPHY.meta, color: colors.textSecondary, marginTop: SPACING.xs },
  actionRow: { marginTop: SPACING.sm, alignItems: 'flex-start' as const },
  iconButton: { padding: SPACING.xs, borderRadius: 6, borderWidth: 1, borderColor: colors.primary },
  primary: { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, borderRadius: 6, backgroundColor: colors.primary },
  primaryText: { ...TYPOGRAPHY.meta, color: colors.background },
  secondary: { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, borderRadius: 6, borderWidth: 1, borderColor: colors.primary },
  secondaryText: { ...TYPOGRAPHY.meta, color: colors.primary },
  progress: { ...TYPOGRAPHY.meta, color: colors.textSecondary },
});
