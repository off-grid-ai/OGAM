import { Dispatch, MutableRefObject, SetStateAction, useCallback } from 'react';
import { AlertState } from '../../components';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { useAppStore, useChatStore } from '../../stores';
import {
  DebugInfo,
  DownloadedModel,
  MediaAttachment,
  Project,
} from '../../types';
import type { ActiveTextModelResult } from '../../hooks/useActiveTextModel';
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
  startGenerationFn,
} from './useChatGenerationActions';
import {
  handleDeleteConversationFn,
  handleEditMessageFn,
  handleGenerateImageFromMsgFn,
  handleRetryMessageFn,
  handleTranscribeAgainFn,
} from './useChatMessageHandlers';

type SetState<T> = Dispatch<SetStateAction<T>>;
type ChatStoreState = ReturnType<typeof useChatStore.getState>;
type StartGeneration = (
  conversationId: string,
  text: string,
) => Promise<void>;

const VIEWER_FADE_OUT_MS = 350;

interface ChatScreenActionsArgs {
  generationDeps: GenerationDeps;
  generationDepsRef: MutableRefObject<GenerationDeps | null>;
  modelDeps: Parameters<typeof handleModelSelectFn>[0];
  activeModelInfo: ActiveTextModelResult;
  supportsToolCalling: boolean;
  activeModel?: DownloadedModel;
  settings: ReturnType<typeof useAppStore.getState>['settings'];
  loadedSettings: ReturnType<typeof useAppStore.getState>['loadedSettings'];
  pendingMessageRef: MutableRefObject<{
    text: string;
    attachments?: MediaAttachment[];
  } | null>;
  startGenerationRef: MutableRefObject<StartGeneration | null>;
  setDebugInfo: SetState<DebugInfo | null>;
  setAlertState: SetState<AlertState>;
  activeConversationId: string | null;
  activeConversation: ChatStoreState['conversations'][number] | undefined;
  hasActiveModel: boolean;
  deleteMessagesAfter: ChatStoreState['deleteMessagesAfter'];
  updateMessageContent: ChatStoreState['updateMessageContent'];
  setConversationProject: ChatStoreState['setConversationProject'];
  setPendingProjectId: (projectId?: string) => void;
  setShowProjectSelector: SetState<boolean>;
  activeImageModel: GenerationDeps['activeImageModel'];
  viewerImageUri: string | null;
  setViewerImageUri: SetState<string | null>;
}

export function useChatScreenActions({
  generationDeps,
  generationDepsRef,
  modelDeps,
  activeModelInfo,
  supportsToolCalling,
  activeModel,
  settings,
  loadedSettings,
  pendingMessageRef,
  startGenerationRef,
  setDebugInfo,
  setAlertState,
  activeConversationId,
  activeConversation,
  hasActiveModel,
  deleteMessagesAfter,
  updateMessageContent,
  setConversationProject,
  setPendingProjectId,
  setShowProjectSelector,
  activeImageModel,
  viewerImageUri,
  setViewerImageUri,
}: ChatScreenActionsArgs) {
  const startGeneration: StartGeneration = async (
    targetConversationId,
    messageText,
  ) => {
    await startGenerationFn(generationDeps, {
      setDebugInfo,
      targetConversationId,
      messageText,
    });
  };
  startGenerationRef.current = startGeneration;

  const handleSend = (
    text: string,
    attachments?: MediaAttachment[],
    imageMode?: 'auto' | 'force' | 'disabled',
  ) =>
    handleSendFn(generationDeps, {
      text,
      attachments,
      imageMode,
      startGeneration,
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

  const enabledTools = supportsToolCalling
    ? settings.enabledTools || []
    : [];
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
    handleToggleTool: (toolId: string) => {
      const current = settings.enabledTools || [];
      useAppStore.getState().updateSettings({
        enabledTools: current.includes(toolId)
          ? current.filter(id => id !== toolId)
          : [...current, toolId],
      });
    },
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
    handleRetryMessage: (message: ChatStoreState['conversations'][number]['messages'][number]) => {
      const currentDeps = generationDepsRef.current ?? generationDeps;
      return handleRetryMessageFn(message, currentDeps, {
        activeConversationId: currentDeps.activeConversationId,
        hasActiveModel: !!currentDeps.hasActiveModel,
        deleteMessagesAfter,
        setDebugInfo,
      });
    },
    handleEditMessage: (
      message: ChatStoreState['conversations'][number]['messages'][number],
      newContent: string,
    ) =>
      handleEditMessageFn(generationDeps, {
        message,
        newContent,
        activeConversationId,
        hasActiveModel,
        updateMessageContent,
        deleteMessagesAfter,
        setDebugInfo,
      }),
    handleTranscribeAgain: (
      message: ChatStoreState['conversations'][number]['messages'][number],
      attachment: MediaAttachment,
    ) =>
      handleTranscribeAgainFn({
        message,
        attachment,
        activeConversationId,
        updateMessageTranscription:
          useChatStore.getState().updateMessageTranscription,
        setAlertState,
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
          setConversationProject,
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
