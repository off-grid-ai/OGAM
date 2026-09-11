import { Dispatch, MutableRefObject, SetStateAction, useCallback } from 'react';
import { AlertState } from '../../components';
import type { ModelSettingsRecord } from '@offgrid/application';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import {
  Conversation,
  DebugInfo,
  DownloadedModel,
  MediaAttachment,
  Message,
  Project,
} from '../../types';
import type { ActiveTextModelResult } from '../../hooks/useActiveTextModel';
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
const VIEWER_FADE_OUT_MS = 350;

interface ChatScreenActionsArgs {
  generationDeps: GenerationDeps;
  modelDeps: Parameters<typeof handleModelSelectFn>[0];
  activeModelInfo: ActiveTextModelResult;
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
  activeConversation: Conversation | undefined;
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
  activeModel,
  settings,
  loadedSettings,
  pendingMessageRef,
  setDebugInfo,
  setAlertState,
  activeConversationId,
  activeConversation,
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

  const canReloadTextModel =
    Boolean(activeModelInfo.modelId) && !activeModelInfo.isRemote;

  return {
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
      message: Message,
    ) =>
      handleRetryMessageFn(message, generationDeps, {
        activeConversationId,
        setDebugInfo,
      }),
    handleEditMessage: (
      message: Message,
      newContent: string,
    ) =>
      handleEditMessageFn(generationDeps, {
        message,
        newContent,
        activeConversationId,
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
