import { Dispatch, MutableRefObject, SetStateAction, useCallback } from 'react';
import { AlertState } from '../../components';
import type { ModelSettingsRecord } from '@offgrid/application';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { useChatStore } from '../../stores';
import {
  DebugInfo,
  DownloadedModel,
  MediaAttachment,
  Project,
} from '../../types';
import type { ActiveTextModelResult } from '../../hooks/useActiveTextModel';
import { useEnabledToolsSetting } from '../../hooks/useEnabledToolsSetting';
import type { AppSettings } from '../../stores/appStore';
import { saveImageToGallery } from './useSaveImage';
import { computePendingSettings } from './pendingSettings';
import { reloadTextModel } from './reloadTextModel';
import {
  handleModelSelectFn,
  handleUnloadModelFn,
} from './useChatModelActions';
import {
  GenerationDeps,
  handleSelectProjectFn,
  handleSendFn,
  handleStopFn,
} from './useChatGenerationActions';
import {
  handleDeleteConversationFn,
  handleEditMessageFn,
  handleGenerateImageFromMsgFn,
  handleRetryMessageFn,
} from './useChatMessageHandlers';

type SetState<T> = Dispatch<SetStateAction<T>>;
type ChatStoreState = ReturnType<typeof useChatStore.getState>;

const VIEWER_FADE_OUT_MS = 350;

interface ChatScreenActionsArgs {
  generationDeps: GenerationDeps;
  modelDeps: Parameters<typeof handleModelSelectFn>[0];
  activeModelInfo: ActiveTextModelResult;
  supportsToolCalling: boolean;
  activeModel?: DownloadedModel;
  settings: ModelSettingsRecord;
  loadedSettings: Partial<AppSettings> | null;
  pendingMessageRef: MutableRefObject<{
    text: string;
    attachments?: MediaAttachment[];
  } | null>;
  setDebugInfo: SetState<DebugInfo | null>;
  setAlertState: SetState<AlertState>;
  activeConversationId: string | null;
  activeConversation: ChatStoreState['conversations'][number] | undefined;
  hasActiveModel: boolean;
  setPendingProjectId: (projectId?: string) => void;
  setShowProjectSelector: SetState<boolean>;
  activeImageModel: GenerationDeps['activeImageModel'];
  viewerImageUri: string | null;
  setViewerImageUri: SetState<string | null>;
}

export function useChatScreenActions({
  generationDeps,
  modelDeps,
  activeModelInfo,
  supportsToolCalling,
  activeModel,
  settings,
  loadedSettings,
  pendingMessageRef,
  setDebugInfo,
  setAlertState,
  activeConversationId,
  activeConversation,
  hasActiveModel,
  setPendingProjectId,
  setShowProjectSelector,
  activeImageModel,
  viewerImageUri,
  setViewerImageUri,
}: ChatScreenActionsArgs) {
  const handleSend = (
    text: string,
    attachments?: MediaAttachment[],
    imageMode?: 'auto' | 'force' | 'disabled',
  ) =>
    handleSendFn(generationDeps, {
      text,
      attachments,
      imageMode,
      setDebugInfo,
    });

  const handleReloadTextModel = useCallback(
    () =>
      reloadTextModel({
        modelDeps,
        modelId: activeModelInfo.modelId,
        isRemote: activeModelInfo.isRemote,
        setAlertState,
      }),
    // The model ID, engine, and settings are the reload boundary. modelDeps is rebuilt from those values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeModelInfo.modelId,
      activeModelInfo.isRemote,
      settings,
      activeModel?.engine,
    ],
  );

  const handleModelSelect = async (model: DownloadedModel) => {
    await handleModelSelectFn(modelDeps, model);
    const pending = pendingMessageRef.current;
    if (pending) {
      pendingMessageRef.current = null;
      handleSend(pending.text, pending.attachments);
    }
  };

  // The Shared committed projection is the read owner. This hook only READS the enabled tools:
  // the pickers (ToolsScreen, McpServersScreen) own the toggle through the same seam, so no
  // second writer of `enabledTools` lives on the chat path.
  const { enabledTools: committedTools } = useEnabledToolsSetting();
  const enabledTools = supportsToolCalling ? committedTools : [];
  const canReloadTextModel =
    Boolean(activeModelInfo.modelId) && !activeModelInfo.isRemote;

  return {
    enabledTools,
    hasPendingSettings:
      canReloadTextModel &&
      computePendingSettings(activeModel?.engine, settings, loadedSettings),
    handleReloadTextModel,
    handleSend,
    handleModelSelect,
    handleStop: () => handleStopFn(generationDeps),
    handleUnloadModel: () => handleUnloadModelFn(modelDeps),
    handleDeleteConversation: () =>
      handleDeleteConversationFn(generationDeps, {
        activeConversationId,
        activeConversation,
        setAlertState,
      }),
    handleCopyMessage: (content: string) => {
      callHook(HOOKS.clipboardRecordLocalText, content, Date.now());
    },
    handleRetryMessage: (
      message: ChatStoreState['conversations'][number]['messages'][number],
    ) =>
      handleRetryMessageFn(message, generationDeps, {
        activeConversationId,
        hasActiveModel,
        setDebugInfo,
      }),
    handleEditMessage: (
      message: ChatStoreState['conversations'][number]['messages'][number],
      newContent: string,
    ) =>
      handleEditMessageFn(generationDeps, {
        message,
        newContent,
        activeConversationId,
        hasActiveModel,
        setDebugInfo,
      }),
    handleSelectProject: (project: Project | null) => {
      setPendingProjectId(project?.id);
      if (!activeConversationId) {
        setShowProjectSelector(false);
        return;
      }
      handleSelectProjectFn(
        {
          activeConversationId,
          setShowProjectSelector,
        },
        project,
      );
    },
    handleGenerateImageFromMessage: (prompt: string) =>
      handleGenerateImageFromMsgFn(prompt, generationDeps, {
        activeConversationId,
        activeImageModel,
        setAlertState,
      }),
    handleImagePress: (uri: string) => setViewerImageUri(uri),
    handleSaveImage: () => {
      const uri = viewerImageUri;
      setViewerImageUri(null);
      setTimeout(() => {
        saveImageToGallery(uri, setAlertState).catch(() => {});
      }, VIEWER_FADE_OUT_MS);
    },
  };
}
