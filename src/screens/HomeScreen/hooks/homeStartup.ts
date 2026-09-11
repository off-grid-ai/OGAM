import { InteractionManager } from 'react-native';
import {
  modelsFailureMessage,
  resolveAutoDiscoverMigration,
} from '@offgrid/application';
import type { ModelsFailure, Outcome } from '@offgrid/application';
import { syncWithNativeState } from '../../../services';
import { applicationFacade } from '../../../services/applicationFacade';
import logger from '../../../utils/logger';

let hasInitializedNativeModelState = false;
let lanDiscoveryState: 'idle' | 'scheduled' | 'complete' = 'idle';

const observe = (task: Promise<void>): void => {
  task.catch(error => {
    lanDiscoveryState = 'idle';
    logger.error('[HomeScreen] Auto-discovery scheduling failed:', error);
  });
};

interface HomeStartupDependencies {
  readonly loadData: () => Promise<void>;
  readonly runLANDiscovery: () => Promise<Outcome<void, ModelsFailure>>;
  readonly onStartupFailure: (
    failure: ModelsFailure,
    retry: () => Promise<void>,
  ) => void;
}

/** Own the one-time Home startup over the two Shared persistence projections. */
export function startHomeStartup({
  loadData,
  runLANDiscovery,
  onStartupFailure,
}: HomeStartupDependencies): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopRemoteReady: (() => void) | null = null;
  let stopSettingsReady: (() => void) | null = null;
  let cancelled = false;
  let reportedFailure: ModelsFailure | null = null;
  const task = InteractionManager.runAfterInteractions(() => {
    loadData().catch(error =>
      logger.error('[HomeScreen] Startup data load failed:', error),
    );
    if (!hasInitializedNativeModelState) {
      hasInitializedNativeModelState = true;
      syncWithNativeState();
    }
    if (lanDiscoveryState !== 'idle') return;
    lanDiscoveryState = 'scheduled';
    const migrateAndSchedule = async (): Promise<void> => {
      if (cancelled) return;
      const stored =
        applicationFacade().models.settings.current().autoDiscoverRemoteModels;
      const next = resolveAutoDiscoverMigration(
        typeof stored === 'boolean' ? stored : undefined,
        applicationFacade().models.snapshot().servers.length > 0,
      );
      if (next !== undefined) {
        const saved = await applicationFacade().models.settings.save({
          origin: 'migration',
          patch: { autoDiscoverRemoteModels: next },
        });
        if (!saved.ok) {
          logger.error(
            `[HomeScreen] Auto-discovery setting migration failed: ${modelsFailureMessage(
              saved.failure,
            )}`,
          );
          lanDiscoveryState = 'idle';
          onStartupFailure(saved.failure, async () => {
            started = false;
            startWhenReady();
          });
          return;
        }
      }
      if (cancelled) return;
      timer = setTimeout(() => {
        timer = null;
        if (cancelled) {
          lanDiscoveryState = 'idle';
          return;
        }
        const runDiscoveryAttempt = async (): Promise<void> => {
          const outcome = await runLANDiscovery();
          if (cancelled) return;
          if (outcome.ok) {
            lanDiscoveryState = 'complete';
            return;
          }
          lanDiscoveryState = 'idle';
          onStartupFailure(outcome.failure, async () => {
            if (cancelled) return;
            lanDiscoveryState = 'scheduled';
            await runDiscoveryAttempt();
          });
        };
        observe(runDiscoveryAttempt());
      }, 3000);
    };
    let started = false;
    let startWhenReady = (): void => undefined;
    const reportReadinessFailure = (
      failure: ModelsFailure,
      retry: () => Promise<void>,
    ): void => {
      if (reportedFailure === failure || cancelled) return;
      reportedFailure = failure;
      lanDiscoveryState = 'idle';
      onStartupFailure(failure, retry);
    };
    const retrySettingsReadiness = async (): Promise<void> => {
      reportedFailure = null;
      const outcome =
        await applicationFacade().models.settings.retryReadiness();
      if (!outcome.ok) {
        reportReadinessFailure(outcome.failure, retrySettingsReadiness);
        return;
      }
      startWhenReady();
    };
    const retryRemoteReadiness = async (): Promise<void> => {
      reportedFailure = null;
      const outcome =
        await applicationFacade().models.retryRemoteServersReadiness();
      if (!outcome.ok) {
        reportReadinessFailure(outcome.failure, retryRemoteReadiness);
        return;
      }
      startWhenReady();
    };
    startWhenReady = (): void => {
      const models = applicationFacade().models;
      const settingsReadiness = models.settings.readiness();
      if (settingsReadiness.status === 'failed') {
        reportReadinessFailure(
          settingsReadiness.failure,
          retrySettingsReadiness,
        );
        return;
      }
      const remoteReadiness = models.remoteServersReadiness();
      if (remoteReadiness.status === 'failed') {
        reportReadinessFailure(remoteReadiness.failure, retryRemoteReadiness);
        return;
      }
      if (
        started ||
        cancelled ||
        settingsReadiness.status !== 'ready' ||
        remoteReadiness.status !== 'ready'
      )
        return;
      started = true;
      reportedFailure = null;
      stopRemoteReady?.();
      stopSettingsReady?.();
      observe(migrateAndSchedule());
    };
    stopRemoteReady =
      applicationFacade().models.subscribeRemoteServersReadiness(
        startWhenReady,
      );
    stopSettingsReady =
      applicationFacade().models.settings.subscribeReadiness(startWhenReady);
    startWhenReady();
  });
  return () => {
    cancelled = true;
    task.cancel();
    stopRemoteReady?.();
    stopSettingsReady?.();
    if (timer !== null) clearTimeout(timer);
    if (lanDiscoveryState === 'scheduled') lanDiscoveryState = 'idle';
  };
}
