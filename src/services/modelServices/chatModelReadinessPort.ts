import type { ChatModelReadinessFacts, ChatModelReadinessService } from '@offgrid/models';
import { chatModelReadiness } from '../composition/model-library-services';
import type { DownloadedModel } from '../../types';
import { isLiteRTModel } from '../../types';
import { getActiveModels } from './modelState';
import { mobileTextEngineControl } from './textEngineControl';
import { isOverridableMemoryError } from '../../utils/modelLoadErrors';
import { mobileResidencyIntents } from './residencyIntents';

export interface MobileChatModelReadinessInput {
  activeModel: DownloadedModel | null | undefined;
  activeModelId: string | null;
  remote: boolean;
  beforeLoad?: () => void | Promise<void>;
}

/** Load and memory-refusal ports around one readiness inspection. */
function mobileChatModelReadinessPorts(
  input: MobileChatModelReadinessInput,
  inspect: () => ChatModelReadinessFacts,
): ConstructorParameters<typeof ChatModelReadinessService>[0] {
  return {
    inspect,
    beforeLoad: input.beforeLoad,
    async load(command) {
      if (!input.activeModelId) throw new Error('No text model is selected');
      if (command.forceReload) await mobileResidencyIntents.unloadText(true);
      await mobileResidencyIntents.ensureText(
        input.activeModelId,
        undefined,
        command.overrideMemory ? { override: true } : undefined,
      );
    },
    isMemoryRefusal: isOverridableMemoryError,
  };
}

/** Native/runtime fact adapter. All readiness and recovery decisions stay in Shared. */
export function mobileChatModelReadiness(
  input: MobileChatModelReadinessInput,
): ChatModelReadinessService {
  const inspect = (): ChatModelReadinessFacts => {
    const model = input.activeModel;
    return {
      remote: input.remote,
      selected: input.remote || !!(model && input.activeModelId),
      resident: input.remote || mobileTextEngineControl.isReady(model?.id),
      loading: getActiveModels().text.isLoading,
      expectsVision: !!model && !isLiteRTModel(model) && !!model.mmProjPath,
      visionReady: !!model && mobileTextEngineControl.capabilities(model.id).vision,
    };
  };

  return chatModelReadiness(mobileChatModelReadinessPorts(input, inspect));
}
