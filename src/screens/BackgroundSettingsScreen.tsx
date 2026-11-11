import React, { useState } from 'react';
import { Alert, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../stores/appStore';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

const SCREENS = [
  { key: 'Home', label: 'Home screen' },
  { key: 'Compass', label: 'Compass' },
  { key: 'Settings', label: 'Settings' },
  { key: 'Learning', label: 'Learning' },
  { key: 'DailyBrief', label: 'Daily briefing' },
  { key: 'Maps', label: 'Maps' },
];

export const BackgroundSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const screenBackgrounds = useAppStore((s) => s.settings.screenBackgrounds) ?? {};
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [selected, setSelected] = useState<string | null>(null);

  const bg = selected ? (screenBackgrounds[selected] ?? { uri: '', blur: 0, dim: 0, opacity: 1 }) : null;

  const pickImage = async () => {
    if (!selected) return;
    try {
      const { pick, isErrorWithCode, errorCodes } = require('@react-native-documents/picker');
      const picked = Platform.OS === 'android'
        ? await pick({ mode: 'open', allowMultiSelection: false, type: ['image/*'] })
        : await pick({ mode: 'import', allowMultiSelection: false, type: ['public.image'] });
      if (!picked?.length) return;
      const uri = picked[0].uri;
      updateSettings({ screenBackgrounds: { ...screenBackgrounds, [selected]: { ...(screenBackgrounds[selected] ?? { blur: 0, dim: 0, opacity: 1 }), uri } } });
    } catch (e: any) {
      const { isErrorWithCode, errorCodes } = require('@react-native-documents/picker');
      if (!isErrorWithCode(e) || e.code !== errorCodes.OPERATION_CANCELED) {
        Alert.alert('Could not pick image', String(e?.message ?? e));
      }
    }
  };

  const clearBg = () => {
    if (!selected) return;
    const next = { ...screenBackgrounds };
    delete next[selected];
    updateSettings({ screenBackgrounds: next });
  };

  const setBgProp = (prop: 'blur' | 'dim', value: number) => {
    if (!selected) return;
    updateSettings({ screenBackgrounds: { ...screenBackgrounds, [selected]: { ...(screenBackgrounds[selected] ?? { uri: '', opacity: 1 }), [prop]: value } } });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Background images</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>SCREENS</Text>
        <View style={styles.list}>
          {SCREENS.map((s) => {
            const hasBg = !!screenBackgrounds[s.key]?.uri;
            return (
              <TouchableOpacity
                key={s.key}
                style={[styles.row, selected === s.key && styles.rowSelected]}
                onPress={() => setSelected(s.key === selected ? null : s.key)}>
                <Icon name="image" size={18} color={hasBg ? colors.primary : colors.textMuted} />
                <Text style={[styles.rowLabel, hasBg && { color: colors.primary }]}>{s.label}</Text>
                {hasBg && <Icon name="check" size={14} color={colors.primary} />}
                <Icon name={selected === s.key ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
              </TouchableOpacity>
            );
          })}
        </View>

        {selected && bg !== null && (
          <View style={styles.editor}>
            <Text style={styles.sectionLabel}>CONFIGURE – {SCREENS.find((s) => s.key === selected)?.label?.toUpperCase()}</Text>
            <TouchableOpacity style={styles.pickBtn} onPress={pickImage}>
              <Icon name="image" size={18} color={colors.text} />
              <Text style={styles.pickBtnText}>{bg.uri ? 'Change image' : 'Pick an image'}</Text>
            </TouchableOpacity>
            {bg.uri ? (
              <>
                <View style={styles.sliderRow}>
                  <Text style={styles.sliderLabel}>Blur</Text>
                  <Slider
                    style={styles.slider}
                    minimumValue={0}
                    maximumValue={20}
                    step={1}
                    value={bg.blur ?? 0}
                    onValueChange={(v: number) => setBgProp('blur', v)}
                    minimumTrackTintColor={colors.primary}
                    maximumTrackTintColor={colors.border}
                    thumbTintColor={colors.primary}
                  />
                  <Text style={styles.sliderValue}>{Math.round(bg.blur ?? 0)}</Text>
                </View>
                <View style={styles.sliderRow}>
                  <Text style={styles.sliderLabel}>Dimming</Text>
                  <Slider
                    style={styles.slider}
                    minimumValue={0}
                    maximumValue={0.85}
                    step={0.05}
                    value={bg.dim ?? 0}
                    onValueChange={(v: number) => setBgProp('dim', Math.round(v * 20) / 20)}
                    minimumTrackTintColor={colors.primary}
                    maximumTrackTintColor={colors.border}
                    thumbTintColor={colors.primary}
                  />
                  <Text style={styles.sliderValue}>{Math.round((bg.dim ?? 0) * 100)}%</Text>
                </View>
                <TouchableOpacity style={styles.clearBtn} onPress={clearBg}>
                  <Icon name="trash-2" size={16} color="#DC2626" />
                  <Text style={[styles.clearBtnText, { color: '#DC2626' }]}>Remove background</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        )}

        <Text style={styles.note}>
          Background images display behind the screen content. Pick an image for each screen, then adjust the blur and dimming so your text stays readable.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, minHeight: 60,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface, ...shadows.small,
  },
  backButton: { width: 40, alignItems: 'center' as const },
  headerTitle: { ...TYPOGRAPHY.h3, color: colors.text },
  scrollView: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  sectionLabel: { ...TYPOGRAPHY.meta, color: colors.textSecondary, marginBottom: SPACING.xs, marginTop: SPACING.md },
  list: { backgroundColor: colors.surface, borderRadius: 10, ...shadows.small, overflow: 'hidden' as const },
  row: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    paddingHorizontal: SPACING.md, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowSelected: { backgroundColor: colors.surfaceLight },
  rowLabel: { flex: 1, ...TYPOGRAPHY.body, color: colors.text },
  editor: { marginTop: SPACING.lg, backgroundColor: colors.surface, borderRadius: 10, padding: SPACING.md, ...shadows.small },
  pickBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: colors.surfaceLight, borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.md,
  },
  pickBtnText: { ...TYPOGRAPHY.body, color: colors.text },
  sliderRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: SPACING.sm },
  sliderLabel: { ...TYPOGRAPHY.meta, color: colors.textSecondary, width: 60 },
  slider: { flex: 1 },
  sliderValue: { ...TYPOGRAPHY.meta, color: colors.textSecondary, width: 32, textAlign: 'right' as const },
  clearBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: SPACING.sm },
  clearBtnText: { ...TYPOGRAPHY.body },
  note: { ...TYPOGRAPHY.meta, color: colors.textSecondary, marginTop: SPACING.xl, textAlign: 'center' as const },
});
