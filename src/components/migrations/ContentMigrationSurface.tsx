import React, { useCallback, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SystemBars } from 'react-native-edge-to-edge';
import { Button } from '../Button';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import {
  contentMigrationStatus,
  retryContentPersistenceMigration,
  type ContentMigrationStatus,
} from '../../services/migrations/contentMigrationCoordinator';
import type { ContentMigrationState } from '../../services/migrations/contentMigrationStateMachine';

interface MigrationPresentation {
  label: string;
  detail: string;
  progress: number;
}

function migrationPresentation(migration: ContentMigrationState): MigrationPresentation {
  switch (migration.state) {
    case 'idle':
      return {
        label: migration.resumeRequired ? 'Resuming workspace update' : 'Workspace update needed',
        detail: 'Preparing to copy your projects and conversations.',
        progress: 0,
      };
    case 'preparing':
      return {
        label: 'Reading your current workspace',
        detail: 'Off Grid AI is preparing a local copy.',
        progress: migration.progress,
      };
    case 'copying':
      return {
        label: `Copying ${migration.copied} of ${migration.total} records`,
        detail: 'Your current workspace stays unchanged during the copy.',
        progress: migration.progress,
      };
    case 'verifying':
      return {
        label: 'Checking every copied record',
        detail: 'Off Grid AI is checking the local copy before it can be used.',
        progress: migration.progress,
      };
    case 'committing':
      return {
        label: 'Saving the verified copy',
        detail: 'The workspace update is almost complete.',
        progress: migration.progress,
      };
    case 'failed':
      return {
        label: 'Workspace update stopped',
        detail: migration.error,
        progress: migration.progress,
      };
    case 'completed':
      return {
        label: 'Workspace update complete',
        detail: 'Your verified local copy is ready.',
        progress: 1,
      };
  }
}

export function useContentMigrationStatus(): ContentMigrationStatus {
  return useSyncExternalStore(
    contentMigrationStatus.subscribe,
    contentMigrationStatus.getSnapshot,
    contentMigrationStatus.getSnapshot,
  );
}

type BlockingContentMigrationStatus = Exclude<
  ContentMigrationStatus,
  { phase: 'not-started' }
>;

export function shouldBlockForContentMigration(
  status: ContentMigrationStatus,
): status is BlockingContentMigrationStatus {
  if (status.phase === 'not-started') return false;
  if (status.migration.state === 'completed') return false;
  return status.phase === 'running' || status.migration.state === 'failed';
}

interface ContentMigrationSurfaceProps {
  status: BlockingContentMigrationStatus;
}

export function ContentMigrationSurface({ status }: ContentMigrationSurfaceProps) {
  const { colors, isDark } = useTheme();
  const styles = useThemedStyles(createStyles);
  const migration = status.migration;
  const presentation = migrationPresentation(migration);
  const percent = Math.round(presentation.progress * 100);
  const failed = migration.state === 'failed';
  const retryAllowed = failed && migration.retryEligible;
  const handleRetry = useCallback(() => {
    retryContentPersistenceMigration();
  }, []);

  return (
    <GestureHandlerRootView
      style={[styles.flex, { backgroundColor: colors.background }]}
      testID="content-migration-surface"
    >
      <SafeAreaProvider>
        <SystemBars style={isDark ? 'light' : 'dark'} />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.content}>
            <Text style={styles.eyebrow}>LOCAL WORKSPACE UPDATE</Text>
            <Text style={styles.title}>Your workspace stays private.</Text>
            <Text style={styles.body}>
              Off Grid AI is moving your projects and conversations into the new local database.
            </Text>

            <View style={styles.statusPanel}>
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.phase, failed && styles.error]}
                testID="content-migration-phase"
              >
                {presentation.label}
              </Text>
              <View
                accessible
                accessibilityLabel="Workspace update progress"
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: percent }}
                testID="content-migration-progress"
              >
                <Text style={styles.progress}>{percent}%</Text>
              </View>
              <Text style={styles.detail}>{presentation.detail}</Text>
            </View>

            <Text style={styles.notice}>
              Keep Off Grid AI open. Your workspace stays unavailable until the copy is checked.
            </Text>

            {retryAllowed ? (
              <Button
                title="Retry update"
                onPress={handleRetry}
                variant="primary"
                testID="content-migration-retry"
                accessibilityLabel="Retry workspace update"
              />
            ) : null}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center' as const,
    padding: SPACING.xl,
    gap: SPACING.lg,
  },
  eyebrow: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: colors.text,
  },
  body: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  statusPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: SPACING.sm,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  phase: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  error: {
    color: colors.error,
  },
  progress: {
    ...TYPOGRAPHY.display,
    color: colors.primary,
  },
  detail: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  notice: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
});
