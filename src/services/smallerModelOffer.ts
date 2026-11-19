/**
 * The one-tap way forward when memory refuses a chat model: use a smaller chat model already on the
 * phone, or get the starter. The memory sheet shows it first, beside "Choose another model" and
 * "Load Anyway", so a refusal is never a dead end for a person who does not know which model fits.
 */
import { useAppStore } from '../stores/appStore';
import { formatBytes } from '../utils/formatBytes';
import { activeModelService } from './activeModelService';
import { smallerChatModel } from './devicePicks';
import { hardwareService } from './hardware';
import { startModelDownload } from './startModelDownload';

export interface SmallerModelAction {
  label: string;
  onPress: () => void;
}

/**
 * The smaller-model button for a refused chat model, or undefined when none is smaller.
 * `onUse` runs after a model on the phone is chosen in its place (load it and send the waiting turn).
 * A starter that must download first replaces the selection: the chat then shows it on its way, and
 * a message sent meanwhile waits for it (arrivingChatModel).
 */
export function smallerModelAction(refusedModelId: string, onUse: () => void): SmallerModelAction | undefined {
  const app = useAppStore.getState();
  const refused = app.downloadedModels.find(model => model.id === refusedModelId);
  if (!refused) return undefined;
  const choice = smallerChatModel(refused, app.downloadedModels, hardwareService.getTotalMemoryGB(), {
    classifierModelId: app.settings.classifierModelId,
  });
  if (!choice) return undefined;
  if (choice.kind === 'use') {
    return {
      label: `Use ${choice.model.name}`,
      onPress: () => {
        activeModelService.selectTextModel(choice.model.id);
        onUse();
      },
    };
  }
  const { pick } = choice;
  return {
    label: `Get ${pick.model.name} (${formatBytes(pick.sizeBytes)})`,
    onPress: () => {
      // The refused model stays on the phone; only the selection moves to the one on its way.
      activeModelService.unloadTextModel(false)
        .then(() => startModelDownload(pick.model.id, pick.file, {
          onRegistered: model => activeModelService.selectTextModel(model.id),
        }))
        .catch(() => undefined);
    },
  };
}
