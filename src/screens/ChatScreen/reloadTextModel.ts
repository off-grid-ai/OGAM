import { hideAlert, showAlert, type AlertState } from '../../components';
import { reloadLocalTextModel } from '../../services/modelServices/modelFacadeCommands';
import logger from '../../utils/logger';
import { initiateModelLoad } from './useChatModelActions';

/** The deps the shared load path already defines, borrowed rather than restated. */
type ModelActionDeps = Parameters<typeof initiateModelLoad>[0];

interface ReloadTextModelDeps {
  /** Everything the shared load path needs. Same deps a normal load uses, so behaviour matches. */
  modelDeps: ModelActionDeps;
  modelId: string | null;
  isRemote: boolean;
  setAlertState: (state: AlertState) => void;
}

/**
 * Reload the active text model so changed settings take effect.
 *
 * Unloads with keepSelection so a failed reload cannot clear the selection - the old default cleared
 * it, and an out-of-memory reload then stranded the chat with a stuck banner and a dead send button.
 * The memory gate, including "Load Anyway", stays owned by `initiateModelLoad`, so this reload is the
 * same load a model pick performs.
 *
 * Every outcome is reported. An unload or load that rejected used to end here as an unhandled
 * rejection: the banner stayed, the model never came back, and the tap looked like a dead button.
 */
export async function reloadTextModel({
  modelDeps,
  modelId,
  isRemote,
  setAlertState,
}: ReloadTextModelDeps): Promise<void> {
  if (!modelId || isRemote) {
    logger.warn(
      `[ModelReload] ignored: modelId=${modelId ? 'set' : 'none'} remote=${isRemote}`,
    );
    return;
  }
  logger.log('[ModelReload] reloading the active text model');
  try {
    await reloadLocalTextModel(modelId);
    const readiness = await initiateModelLoad(modelDeps, true);
    if (!readiness.ok) {
      throw new Error(`Reloaded model is not ready: ${readiness.reason}`);
    }
    logger.log('[ModelReload] finished');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error('[ModelReload] failed:', detail);
    setAlertState(
      showAlert('Could not reload the model', detail, [
        { text: 'OK', onPress: () => setAlertState(hideAlert()) },
      ]),
    );
  }
}
