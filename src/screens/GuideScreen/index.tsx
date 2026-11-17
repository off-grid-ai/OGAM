/**
 * "What it does for you", opened from the info button on Home. Two tabs:
 *
 * - Ask: ask anything about Off Grid AI, answered by the chat model on this phone from the same
 *   facts the page shows; answers carry pictures of what they name. Before anything is asked,
 *   starter questions and a first look.
 * - Features: everything, grouped, one tap from its own page.
 *
 * The words come from @offgrid/models, so this page and the desktop's guide never disagree.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
// The same keyboard view as Chat: edge-to-edge-aware on Android, real keyboard frame on iPhone.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  GUIDE_FIRST_LOOK,
  GUIDE_STARTERS,
  guideAnswerParts,
  guideAnswerBlocks,
  guideFlowAnswer,
  guideGrounding,
  guideStarterAnswer,
  guideTurnsToSend,
} from '@offgrid/models';
import { AliveScreen } from '../../components/AliveScreen';
import { ScreenHeader } from '../../components/ScreenHeader';
import { UnderlineTabs } from '../../components/UnderlineTabs';
import { SectionLabel } from '../../components/SectionLabel';
import { Button } from '../../components/Button';
import { LoadingDots } from '../../components/LoadingDots';
import { MarkdownText } from '../../components/MarkdownText';
import { TouchableOpacity } from '../../components/Touchable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { cardSurface } from '../../theme/surface';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { SCROLL_DEPTH_PROPS } from '../../constants/scrollDepth';
import { useAppStore } from '../../stores';
import { selectHasProAccess } from '../../stores/proAccessSlice';
import type { RootStackParamList } from '../../navigation/types';
import { askGuide, type GuideTurn } from '../../services/guideAsk';
import { GUIDE_GROUPS, firstLookTopics, mobileGuideTopics, type MobileGuideTopic } from './guideTopics';
import { GuidePicture } from './GuidePicture';

/** The flows this phone has: an iPhone is not offered Android's steps. */
const PLATFORM = Platform.OS === 'android' ? 'android' : 'ios';

type Tab = 'ask' | 'features';
type Nav = NativeStackNavigationProp<RootStackParamList>;

const TABS = [
  { key: 'ask' as const, label: 'Ask', testID: 'guide-tab-ask' },
  { key: 'features' as const, label: 'Features', testID: 'guide-tab-features' },
];

export const GuideScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const styles = useThemedStyles(createStyles);
  const [tab, setTab] = useState<Tab>('ask');
  const topics = useMemo(() => mobileGuideTopics(), []);
  const show = (id: string) => navigation.navigate('GuideTopic', { id });

  return (
    <AliveScreen style={styles.container} edges={['top', 'bottom']} testID="guide-screen">
      {/* The keyboard view wraps the whole screen, as in Chat: it measures from its parent, so deeper
          down it lifts the Ask box by less than the keyboard and leaves it covered on iPhone. */}
      <KeyboardAvoidingView style={styles.pane} behavior="padding" keyboardVerticalOffset={0}>
        <ScreenHeader title="What it does for you" onBack={() => navigation.goBack()} />
        <UnderlineTabs tabs={TABS} active={tab} onChange={setTab} />
        {/* Both stay mounted, so a conversation is still there after a look at the features. */}
        <View style={[styles.pane, tab !== 'ask' && styles.hidden]}>
          <AskPane topics={topics} onShow={show} />
        </View>
        <View style={[styles.pane, tab !== 'features' && styles.hidden]}>
          <FeaturesPane topics={topics} onShow={show} />
        </View>
      </KeyboardAvoidingView>
    </AliveScreen>
  );
};

const AskPane: React.FC<{ topics: MobileGuideTopic[]; onShow: (id: string) => void }> = ({ topics, onShow }) => {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [turns, setTurns] = useState<GuideTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  // Why the last question has no answer, so the next step sits right under it.
  const [missed, setMissed] = useState<{ why: 'no-model' | 'busy' | 'failed'; question: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const firstLook = firstLookTopics(topics, GUIDE_FIRST_LOOK.mobile);
  const toEnd = () => requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

  /** Ask a question; a retry resends the last one, already on screen, without a second copy. */
  const ask = async (question: string, retry = false) => {
    const text = question.trim();
    if (!text || waiting) return;
    const history: GuideTurn[] = retry ? turns : [...turns, { role: 'user', content: text }];
    if (!retry) setDraft('');
    // A starter's or a "how do I…" answer is built from the guide itself: the app's own labels in
    // order, instant, and there with no model.
    const starter = retry
      ? null
      : guideStarterAnswer('mobile', text, topics) ?? guideFlowAnswer('mobile', text, topics, { platform: PLATFORM });
    if (starter) {
      setTurns([...history, { role: 'assistant', content: starter }]);
      toEnd();
      return;
    }
    setTurns(history);
    setWaiting(true);
    setMissed(null);
    toEnd();
    // Only the topics this conversation is about: a small model answers better reading less.
    const result = await askGuide(guideGrounding('mobile', topics, history, { platform: PLATFORM }), guideTurnsToSend(history));
    setWaiting(false);
    if ('answer' in result) setTurns([...history, { role: 'assistant', content: result.answer }]);
    else setMissed({ why: result.error, question: text });
    toEnd();
  };

  const canSend = draft.trim().length > 0 && !waiting;

  return (
    <View style={styles.pane}>
      <ScrollView
        {...SCROLL_DEPTH_PROPS}
        ref={scrollRef}
        style={styles.pane}
        contentContainerStyle={styles.askContent}
        keyboardShouldPersistTaps="handled"
      >
        {turns.length === 0 ? (
          <View style={styles.intro}>
            <Text style={styles.introTitle}>Ask about Off Grid AI</Text>
            <Text style={styles.introBody}>
              What it can do on this phone, your computer or your browser. Answered by the chat model on this phone.
            </Text>
            <View style={styles.starters}>
              {GUIDE_STARTERS.mobile.map(s => (
                <TouchableOpacity
                  key={s}
                  style={styles.starter}
                  onPress={() => { ask(s).catch(() => undefined); }}
                  accessibilityRole="button"
                  testID={`guide-starter-${s}`}
                >
                  <Text style={styles.starterText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {firstLook.length > 0 ? (
              <>
                <SectionLabel title="A first look" style={styles.firstLookLabel} />
                <View style={styles.grid}>
                  {firstLook.map(t => (
                    <TouchableOpacity
                      key={t.id}
                      style={styles.gridItem}
                      onPress={() => onShow(t.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Show ${t.label}`}
                      testID={`guide-first-look-${t.id}`}
                    >
                      <GuidePicture media={t.media!} label={t.label} height={150} />
                      <Text style={styles.gridLabel} numberOfLines={1}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <View key={i} style={styles.userBubble}>
              <Text style={styles.userText}>{turn.content}</Text>
            </View>
          ) : (
            <View key={i} style={styles.answer} testID="guide-answer">
              {guideAnswerBlocks(guideAnswerParts(turn.content, topics)).map((block, j) =>
                block.kind === 'text' ? (
                  <MarkdownText key={j}>{block.text}</MarkdownText>
                ) : block.topics.length === 1 ? (
                  <AnswerCard key={j} topic={block.topics[0]} onShow={onShow} />
                ) : (
                  <View key={j} style={styles.tileGrid}>
                    {block.topics.map(t => (
                      <AnswerTile key={t.id} topic={t} onShow={onShow} />
                    ))}
                  </View>
                ),
              )}
            </View>
          ),
        )}

        {waiting ? (
          <View style={styles.status} accessibilityRole="progressbar" accessibilityLabel="Thinking">
            <LoadingDots size={6} />
            <Text style={styles.statusText}>Thinking…</Text>
          </View>
        ) : null}
        {missed ? (
          <View style={styles.missed} accessibilityLiveRegion="polite" testID="guide-missed">
            <Text style={styles.statusText}>
              {missed.why === 'no-model'
                ? 'No chat model on this phone yet. Download one, then ask again.'
                : missed.why === 'busy'
                  ? 'The model is still answering a chat. Try again when it is done.'
                  : 'No answer came back.'}
            </Text>
            {missed.why === 'no-model' ? (
              <Button
                title="Open Models"
                variant="outline"
                size="small"
                onPress={() => navigation.navigate('Main', { screen: 'ModelsTab' } as never)}
                style={styles.missedButton}
              />
            ) : (
              <Button
                title="Try again"
                variant="outline"
                size="small"
                onPress={() => { ask(missed.question, true).catch(() => undefined); }}
                style={styles.missedButton}
                testID="guide-retry"
              />
            )}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask anything about Off Grid AI"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          returnKeyType="send"
          onSubmitEditing={() => { ask(draft).catch(() => undefined); }}
          accessibilityLabel="Your question"
          testID="guide-input"
        />
        <TouchableOpacity
          style={[styles.send, !canSend && styles.sendDisabled]}
          onPress={() => { ask(draft).catch(() => undefined); }}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Ask"
          accessibilityState={{ disabled: !canSend }}
          testID="guide-send"
        >
          <Icon name="arrow-up" size={18} color={canSend ? colors.onPrimary : colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

/** One topic among several: name and line, no picture, so a row of them lines up. */
const AnswerTile: React.FC<{ topic: MobileGuideTopic; onShow: (id: string) => void }> = ({ topic, onShow }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <TouchableOpacity
      style={styles.tile}
      onPress={() => onShow(topic.id)}
      accessibilityRole="button"
      accessibilityLabel={`Show ${topic.label}`}
      testID={`guide-answer-topic-${topic.id}`}
    >
      <Icon name={topic.icon} size={16} color={colors.primary} />
      <Text style={styles.rowTitle} numberOfLines={2}>{topic.label}</Text>
      <Text style={styles.rowLine} numberOfLines={2}>{topic.tagline}</Text>
    </TouchableOpacity>
  );
};

const AnswerCard: React.FC<{ topic: MobileGuideTopic; onShow: (id: string) => void }> = ({ topic, onShow }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <TouchableOpacity
      style={styles.answerCard}
      onPress={() => onShow(topic.id)}
      accessibilityRole="button"
      accessibilityLabel={`Show ${topic.label}`}
      testID={`guide-answer-topic-${topic.id}`}
    >
      {topic.media ? <GuidePicture media={topic.media} label={topic.label} height={180} /> : null}
      <View style={styles.answerCardRow}>
        <Icon name={topic.icon} size={16} color={colors.textSecondary} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>{topic.label}</Text>
          <Text style={styles.rowLine} numberOfLines={1}>{topic.tagline}</Text>
        </View>
        <Icon name="chevron-right" size={16} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
};

const FeaturesPane: React.FC<{ topics: MobileGuideTopic[]; onShow: (id: string) => void }> = ({ topics, onShow }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasPro = useAppStore(selectHasProAccess);
  return (
    <ScrollView {...SCROLL_DEPTH_PROPS} style={styles.pane} contentContainerStyle={styles.featuresContent}>
      <Text style={styles.introBody}>
        Everything runs on your own phone and computer. Pick one to see what it does.
      </Text>
      {GUIDE_GROUPS.map(group => {
        const inGroup = topics.filter(t => t.group === group.id);
        if (inGroup.length === 0) return null;
        return (
          <View key={group.id}>
            <SectionLabel title={group.title} style={styles.groupLabel} />
            <View style={styles.card}>
              {inGroup.map((t, i) => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.row, i === inGroup.length - 1 && styles.lastRow]}
                  onPress={() => onShow(t.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t.label}
                  testID={`guide-topic-${t.id}`}
                >
                  <Icon name={t.icon} size={18} color={colors.textSecondary} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{t.label}</Text>
                    <Text style={styles.rowLine} numberOfLines={1}>{t.tagline}</Text>
                  </View>
                  {t.pro && !hasPro ? (
                    <Icon name="lock" size={12} color={colors.textMuted} accessibilityLabel="Pro" />
                  ) : null}
                  <Icon name="chevron-right" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  pane: { flex: 1 },
  hidden: { display: 'none' as const },
  askContent: { paddingHorizontal: SPACING.xl, paddingVertical: SPACING.lg, gap: SPACING.lg },
  intro: { gap: SPACING.md },
  introTitle: { ...TYPOGRAPHY.h2, color: colors.text },
  introBody: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  starters: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.sm },
  starter: {
    ...cardSurface(colors),
    borderRadius: 999,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: 36,
    justifyContent: 'center' as const,
  },
  starterText: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  firstLookLabel: { marginTop: SPACING.sm, marginBottom: 0 },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.md },
  gridItem: { width: '47%' as const, gap: SPACING.xs },
  gridLabel: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  userBubble: {
    alignSelf: 'flex-end' as const,
    maxWidth: '82%' as const,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  userText: { ...TYPOGRAPHY.body, color: colors.onPrimary },
  answer: { gap: SPACING.md },
  answerCard: { ...cardSurface(colors), padding: SPACING.sm, gap: SPACING.sm },
  tileGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.sm },
  tile: { ...cardSurface(colors), width: '48.5%' as const, padding: SPACING.md, gap: SPACING.xs },
  answerCardRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm, paddingHorizontal: SPACING.xs },
  status: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  statusText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  missed: { gap: SPACING.sm, alignItems: 'flex-start' as const },
  missedButton: { alignSelf: 'flex-start' as const },
  composer: {
    ...cardSurface(colors),
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xs,
    paddingVertical: SPACING.xs,
  },
  input: { ...TYPOGRAPHY.body, flex: 1, color: colors.text, paddingVertical: SPACING.sm },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  sendDisabled: { backgroundColor: colors.surfaceLight },
  featuresContent: { paddingHorizontal: SPACING.xl, paddingTop: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.xs },
  groupLabel: { marginTop: SPACING.lg, marginLeft: SPACING.xs },
  card: { ...cardSurface(colors), paddingHorizontal: SPACING.md },
  row: {
    minHeight: 56,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lastRow: { borderBottomWidth: 0 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...TYPOGRAPHY.body, color: colors.text },
  rowLine: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
});
