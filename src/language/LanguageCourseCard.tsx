import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { LANGUAGES, MY_WORDS, REVIEW, languageService } from './languageService';
import { levelGuide } from './teaching';
import { useLanguage } from './store';

interface Action { icon: string; label: string; sub: string; onPress: () => void; testID: string; disabled?: boolean }

/**
 * The language course on the Learn a language project page: pick the language, then
 * lessons on the board, a story, a podcast, or practice with the words you saved.
 * The project's chats are practice conversations in the same language.
 */
export function LanguageCourseCard() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const code = useLanguage((s) => s.language);
  const xp = useLanguage((s) => s.xp);
  const streak = useLanguage((s) => s.streak.count);
  const words = useLanguage((s) => s.myWords[s.language]?.length ?? 0);
  const name = LANGUAGES.find((l) => l.code === code)?.name ?? code;
  const level = levelGuide(useLanguage((s) => s.level));
  const due = languageService.dueCount(code);
  const actions: Action[] = [
    { icon: 'map', label: 'Lessons', sub: 'Board of topics', onPress: () => navigation.navigate('Language'), testID: 'course-lessons' },
    { icon: 'book-open', label: 'Story', sub: 'Read and listen', onPress: () => navigation.navigate('Listening', { kind: 'story' }), testID: 'course-story' },
    { icon: 'headphones', label: 'Podcast', sub: 'Two people talk', onPress: () => navigation.navigate('Listening', { kind: 'podcast' }), testID: 'course-podcast' },
    { icon: 'refresh-cw', label: 'Review', sub: due ? `${due} words due` : 'Nothing due', onPress: () => navigation.navigate('Lesson', { unitId: REVIEW }), testID: 'course-review', disabled: !languageService.unlocked(REVIEW) },
    { icon: 'star', label: 'My words', sub: words ? `${words} saved` : 'Save from stories', onPress: () => navigation.navigate('Lesson', { unitId: MY_WORDS }), testID: 'course-words', disabled: !languageService.unlocked(MY_WORDS) },
  ];
  return (
    <View style={styles.card} testID="language-course">
      <View style={styles.row}>
        <Text style={styles.title}>Learning {name}</Text>
        <Text style={styles.stat}>Level {level.id} {level.name}</Text>
        <Icon name="zap" size={14} color={colors.primary} /><Text style={styles.stat}>{streak}</Text>
        <Icon name="award" size={14} color={colors.primary} /><Text style={styles.stat}>{xp} XP</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {LANGUAGES.map((l) => (
          <TouchableOpacity key={l.code} onPress={() => languageService.setLanguage(l.code)} accessibilityLabel={`Learn ${l.name}`}
            style={[styles.chip, l.code === code && styles.chipOn]}>
            <Text style={l.code === code ? styles.chipTextOn : styles.chipText}>{l.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.actions}>
        {actions.map((a) => (
          <TouchableOpacity key={a.label} onPress={a.onPress} disabled={a.disabled} testID={a.testID} style={[styles.action, a.disabled && styles.disabled]}>
            <Icon name={a.icon} size={20} color={colors.primary} />
            <Text style={styles.actionLabel}>{a.label}</Text>
            <Text style={styles.meta}>{a.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.meta}>Start a chat below to practise talking in {name}.</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  card: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.md, padding: SPACING.md, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: SPACING.sm,
  },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.xs },
  title: { ...TYPOGRAPHY.h3, flex: 1, color: colors.text },
  stat: { ...TYPOGRAPHY.meta, color: colors.text },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  chips: { gap: SPACING.sm },
  chip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  chipTextOn: { ...TYPOGRAPHY.bodySmall, color: colors.background },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.sm },
  action: {
    flexGrow: 1, flexBasis: '45%' as const, padding: SPACING.md, borderRadius: 10, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.background, gap: 2,
  },
  disabled: { opacity: 0.5 },
  actionLabel: { ...TYPOGRAPHY.body, color: colors.text },
});
