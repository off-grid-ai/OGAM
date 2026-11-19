import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable, TouchableOpacity } from '../components/Touchable';
import Icon from 'react-native-vector-icons/Feather';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card } from '../components';
import { LoadingDots } from '../components/LoadingDots';
import { AliveScreen } from '../components/AliveScreen';
import { ScreenHeader } from '../components/ScreenHeader';
import { cardSurface } from '../theme/surface';
import { SLOTS, useSlot } from '../bootstrap/slotRegistry';
import { SPACING, TYPOGRAPHY } from '../constants';
import type { RootStackParamList } from '../navigation/types';
import type { AutoSetupItem, AutoSetupTier } from '../services/autoSetupPlan';
import {
  autoSetupDownloadId,
  autoSetupItemNeedsAction,
  createAutoSetupSession,
  type AutoSetupSession,
} from '../services/autoSetupService';
import {
  flowFinished,
  flowResumed,
  proGateShown,
  setAnalyticsConsent,
} from '../services/analytics/analytics';
import { ignore } from '../services/analytics/values';
import { useAppStore } from '../stores/appStore';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { useGetPro } from '../hooks/useGetPro';
import { takeChatModelOnHand, useChatModelOnHand } from '../services/arrivingChatModel';
import { t } from '@offgrid/i18n';

const productionSessionFactory = (): AutoSetupSession =>
  createAutoSetupSession();

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AutoSetup'>;
  /** Tests may create the real session with native/network boundary fakes. */
  sessionFactory?: () => AutoSetupSession;
};

const labelForItem = (item: AutoSetupItem) => {
  if (item.kind === 'text') return 'TEXT';
  if (item.kind === 'image') return 'IMAGE';
  if (item.kind === 'video') return 'VIDEO';
  if (item.kind === 'embedding') return 'SEARCH';
  return 'SPEECH';
};

export const AutoSetupScreen: React.FC<Props> = ({
  navigation,
  sessionFactory = productionSessionFactory,
}) => {
  const session = useMemo(() => sessionFactory(), [sessionFactory]);
  // Opened from the app (Storage), not first launch: Back and Not now return there, never to Home.
  const [openedFromApp] = useState(() => navigation.canGoBack());
  const leave = () => (openedFromApp ? navigation.goBack() : navigation.replace('Main'));
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  const { colors } = useTheme();
  const getPro = useGetPro();
  const styles = useThemedStyles(createStyles);
  const VoiceIndicator = useSlot(SLOTS.autoSetupVoiceIndicator);
  // A paired Off Grid AI Desktop makes videos for a phone that cannot run a video model itself.
  const pairedComputer = useRemoteServerStore(state =>
    state.servers.find(server => server.modelManagement === 'offgrid-desktop-v1'),
  );
  const [expandedTier, setExpandedTier] = useState<AutoSetupTier | null>(
    () => session.snapshot().selectedTier,
  );
  // First launch leads with one action: chat now on Quick start. The plans are one tap away.
  const [showPlans, setShowPlans] = useState(openedFromApp);
  const [startingChat, setStartingChat] = useState(false);

  useEffect(() => {
    session.load().catch(() => undefined);
    return () => session.dispose();
  }, [session]);

  useEffect(() => {
    flowResumed('onboarding', 'setup_shown');
  }, []);

  const [shareAnalytics, setShareAnalytics] = useState(
    () => useAppStore.getState().settings.analyticsUsage,
  );
  const toggleShareAnalytics = () => {
    const next = !shareAnalytics;
    setShareAnalytics(next);
    setAnalyticsConsent({ usage: next, crashes: next }, 'setup').catch(ignore);
  };
  // Every way out of Auto Setup passed the consent row, so the person has been asked.
  const markConsentAsked = () => {
    useAppStore.getState().updateSettings({ analyticsAsked: true, analyticsLastPromptAt: Date.now() });
  };

  const selected =
    snapshot.plans.find(plan => plan.tier === snapshot.selectedTier) ??
    snapshot.plans[0];
  // Opened before the plans arrived on a tier that is not on offer: open the plan that was picked.
  useEffect(() => {
    if (expandedTier && snapshot.plans.length && !snapshot.plans.some(plan => plan.tier === expandedTier)) {
      setExpandedTier(snapshot.selectedTier);
    }
  }, [expandedTier, snapshot.plans, snapshot.selectedTier]);
  const selectedItems = [...(selected?.items ?? []), ...(selected?.embedding ? [selected.embedding] : [])].filter(item =>
    snapshot.selectedKinds.includes(item.kind) &&
    autoSetupItemNeedsAction(item, snapshot.installedIds),
  );
  const selectedBytes = selectedItems.reduce(
    (total, item) => total + (
      snapshot.installedIds.includes(autoSetupDownloadId(item)) ? 0 : item.sizeBytes
    ), 0,
  );
  const selectedOutcomes =
    selectedItems.map(item => snapshot.outcomes[autoSetupDownloadId(item)]);
  const progress =
    selectedOutcomes.length === 0
      ? 0
      : selectedOutcomes.reduce(
          (sum, outcome) => sum + (outcome?.progress ?? 0),
          0,
        ) / selectedOutcomes.length;
  const quickStart = snapshot.plans.find(plan => plan.tier === 'lean');
  const quickStartChat = quickStart?.items[0];
  // What else the person picked (pictures, voice) comes with Quick start, after the chat model.
  const quickStartExtraBytes = [...(quickStart?.items ?? []), ...(quickStart?.embedding ? [quickStart.embedding] : [])]
    .filter(item => item.kind !== 'text' && snapshot.selectedKinds.includes(item.kind)
      && autoSetupItemNeedsAction(item, snapshot.installedIds)
      && !snapshot.installedIds.includes(autoSetupDownloadId(item)))
    .reduce((total, item) => total + item.sizeBytes, 0);
  // Start chatting uses a chat model already on hand rather than download Quick start's, so the line
  // names the model the person gets.
  const onHand = useChatModelOnHand();
  const heroLine = onHand?.name
    ? onHand.arriving
      ? t('{0} is on its way to this phone. Ask now. It answers as soon as it arrives.', onHand.name)
      : t('{0} is ready on this phone. Ask now.', onHand.name)
    : [
        quickStartChat && `${quickStartChat.name} · ${formatBytes(quickStartChat.sizeBytes)}.`,
        t('Ask now. It answers as soon as it is on your phone.'),
      ].filter(Boolean).join(' ');
  // Start a plan's downloads, then open a chat at once: the model answers when it arrives. Start
  // chatting takes Quick start; on first launch a download from the plans takes the plan picked.
  const startChatting = async (tier?: AutoSetupTier) => {
    markConsentAsked();
    // A chat model already on hand (on the phone, or on its way: a bundled model pack, a download
    // started earlier) is the chat model: open the chat for it rather than download a second one.
    // A plan picked by name is downloaded as asked.
    if (!tier && takeChatModelOnHand()) {
      navigation.reset({ index: 1, routes: [{ name: 'Main' }, { name: 'Chat', params: {} }] });
      return;
    }
    setStartingChat(true);
    try {
      await session.startInBackground(tier);
    } finally {
      setStartingChat(false);
    }
    const phase = session.snapshot().phase;
    if (phase === 'failed') return;
    if (phase === 'completed') session.complete();
    navigation.reset({ index: 1, routes: [{ name: 'Main' }, { name: 'Chat', params: {} }] });
  };
  const isComplete = snapshot.phase === 'completed';
  const starting = snapshot.phase === 'downloading';

  if (snapshot.phase === 'loading_catalog')
    return (
      <AliveScreen style={styles.container}>
        {openedFromApp && <ScreenHeader title="Choose models" onBack={navigation.goBack} />}
        <View style={styles.center}>
          <LoadingDots color={colors.primary} />
          <Text style={styles.secondary}>
            Finding model choices...
          </Text>
        </View>
      </AliveScreen>
    );

  return (
    <AliveScreen style={styles.container}>
      {openedFromApp && <ScreenHeader title="Choose models" onBack={navigation.goBack} />}
      <ScrollView
        contentContainerStyle={styles.content}
        testID="auto-setup-screen"
      >
        {showPlans ? (
          <>
            {/* First launch: the plans are one tap from Start chatting, and one tap back to it. */}
            {!openedFromApp && (
              <Button
                title="Back to Start chatting"
                variant="ghost"
                size="small"
                style={styles.backToQuickStart}
                onPress={() => setShowPlans(false)}
                disabled={starting || startingChat}
                testID="auto-setup-back-to-quick-start"
              />
            )}
            <Text style={styles.title}>Choose model downloads.</Text>
            <Text style={styles.secondary}>
              Installed models add no download size.
            </Text>
          </>
        ) : (
          <View style={styles.hero} testID="auto-setup-quick-start">
            <Text style={styles.title}>Chat with your own AI.</Text>
            <Text style={styles.secondary}>
              {heroLine}
            </Text>
            {quickStartExtraBytes > 0 && (
              <Text style={styles.secondary} testID="auto-setup-extras">
                {`Your other picks (${formatBytes(quickStartExtraBytes)}) download in the background.`}
              </Text>
            )}
            <Text style={styles.secondary}>It runs on this phone. Your chats never leave it.</Text>
            <Button
              title="Start chatting"
              variant="hero"
              onPress={() => { startChatting().catch(() => undefined); }}
              loading={startingChat}
              disabled={!quickStartChat || startingChat}
              testID="auto-setup-start-chatting"
            />
            <Button
              title="Choose another"
              variant="ghost"
              style={styles.textAction}
              onPress={() => setShowPlans(true)}
              disabled={startingChat}
              testID="auto-setup-choose-another"
            />
          </View>
        )}

        {snapshot.error && (
          <Card style={styles.errorCard}>
            <Text style={styles.error}>{snapshot.error}</Text>
            <Button
              title="Try Again"
              onPress={() => {
                if (snapshot.plans.length && !showPlans)
                  startChatting().catch(() => undefined);
                else if (snapshot.plans.length)
                  session.start().catch(() => undefined);
                else session.load().catch(() => undefined);
              }}
              variant="outline"
              testID="auto-setup-retry"
            />
          </Card>
        )}

        <View style={styles.consentRow}>
          <Pressable
            style={styles.consentToggle}
            onPress={toggleShareAnalytics}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: shareAnalytics }}
            accessibilityLabel="Share anonymous stats and crash reports"
            testID="auto-setup-share-analytics"
          >
            <Icon
              name={shareAnalytics ? 'check-square' : 'square'}
              size={20}
              color={shareAnalytics ? colors.text : colors.textSecondary}
            />
            <View style={styles.consentText}>
              <Text style={styles.consentLabel}>
                Share anonymous stats and crash reports
              </Text>
              <Text style={styles.consentHint}>
                Helps us fix what breaks on your device. Your chats never leave it.
              </Text>
            </View>
          </Pressable>
          <Text
            style={styles.consentLink}
            onPress={() => navigation.push('AnalyticsInfo')}
            accessibilityRole="link"
            testID="auto-setup-what-we-share"
          >
            What we share
          </Text>
        </View>

        {showPlans && <View style={styles.planGrid}>
          {snapshot.plans.map(plan => (
            <Card
              key={plan.tier}
              style={{
                ...styles.planCard,
                ...(selected?.tier === plan.tier ? styles.selectedCard : {}),
              }}
              testID={`auto-setup-plan-${plan.tier}`}
            >
              <TouchableOpacity
                style={styles.planHeader}
                onPress={() => {
                  if (expandedTier === plan.tier) {
                    setExpandedTier(null);
                    return;
                  }
                  if (selected?.tier !== plan.tier) session.selectTier(plan.tier);
                  setExpandedTier(plan.tier);
                }}
                disabled={starting}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${plan.title} plan`}
                accessibilityState={{ expanded: expandedTier === plan.tier, disabled: starting }}
                testID={`auto-setup-plan-heading-${plan.tier}`}
              >
                <View style={styles.planHeading}>
                  <Text style={styles.planTitle}>{plan.title}</Text>
                  <Icon
                    name={expandedTier === plan.tier ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textMuted}
                  />
                </View>
                <Text style={styles.secondary}>{plan.summary}</Text>
              </TouchableOpacity>
              {expandedTier === plan.tier && (
                <View
                  style={styles.expandedPlan}
                  testID="auto-setup-selected-plan"
                >
                  <View style={styles.planItems}>
                    {[...plan.items, ...(plan.embedding ? [plan.embedding] : [])].map(item => {
                      const checked = snapshot.selectedKinds.includes(item.kind);
                      const installed = snapshot.installedIds.includes(autoSetupDownloadId(item));
                      const needsAction = autoSetupItemNeedsAction(item, snapshot.installedIds);
                      const size = item.kind === 'embedding' && item.sizeBytes === 0
                        ? 'Included' : formatBytes(item.sizeBytes);
                      return (
                        <View
                          key={`${plan.tier}:${item.kind}:${item.id}`}
                          style={styles.planItem}
                        >
                          {needsAction ? (
                            <Button
                              title=""
                              icon={<Icon name={checked ? 'check-square' : 'square'} size={20} color={checked ? colors.text : colors.textSecondary} />}
                              variant="ghost"
                              size="small"
                              active={checked}
                              style={styles.choiceControl}
                              onPress={() => session.toggleKind(item.kind)}
                              disabled={starting}
                              accessibilityRole="checkbox"
                              accessibilityLabel={`Include ${item.name}, ${size}${installed ? ', already downloaded' : ''}`}
                              accessibilityState={{ checked, disabled: starting }}
                              testID={`auto-setup-choice-${item.kind}`}
                            />
                          ) : (
                            <View
                              style={styles.choiceControl}
                              accessible
                              accessibilityLabel={`${item.name}, included`}
                              testID={`auto-setup-included-${item.kind}`}
                            >
                              <Icon name="package" size={20} color={colors.textMuted} />
                            </View>
                          )}
                          <Text style={styles.planItemName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.itemKind}>{labelForItem(item)}</Text>
                          <Text style={styles.itemSize}>
                            {needsAction
                              ? `${size}${installed ? '' : outcomeLabel(snapshot.outcomes[autoSetupDownloadId(item)])}`
                              : item.sizeBytes === 0 ? 'Included' : `${size} · Included`}
                          </Text>
                        </View>
                      );
                    })}
                    {!plan.items.some(item => item.kind === 'video') && (
                      <View style={styles.unavailableItem} testID="auto-setup-video-row">
                        <Text style={styles.itemKind}>VIDEO</Text>
                        <Text style={styles.itemSize}>
                          {plan.videoOnComputer && pairedComputer
                            ? `Videos are made on ${pairedComputer.name}.`
                            : plan.videoExclusionReason ?? 'No video model is included in this Auto Setup plan.'}
                        </Text>
                        {plan.videoOnComputer && !pairedComputer && (
                          <Button
                            title="Find my computer"
                            variant="outline"
                            size="small"
                            onPress={() => navigation.push('RemoteServers')}
                            testID="auto-setup-find-computer"
                          />
                        )}
                      </View>
                    )}
                  </View>
                  <Text style={styles.total}>
                    {formatBytes(selectedBytes)} selected download
                  </Text>
                  {starting && (
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${progress * 100}%` },
                        ]}
                      />
                    </View>
                  )}
                  {isComplete ? (
                    <Button
                      variant="hero"
                      title="Continue"
                      onPress={() => {
                        session.complete();
                        leave();
                      }}
                      testID="auto-setup-continue"
                    />
                  ) : (
                    <Button
                      title={
                        snapshot.phase === 'failed'
                          ? 'Retry Downloads'
                          : selectedBytes === 0 ? 'Use selected models'
                          : `Download ${formatBytes(selectedBytes)}`
                      }
                      onPress={() => {
                        markConsentAsked();
                        // First launch: the chat opens now, as with Start chatting, and the plan's
                        // models finish in the background. From the app, the plan downloads here.
                        if (!openedFromApp && snapshot.phase !== 'failed' && selectedBytes > 0 && snapshot.selectedTier) {
                          startChatting(snapshot.selectedTier).catch(() => undefined);
                          return;
                        }
                        session.start().catch(() => undefined);
                      }}
                      loading={starting || startingChat}
                      disabled={selectedItems.length === 0}
                      variant="hero"
                      testID="auto-setup-download"
                    />
                  )}
                  {starting && (
                    <Button
                      title="Stop Downloads"
                      variant="outline"
                      onPress={() => { session.cancel().catch(() => undefined); }}
                      testID="auto-setup-cancel"
                    />
                  )}
                </View>
              )}
            </Card>
          ))}
        </View>}

        {VoiceIndicator ? (
          <VoiceIndicator
            onPress={() => {
              proGateShown('voice');
              getPro('auto-setup-voice');
            }}
            style={styles.voiceItem}
          />
        ) : null}

        {!selected && (
          <Card style={styles.errorCard}>
            <Text style={styles.error}>
              Auto Setup could not find the models it needs to show a plan.
            </Text>
          </Card>
        )}

        <Button
          title="Configure it yourself"
          variant="ghost"
          style={styles.textAction}
          onPress={() => {
            markConsentAsked();
            navigation.push('AdvancedSetup');
          }}
          testID="auto-setup-advanced"
        />
        <Button
          title={openedFromApp ? 'Not now' : 'Skip for Now'}
          variant="ghost"
          style={styles.textAction}
          onPress={() => {
            markConsentAsked();
            if (!openedFromApp) flowFinished('onboarding', 'cancelled');
            leave();
          }}
          testID="auto-setup-skip"
        />
      </ScrollView>
    </AliveScreen>
  );
};

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function outcomeLabel(
  outcome:
    | ReturnType<AutoSetupSession['snapshot']>['outcomes'][string]
    | undefined,
): string {
  if (!outcome) return '';
  if (outcome.phase === 'completed') return ' - READY';
  if (outcome.phase === 'failed') return ' - FAILED';
  if (outcome.phase === 'cancelled') return ' - CANCELLED';
  if (outcome.phase === 'starting') return ' - STARTING';
  if (outcome.phase === 'downloading')
    return ` - ${Math.round(outcome.progress * 100)}%`;
  return '';
}

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },
  center: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.md,
    padding: SPACING.xl,
  },
  title: { ...TYPOGRAPHY.h2, color: colors.text, textAlign: 'left' as const },
  hero: { gap: SPACING.md },
  backToQuickStart: { alignSelf: 'flex-start' as const, paddingHorizontal: 0 },
  secondary: { ...TYPOGRAPHY.body, color: colors.textSecondary, textAlign: 'left' as const },
  planGrid: { gap: SPACING.sm },
  planCard: {
    ...cardSurface(colors),
    gap: SPACING.xs,
    padding: SPACING.sm,
  },
  // The chosen plan: desktop's chosen state, a faint emerald fill under an emerald hairline.
  selectedCard: { backgroundColor: colors.selectedFill, borderColor: colors.heroBorder },
  planHeader: {
    gap: SPACING.xs,
    minHeight: 44,
    justifyContent: 'center' as const,
  },
  planHeading: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  planTitle: { ...TYPOGRAPHY.h3, color: colors.text, textAlign: 'left' as const },
  expandedPlan: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
    marginTop: SPACING.xs,
    paddingTop: SPACING.xs,
    gap: SPACING.xs,
  },
  planItems: { gap: 0 },
  planItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  unavailableItem: {
    padding: SPACING.sm,
    gap: SPACING.xs,
  },
  voiceItem: {
    padding: SPACING.sm,
    gap: SPACING.xs,
    borderRadius: SPACING.sm,
    backgroundColor: colors.surface,
    ...shadows.small,
  },
  textAction: {
    minHeight: 44,
    alignSelf: 'stretch' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 0,
    paddingVertical: SPACING.xs,
  },
  choiceControl: {
    width: 44,
    height: 44,
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  planItemName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    flex: 1,
    minWidth: 0,
    textAlign: 'left' as const,
  },
  itemSize: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    flexShrink: 0,
  },
  total: { ...TYPOGRAPHY.meta, color: colors.textSecondary, textAlign: 'left' as const },
  itemKind: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    textAlign: 'right' as const,
    flexShrink: 0,
  },
  progressTrack: {
    height: SPACING.xs,
    backgroundColor: colors.surfaceLight,
    overflow: 'hidden' as const,
  },
  progressFill: { height: SPACING.xs, backgroundColor: colors.primary },
  errorCard: { gap: SPACING.md },
  consentRow: { gap: SPACING.xs },
  consentToggle: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: SPACING.sm,
  },
  consentText: { flex: 1, gap: SPACING.xs },
  consentLabel: { ...TYPOGRAPHY.body, color: colors.text },
  consentHint: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  consentLink: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
    marginLeft: 20 + SPACING.sm,
  },
  error: { ...TYPOGRAPHY.body, color: colors.error },
});
