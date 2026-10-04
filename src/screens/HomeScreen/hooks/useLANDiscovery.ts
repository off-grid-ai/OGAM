import { useCallback } from 'react';
import { showAlert, hideAlert, type AlertState } from '../../../components';
import { applicationFacade } from '../../../services/applicationFacade';
import {
  modelsFailureMessage,
  failed,
  ok,
  shouldAutoDiscoverRemoteModels,
  type DiscoveredRemoteServer,
  type ModelsFailure,
  type Outcome,
} from '@offgrid/application';
import type { HomeScreenNavigationProp } from './types';
import logger from '../../../utils/logger';

interface LANDiscoveryParams {
  navigation: HomeScreenNavigationProp;
  setAlertState: (state: AlertState) => void;
}

export function useLANDiscovery({
  navigation,
  setAlertState,
}: LANDiscoveryParams) {
  const addNewServersAndNotify = useCallback(
    async (
      newServersToAdd: DiscoveredRemoteServer[],
    ): Promise<Outcome<void, ModelsFailure>> => {
      const connectionFailures: ModelsFailure[] = [];
      for (const server of newServersToAdd) {
        logger.log('[HomeScreen] Auto-adding discovered server:', server.name);
        const saved = await applicationFacade().models.saveRemoteServer({
          name: server.name,
          endpoint: server.endpoint,
          provider: 'openai-compatible',
        });
        if (!saved.ok) {
          const message = modelsFailureMessage(saved.failure);
          logger.error(
            `[HomeScreen] Failed to save ${server.name}: ${message}`,
          );
          connectionFailures.push(saved.failure);
          continue;
        }
        try {
          const result = await applicationFacade().models.checkRemoteServer(
            saved.value.id,
          );
          if (!result.success) {
            connectionFailures.push({
              kind: 'runtime',
              message: `${server.name}: ${result.error ?? 'Connection check failed'}`,
            });
          }
        } catch (error: unknown) {
          logger.error(
            `[HomeScreen] Connection check failed for ${server.name}`,
            error,
          );
          connectionFailures.push({
            kind: 'runtime',
            message: `${server.name}: ${
              error instanceof Error ? error.message : 'Connection check failed'
            }`,
          });
        }
      }

      if (newServersToAdd.length === 0) return ok(undefined);
      if (connectionFailures.length > 0) {
        const failure: ModelsFailure = {
          kind: 'runtime',
          message: connectionFailures
            .map(connectionFailure => modelsFailureMessage(connectionFailure))
            .join('\n'),
        };
        setAlertState(showAlert('Server Check Failed', failure.message));
        return failed(failure);
      }

      const names = newServersToAdd.map(s => s.name).join(', ');
      const title =
        newServersToAdd.length === 1
          ? 'LLM Server Found'
          : `${newServersToAdd.length} LLM Servers Found`;
      setAlertState(
        showAlert(
          title,
          `Discovered on your network: ${names}. You can select a model from the model picker.`,
          [
            { text: 'Dismiss', style: 'cancel' },
            {
              text: 'View Servers',
              onPress: () => {
                setAlertState(hideAlert());
                navigation.navigate('RemoteServers');
              },
            },
          ],
        ),
      );
      return ok(undefined);
    },
    [navigation, setAlertState],
  );

  const runLANDiscovery = useCallback(async (): Promise<
    Outcome<void, ModelsFailure>
  > => {
    // The automatic LAN scan runs only when the user has enabled auto-discovery. Fresh installs are
    // OFF — never scan the network unprompted. (The "Scan Network" button is a separate, explicit
    // action and is NOT gated here.)
    if (
      !shouldAutoDiscoverRemoteModels(
        applicationFacade().models.settings.current(),
      )
    ) {
      logger.log(
        '[HomeScreen] LAN auto-discovery disabled in settings — skipping',
      );
      return ok(undefined);
    }
    logger.log('[HomeScreen] LAN auto-discovery enabled — scanning');
    const reconciled =
      await applicationFacade().models.reconcileRemoteServers();
    if (!reconciled.ok) {
      const message = modelsFailureMessage(reconciled.failure);
      logger.error(`[HomeScreen] LAN discovery failed: ${message}`);
      setAlertState(showAlert('Network Scan Failed', message));
      return failed(reconciled.failure);
    }
    return addNewServersAndNotify([...reconciled.value.found]);
  }, [addNewServersAndNotify, setAlertState]);

  return { runLANDiscovery };
}
