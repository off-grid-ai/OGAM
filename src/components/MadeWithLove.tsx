import React from 'react';
import { View, Text, Image, Linking, StyleSheet } from 'react-native';
import { TouchableOpacity } from './Touchable';
import { TYPOGRAPHY, WEDNESDAY_URL } from '../constants';
import { useTheme } from '../theme';

/**
 * The pinned "Built by Wednesday" credit. One muted colour for words and logo: the brand allows one accent
 * (emerald), and a red heart and a full-colour logo were the loudest thing on the screen (screen review).
 */
export const MadeWithLove: React.FC = () => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(WEDNESDAY_URL)}
      style={styles.container}
      accessibilityRole="link"
      accessibilityLabel="Built by Wednesday"
    >
      <View style={styles.row}>
        <Text style={[styles.text, { color: colors.textMuted }]}>{'Built by'}</Text>
        <Image
          source={require('../assets/wednesday_logo.png')}
          style={[styles.logo, { tintColor: colors.textMuted }]}
        />
        <Text style={[styles.text, { color: colors.textMuted }]}>{'Wednesday'}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { ...(TYPOGRAPHY.bodySmall as object) },
  logo: { width: 16, height: 16, resizeMode: 'contain', marginHorizontal: 4 },
});
