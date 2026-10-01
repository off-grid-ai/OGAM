import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card } from '../components';
import { LoadingDots } from '../components/LoadingDots';
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
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';

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
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const VoiceIndicator = useSlot(SLOTS.autoSetupVoiceIndicator);
  const [expandedTier, setExpandedTier] = useState<AutoSetupTier | null>(
    () => session.snapshot().selectedTier,
  );

  useEffect(() => {
    session.load().catch(() => undefined);
    return () => session.dispose();
  }, [session]);

  const selected =
    snapshot.plans.find(plan => plan.tier === snapshot.selectedTier) ??
    snapshot.plans[0];
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
  const isComplete = snapshot.phase === 'completed';
  const starting = snapshot.phase === 'downloading';

  if (snapshot.phase === 'loading_catalog')
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <LoadingDots color={colors.primary} />
          <Text style={styles.secondary}>
            Finding model choices...
          </Text>
        </View>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        testID="auto-setup-screen"
      >
        <Text style={styles.title}>Choose model downloads.</Text>
        <Text style={styles.secondary}>
          Installed models add no download size.
        </Text>

        {snapshot.error && (
          <Card style={styles.errorCard}>
            <Text style={styles.error}>{snapshot.error}</Text>
            <Button
              title="Try Again"
              onPress={() => {
                if (snapshot.plans.length)
                  session.start().catch(() => undefined);
                else session.load().catch(() => undefined);
              }}
              variant="outline"
              testID="auto-setup-retry"
            />
          </Card>
        )}

        <View style={styles.planGrid}>
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
                              icon={<Icon name={checked ? 'check-square' : 'square'} size={20} color={checked ? colors.primary : colors.textSecondary} />}
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
                    {!plan.items[3] && (
                      <View style={styles.unavailableItem}>
                        <Text style={styles.itemKind}>VIDEO</Text>
                        <Text style={styles.itemSize}>
                          {plan.videoExclusionReason ?? 'No video model is included in this Auto Setup plan.'}
                        </Text>
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
                      title="Continue"
                      onPress={() => {
                        session.complete();
                        navigation.replace('Main');
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
                        session.start().catch(() => undefined);
                      }}
                      loading={starting}
                      disabled={selectedItems.length === 0}
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
        </View>

        {VoiceIndicator ? (
          <VoiceIndicator
            onPress={() => navigation.push('ProDetail')}
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
          onPress={() => navigation.push('AdvancedSetup')}
          testID="auto-setup-advanced"
        />
        <Button
          title="Skip for Now"
          variant="ghost"
          style={styles.textAction}
          onPress={() => navigation.replace('Main')}
          testID="auto-setup-skip"
        />
      </ScrollView>
    </SafeAreaView>
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
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xxl,
    gap: SPACING.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.md,
    padding: SPACING.xl,
  },
  title: { ...TYPOGRAPHY.h2, color: colors.text, textAlign: 'left' as const },
  secondary: { ...TYPOGRAPHY.body, color: colors.textSecondary, textAlign: 'left' as const },
  planGrid: { gap: SPACING.xs },
  planCard: {
    borderWidth: 1,
    borderColor: colors.border,
    gap: SPACING.xs,
    padding: SPACING.sm,
    borderRadius: SPACING.sm,
  },
  selectedCard: { borderColor: colors.primary },
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
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  total: { ...TYPOGRAPHY.meta, color: colors.primary, textAlign: 'left' as const },
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
  errorCard: { gap: SPACING.md, borderWidth: 1, borderColor: colors.error },
  error: { ...TYPOGRAPHY.body, color: colors.error },
});
