import { registerHook, HOOKS } from './hookRegistry';

/**
 * The few places core code needs something from a higher layer (loading a model, telling the chat a message was cut) go
 * through named hooks, so core never imports upward. This wires each hook to its implementation; the implementations are
 * required when called, so nothing heavy loads at start-up. Called once by the app and by the test setup.
 */
export function registerAtlasHooks(): void {
  registerHook(HOOKS.ensureTextModel, (modelId: string | null) => require('../atlasTools/models').ensureTextModel(modelId));
  registerHook(HOOKS.agentModelChosen, (modelId: string) => { require('../atlasTools/models').switchToModelInBackground(modelId); });
  registerHook(HOOKS.messageCut, (latest: number, budget: number) => { require('../services/longMessageNotice').postLongMessageNotice(latest, budget); });
}
