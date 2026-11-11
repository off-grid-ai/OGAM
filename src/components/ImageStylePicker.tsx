import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';
import { IMAGE_STYLES } from '../services/imageStyles';

/** Pick the look every generated picture gets (anime, realistic, cartoon...). */
export function ImageStylePicker() {
  const styles = useThemedStyles(createStyles);
  const current = useAppStore((s) => s.settings.imageStyle ?? 'none');
  const updateSettings = useAppStore((s) => s.updateSettings);
  return (
    <View style={styles.row} testID="image-style-picker">
      <Text style={styles.label}>Style</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {IMAGE_STYLES.map((s) => {
          const on = s.id === current;
          return (
            <TouchableOpacity key={s.id} onPress={() => updateSettings({ imageStyle: s.id })} style={[styles.chip, on && styles.chipOn]}
              accessibilityLabel={`Image style: ${s.name}`} accessibilityState={{ selected: on }} testID={`image-style-${s.id}`}>
              <Text style={on ? styles.chipTextOn : styles.chipText}>{s.name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  row: { marginTop: SPACING.md, gap: SPACING.xs },
  label: { ...TYPOGRAPHY.label, color: colors.text },
  chips: { gap: SPACING.xs, paddingRight: SPACING.md },
  chip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  chipTextOn: { ...TYPOGRAPHY.bodySmall, color: colors.background },
});
