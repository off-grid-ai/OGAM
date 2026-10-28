import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LoadingDots } from '../LoadingDots';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { remoteServerManager } from '../../services/remoteServerManager';
import { useTheme } from '../../theme';

/**
 * The trailing control of a remote model row while that model loads on the server. Loading has no
 * deadline and a server may never answer, so the row offers Stop: the request is closed and the
 * selection stays as it was.
 */
export const ModelSwitchStop: React.FC<{ testID?: string }> = ({ testID }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <LoadingDots color={colors.primary} testID={testID} />
      <TouchableOpacity
        onPress={() => remoteServerManager.stopModelSwitch()}
        accessibilityRole="button"
        accessibilityLabel="Stop loading this model"
        hitSlop={8}
        testID="model-switch-stop"
      >
        <Text style={[styles.label, { color: colors.primary }]}>Stop</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  label: { ...TYPOGRAPHY.label },
});
