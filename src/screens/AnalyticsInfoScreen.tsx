import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { TouchableOpacity } from '../components/Touchable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';

/** Plain-words summary of docs/ANALYTICS.md. Keep the two lists in step with that file. */
const WE_SHARE = [
  'Which screens you open and how long you stay.',
  'Model downloads and loads: which public model, its size, how fast it went, and whether it worked.',
  'How each reply went: speed, time to the first word, and whether it finished, stopped or failed.',
  'Which features you use, such as voice, images, tools or sync.',
  'Steps in setup and other journeys, so we can see where people get stuck.',
  'Crash reports, with file paths and any typed text removed.',
  'Your device type, RAM, system version, app version and language.',
];

const WE_NEVER_SHARE = [
  'Your chats, prompts, replies, transcripts or reasoning.',
  'What tools read or return.',
  'File names, document names or anything inside your files.',
  'Web addresses or server addresses.',
  'What you search for.',
  'Names of models you imported yourself.',
  'Your email, license key, account or device ID.',
];

const ListBlock: React.FC<{
  title: string;
  icon: string;
  items: string[];
  testID: string;
}> = ({ title, icon, items, testID }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.map(item => (
        <View key={item} style={styles.row}>
          <Icon name={icon} size={14} color={colors.textSecondary} style={styles.rowIcon} />
          <Text style={styles.rowText}>{item}</Text>
        </View>
      ))}
    </View>
  );
};

/** "What we share": what opt-in analytics sends, and what it never sends. */
export const AnalyticsInfoScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>What we share</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Off by default. If you turn on Anonymous stats or Crash reports, Off Grid AI sends counts of
          what was used and error reports that help us fix what breaks. We never see your prompts, replies or
          files. Turn it off any time in Settings.
        </Text>
        <ListBlock title="We share" icon="check" items={WE_SHARE} testID="analytics-we-share" />
        <ListBlock title="We never share" icon="x" items={WE_NEVER_SHARE} testID="analytics-we-never-share" />
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  backButton: { width: 36, height: 36, justifyContent: 'center' as const },
  headerTitle: { ...TYPOGRAPHY.h3, color: colors.text },
  content: { padding: SPACING.md, gap: SPACING.lg, paddingBottom: SPACING.xxl },
  intro: { ...TYPOGRAPHY.body, color: colors.textSecondary },
  section: { gap: SPACING.sm },
  sectionTitle: { ...TYPOGRAPHY.label, color: colors.primary },
  row: { flexDirection: 'row' as const, gap: SPACING.sm, alignItems: 'flex-start' as const },
  rowIcon: { marginTop: 3 },
  rowText: { ...TYPOGRAPHY.body, color: colors.text, flex: 1 },
});
