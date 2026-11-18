/**
 * One feature on "What it does for you": where it runs and whether it is Pro, its picture, what it
 * does, what you get, and the one way in from here. Its own route, so Back returns to the guide
 * exactly where it was.
 */
import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { guideWhereLabel } from '@offgrid/models';
import { AliveScreen } from '../../components/AliveScreen';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Button } from '../../components/Button';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { cardSurface } from '../../theme/surface';
import { FONTS, SPACING, TYPOGRAPHY } from '../../constants';
import { SCROLL_DEPTH_PROPS } from '../../constants/scrollDepth';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { mobileGuideTopics } from './guideTopics';
import { GuidePicture } from './GuidePicture';
import { useGuideAction } from './useGuideAction';

export const GuideTopicScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'GuideTopic'>>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const topic = useMemo(() => mobileGuideTopics().find(t => t.id === params.id), [params.id]);
  const actionFor = useGuideAction();
  const action = topic ? actionFor(topic) : null;

  return (
    <AliveScreen style={styles.container} edges={['top', 'bottom']} testID="guide-topic-screen">
      <ScreenHeader title={topic?.label ?? 'What it does for you'} onBack={() => navigation.goBack()} />
      {topic ? (
        <>
          <ScrollView {...SCROLL_DEPTH_PROPS} contentContainerStyle={styles.content}>
            <Text style={styles.meta}>
              {guideWhereLabel('mobile', topic.where)} · {topic.pro ? 'Pro' : 'Free'}
            </Text>
            <Text style={styles.tagline}>{topic.tagline}</Text>
            {topic.media ? (
              <GuidePicture media={topic.media} label={topic.label} height={topic.media.aspect > 1 ? 210 : 380} />
            ) : (
              <View style={styles.iconHero} accessible={false}>
                <Icon name={topic.icon} size={36} color={colors.primary} />
              </View>
            )}
            <Text style={styles.description}>{topic.description}</Text>
            <View style={styles.highlights}>
              {topic.highlights.map(line => (
                <View key={line} style={styles.highlight}>
                  <Icon name="check" size={16} color={colors.primary} />
                  <Text style={styles.highlightText}>{line}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={styles.footer}>
            {/* Ask the guide about this feature in your own words, beside the way in. */}
            <Button
              title="Ask more"
              variant="secondary"
              onPress={() => navigation.popTo('Guide', { ask: `Tell me more about ${topic.label}.`, at: Date.now() })}
              icon={<Icon name="message-circle" size={16} color={colors.textSecondary} />}
              style={styles.footerButton}
              testID="guide-topic-ask"
            />
            {action ? (
              <Button
                title={action.label}
                variant="primary"
                onPress={action.onPress}
                icon={<Icon name={action.icon} size={16} color={colors.onPrimary} />}
                style={styles.footerButton}
                testID="guide-topic-action"
              />
            ) : null}
          </View>
        </>
      ) : (
        <View style={styles.content}>
          <Text style={styles.description}>This feature is not in this version of the app.</Text>
        </View>
      )}
    </AliveScreen>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: SPACING.xl, paddingTop: SPACING.lg, paddingBottom: SPACING.xl, gap: SPACING.lg },
  meta: {
    ...TYPOGRAPHY.label,
    fontFamily: FONTS.mono,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.2,
    color: colors.textMuted,
  },
  // The topic's promise, large and light: the one big line on the page.
  tagline: { ...TYPOGRAPHY.h1, fontWeight: '300' as const, color: colors.text, marginTop: -SPACING.sm },
  iconHero: {
    ...cardSurface(colors),
    height: 140,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  description: { ...TYPOGRAPHY.body, color: colors.textSecondary, lineHeight: 21 },
  highlights: { gap: SPACING.sm },
  highlight: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: SPACING.sm },
  highlightText: { ...TYPOGRAPHY.body, color: colors.text, flex: 1 },
  footer: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  footerButton: { flex: 1 },
});
