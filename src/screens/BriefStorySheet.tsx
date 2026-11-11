import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { AppSheet } from '../components/AppSheet';
import { AVOID_SUGGESTIONS, storyKinds } from '../atlasTools/newsSources';
import { BRIEF_PROJECT, useBriefPrefs } from '../atlasTools/dailyBrief';
import { useStudyStore, type StudyResult } from '../study/engine';

type Story = NonNullable<StudyResult['headlines']>[number];

function Row({ icon, label, onPress, testID }: { icon: string; label: string; onPress: () => void; testID: string }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} testID={testID} accessibilityRole="button" style={styles.row}>
      <Icon name={icon} size={20} color={colors.textSecondary} />
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * "Not for me" on a story of a finished briefing. Offers what actually stops more of them: avoid the kind of story it is
 * (Sports, Politics...), or stop following the interest it came from; or just hide it from this list. The kind it looks
 * like is listed first; the others stay on offer because a headline like "Bears beat Packers" names no sport.
 * Returns what the screen needs: `open(index)` for a headline's button, and the sheet to render.
 */
export function useStoryReview(today: StudyResult | undefined): { open: (index: number) => void; element: React.ReactElement } {
  const { colors } = useTheme();
  const prefs = useBriefPrefs();
  const [index, setIndex] = useState<number | null>(null);
  const story: Story | undefined = index === null ? undefined : today?.headlines?.[index];
  const close = () => setIndex(null);
  const hide = () => {
    if (today?.headlines && index !== null) useStudyStore.getState().update(BRIEF_PROJECT, today.createdAt, { headlines: today.headlines.filter((_, j) => j !== index) });
    close();
  };
  const likely = story ? storyKinds({ title: story.title, desc: story.source ?? '' }) : [];
  const kinds = AVOID_SUGGESTIONS.filter((k) => !prefs.avoid.some((a) => a.toLowerCase() === k.toLowerCase()))
    .sort((a, b) => Number(likely.includes(b)) - Number(likely.includes(a)));
  const element = (
    <AppSheet visible={!!story} title="Leave this out?" enableDynamicSizing onClose={close}>
      {story && (
        <View style={styles.body}>
          <Text numberOfLines={2} style={[styles.story, { color: colors.textMuted }]}>{story.title}</Text>
          {kinds.map((k) => (
            <Row key={k} icon="slash" label={`Avoid ${k} stories`} testID={`brief-story-avoid-${k.toLowerCase().replace(/\s+/g, '-')}`}
              onPress={() => { prefs.set({ avoid: [...prefs.avoid, k].slice(0, 20) }); hide(); }} />
          ))}
          {!!story.interest && (
            <Row icon="minus-circle" label={`Stop following "${story.interest}"`} testID="brief-story-unfollow"
              onPress={() => { prefs.setInterests(prefs.interests.filter((x) => x.toLowerCase() !== story.interest!.toLowerCase())); hide(); }} />
          )}
          <Row icon="eye-off" label="Just hide this story" onPress={hide} testID="brief-story-hide" />
        </View>
      )}
    </AppSheet>
  );
  return { open: setIndex, element };
}

const styles = StyleSheet.create({
  body: { paddingBottom: 12 },
  story: { paddingHorizontal: 20, paddingBottom: 7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 20 },
  label: { fontSize: 16, flexShrink: 1 },
});
