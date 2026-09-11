import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card } from '../components';
import { LoadingDots } from '../components/LoadingDots';
import { SLOTS, useSlot } from '../bootstrap/slotRegistry';
import { SPACING, TYPOGRAPHY } from '../constants';
import type { RootStackParamList } from '../navigation/types';
import { guidedSetupDownloadId } from '@offgrid/application';
import {
  createAutoSetupSession,
  type AutoSetupPlan,
  type AutoSetupSession,
} from '../services/composition/guided-setup';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';

const productionSessionFactory = (): AutoSetupSession =>
  createAutoSetupSession();

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AutoSetup'>;
  /** Tests may create the real session with native/network boundary fakes. */
  sessionFactory?: () => AutoSetupSession;
};

const labelForItem = (item: AutoSetupPlan['items'][number]) => {
  if (item.kind === 'text') return 'TEXT + VISION';
  if (item.kind === 'image') return 'IMAGE';
  return 'SPEECH INPUT';
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
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const VoiceIndicator = useSlot(SLOTS.autoSetupVoiceIndicator);

  useEffect(() => {
    session.load().catch(() => undefined);
    return () => session.dispose();
  }, [session]);

  const selected =
    snapshot.plans.find(plan => plan.tier === snapshot.selectedTier) ??
    snapshot.plans[0];
  const selectedOutcomes =
    selected?.items.map(
      item => snapshot.outcomes[guidedSetupDownloadId(item)],
    ) ?? [];
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
            Finding the best models for this device...
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
        <Text style={styles.eyebrow}>AUTO SETUP</Text>
        <Text style={styles.title}>Your private AI, ready in one step.</Text>
        <Text style={styles.secondary}>
          Choose how much capability you want. Every option is safe for this
          device.
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

        <View style={[styles.planGrid, width >= 700 && styles.planGridWide]}>
          {snapshot.plans.map(plan => (
            <Card
              key={plan.tier}
              onPress={() => {
                session.selectTier(plan.tier).catch(() => undefined);
              }}
              style={{
                ...styles.planCard,
                ...(width >= 700 ? styles.planCardWide : {}),
                ...(selected?.tier === plan.tier ? styles.selectedCard : {}),
              }}
              testID={`auto-setup-plan-${plan.tier}`}
            >
              <Text style={styles.planTitle}>{plan.title}</Text>
              <Text style={styles.secondary}>{plan.summary}</Text>
              {selected?.tier === plan.tier && (
                <View
                  style={styles.expandedPlan}
                  testID="auto-setup-selected-plan"
                >
                  <Text style={styles.includesLabel}>INCLUDES</Text>
                  <View style={styles.planItems}>
                    {plan.items.map(item => (
                      <View
                        key={`${plan.tier}:${item.kind}:${item.id}`}
                        style={styles.planItem}
                      >
                        <Text style={styles.itemKind}>
                          {labelForItem(item)}
                        </Text>
                        <Text style={styles.planItemName}>{item.name}</Text>
                        <Text style={styles.itemSize}>
                          {formatBytes(item.sizeBytes)}
                          {outcomeLabel(
                            snapshot.outcomes[guidedSetupDownloadId(item)],
                          )}
                        </Text>
                      </View>
                    ))}
                    {VoiceIndicator ? (
                      <VoiceIndicator
                        onPress={() => navigation.push('ProDetail')}
                        style={styles.planItem}
                      />
                    ) : null}
                  </View>
                  <Text style={styles.total}>
                    {formatBytes(plan.totalBytes)} download
                  </Text>
                  {(starting || selectedOutcomes.length > 0) && (
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${Math.max(2, progress * 100)}%` },
                        ]}
                      />
                    </View>
                  )}
                  {isComplete ? (
                    <Button
                      title="Continue"
                      onPress={async () => {
                        await session.complete();
                        navigation.replace('Main');
                      }}
                      testID="auto-setup-continue"
                    />
                  ) : (
                    <Button
                      title={
                        snapshot.phase === 'failed'
                          ? 'Retry Downloads'
                          : `Download ${formatBytes(plan.totalBytes)}`
                      }
                      onPress={() => {
                        session.start().catch(() => undefined);
                      }}
                      loading={starting}
                      testID="auto-setup-download"
                    />
                  )}
                </View>
              )}
            </Card>
          ))}
        </View>

        {!selected && (
          <Card style={styles.errorCard}>
            <Text style={styles.error}>
              No complete model set is safe for this device.
            </Text>
          </Card>
        )}

        <Button
          title="Configure it yourself"
          variant="ghost"
          onPress={() => navigation.push('AdvancedSetup')}
          testID="auto-setup-advanced"
        />
        <Button
          title="Skip for Now"
          variant="ghost"
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

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: SPACING.md,
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
  eyebrow: { ...TYPOGRAPHY.label, color: colors.primary },
  title: { ...TYPOGRAPHY.h2, color: colors.text },
  secondary: { ...TYPOGRAPHY.body, color: colors.textSecondary },
  planGrid: { gap: SPACING.sm },
  planGridWide: { flexDirection: 'row' as const },
  planCard: {
    borderWidth: 1,
    borderColor: colors.border,
    gap: SPACING.xs,
    padding: SPACING.md,
    borderRadius: SPACING.sm,
  },
  planCardWide: { flex: 1 },
  selectedCard: { borderColor: colors.primary },
  planTitle: { ...TYPOGRAPHY.h3, color: colors.text },
  expandedPlan: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: SPACING.xs,
    paddingTop: SPACING.sm,
    gap: SPACING.sm,
  },
  includesLabel: { ...TYPOGRAPHY.labelSmall, color: colors.textMuted },
  planItems: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: SPACING.sm,
  },
  planItem: {
    flexBasis: '45%' as const,
    flexGrow: 1,
    gap: SPACING.xs,
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: SPACING.sm,
    backgroundColor: colors.surfaceLight,
  },
  planItemName: { ...TYPOGRAPHY.body, color: colors.text },
  itemSize: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  total: { ...TYPOGRAPHY.meta, color: colors.primary },
  itemKind: { ...TYPOGRAPHY.labelSmall, color: colors.textMuted },
  progressTrack: {
    height: SPACING.xs,
    backgroundColor: colors.surfaceLight,
    overflow: 'hidden' as const,
  },
  progressFill: { height: SPACING.xs, backgroundColor: colors.primary },
  errorCard: { gap: SPACING.md, borderWidth: 1, borderColor: colors.error },
  error: { ...TYPOGRAPHY.body, color: colors.error },
});
