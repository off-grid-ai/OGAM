import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { LOCALES, resolveLocale } from '@offgrid/i18n';
import { AliveScreen } from '../components/AliveScreen';
import { ScreenHeader } from '../components/ScreenHeader';
import { TouchableOpacity } from '../components/Touchable';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { cardSurface } from '../theme/surface';
import { useLocaleStore } from '../stores/localeStore';
import { systemLanguages } from '../i18n/appLanguage';
import { AppSwitch } from '../components/AppSwitch';

interface RowProps {
  title: string;
  subtitle: string;
  selected: boolean;
  divided: boolean;
  onPress: () => void;
  testID: string;
}

const LanguageRow: React.FC<RowProps> = ({ title, subtitle, selected, divided, onPress, testID }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <TouchableOpacity
      style={[styles.row, divided && styles.rowDivided]}
      onPress={onPress}
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View style={styles.rowText}>
        {/* A language's own name stays as written in every app language. */}
        <Text style={styles.rowTitle} translate="no">{title}</Text>
        <Text style={styles.rowSubtitle} translate="no">{subtitle}</Text>
      </View>
      {selected ? <Icon name="check" size={18} color={colors.primary} /> : null}
    </TouchableOpacity>
  );
};

/** Settings → Language, also opened from the first onboarding page. The pick applies at once. */
export const LanguageScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const picked = useLocaleStore(s => s.picked);
  const setPicked = useLocaleStore(s => s.setPicked);
  const replyInLanguage = useLocaleStore(s => s.replyInLanguage);
  const setReplyInLanguage = useLocaleStore(s => s.setReplyInLanguage);
  const phone = resolveLocale(systemLanguages());

  return (
    <AliveScreen style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Language" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => setPicked(null)}
            testID="language-system"
            accessibilityRole="radio"
            accessibilityState={{ selected: picked === null }}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Phone language</Text>
              <Text style={styles.rowSubtitle} translate="no">{phone.name}</Text>
            </View>
            {picked === null ? <Icon name="check" size={18} color={colors.primary} /> : null}
          </TouchableOpacity>
          {LOCALES.map(locale => (
            <LanguageRow
              key={locale.code}
              title={locale.name}
              subtitle={locale.english}
              selected={picked === locale.code}
              divided
              onPress={() => setPicked(locale.code)}
              testID={`language-${locale.code}`}
            />
          ))}
        </View>
        {/* Opt-in: off, the model answers in the language the person writes in. */}
        <View style={[styles.group, styles.replyGroup]}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Reply in my language</Text>
              <Text style={styles.rowSubtitle}>The AI answers in the app language unless you write in another language.</Text>
            </View>
            <AppSwitch
              testID="language-reply-toggle"
              accessibilityLabel="Reply in my language"
              value={replyInLanguage}
              onValueChange={setReplyInLanguage}
            />
          </View>
        </View>
      </ScrollView>
    </AliveScreen>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: SPACING.xl, paddingBottom: SPACING.xxl },
  group: { ...cardSurface(colors), overflow: 'hidden' as const },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  replyGroup: { marginTop: SPACING.lg },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
  rowText: { flex: 1 },
  rowTitle: { ...TYPOGRAPHY.body, color: colors.text },
  rowSubtitle: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
});
