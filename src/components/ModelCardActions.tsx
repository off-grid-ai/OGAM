import React from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { triggerHaptic } from '../utils/haptics';
import { createStyles } from './ModelCard.styles';

interface ModelCardActionsProps {
  isDownloaded: boolean | undefined;
  isDownloading: boolean | undefined;
  isActive: boolean | undefined;
  isCompatible: boolean;
  incompatibleReason: string | undefined;
  testID: string | undefined;
  onDownload: (() => void) | undefined;
  onSelect: (() => void) | undefined;
  onDelete: (() => void) | undefined;
  onRepairVision: (() => void) | undefined;
  isRepairingVision?: boolean;
  onCancel: (() => void) | undefined;
}

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

function ActionButton({
  icon,
  color,
  haptic,
  onPress,
  disabled,
  testID,
  styles,
}: {
  icon: string;
  color: string;
  haptic: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <TouchableOpacity
      style={styles.iconButton}
      onPress={() => {
        triggerHaptic(haptic as any);
        onPress();
      }}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      testID={testID}
    >
      <Icon name={icon} size={16} color={color} />
    </TouchableOpacity>
  );
}

function DownloadedActions({
  isActive,
  testID,
  colors,
  styles,
  onSelect,
  onDelete,
  onRepairVision,
  isRepairingVision,
}: Readonly<{
  isActive?: boolean;
  testID?: string;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  onSelect?: () => void;
  onDelete?: () => void;
  onRepairVision?: () => void;
  isRepairingVision?: boolean;
}>) {
  const tid = (suffix: string) => (testID ? `${testID}-${suffix}` : undefined);
  if (!onSelect && !onDelete && !onRepairVision) {
    return (
      <Icon
        name="check-circle"
        size={16}
        color={colors.primary}
        testID={tid('downloaded')}
      />
    );
  }
  return (
    <>
      {isRepairingVision ? (
        <View style={styles.iconButton} testID={tid('repairing-vision')}>
          <ActivityIndicator size="small" color={colors.warning} />
        </View>
      ) : (
        onRepairVision && (
          <ActionButton
            icon="tool"
            color={colors.warning}
            haptic="impactLight"
            onPress={onRepairVision}
            testID={tid('repair-vision')}
            styles={styles}
          />
        )
      )}
      {!isActive && onSelect && (
        <ActionButton
          icon="check-circle"
          color={colors.primary}
          haptic="selection"
          onPress={onSelect}
          styles={styles}
        />
      )}
      {onDelete && (
        <ActionButton
          icon="trash-2"
          color={colors.error}
          haptic="notificationWarning"
          onPress={onDelete}
          styles={styles}
        />
      )}
    </>
  );
}

export const ModelCardActions: React.FC<ModelCardActionsProps> = ({
  isDownloaded,
  isDownloading,
  isActive,
  isCompatible,
  testID,
  onDownload,
  onSelect,
  onDelete,
  onRepairVision,
  isRepairingVision,
  onCancel,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const tid = (suffix: string) => (testID ? `${testID}-${suffix}` : undefined);
  if (isDownloading && onCancel) {
    return (
      <ActionButton
        icon="x"
        color={colors.error}
        haptic="notificationWarning"
        onPress={onCancel}
        testID={tid('cancel')}
        styles={styles}
      />
    );
  }
  if (!isDownloaded && onDownload) {
    return (
      <ActionButton
        icon="download"
        color={colors.primary}
        haptic="impactLight"
        onPress={onDownload}
        disabled={!isCompatible}
        testID={tid('download')}
        styles={styles}
      />
    );
  }
  if (isDownloaded) {
    return (
      <DownloadedActions
        isActive={isActive}
        testID={testID}
        colors={colors}
        styles={styles}
        onSelect={onSelect}
        onDelete={onDelete}
        onRepairVision={onRepairVision}
        isRepairingVision={isRepairingVision}
      />
    );
  }
  return null;
};
