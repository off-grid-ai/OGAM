import { Dispatch, MutableRefObject, SetStateAction, useCallback } from 'react';
import { AlertState } from '../../components';
import { activeModelService } from '../../services';
import { useAppStore } from '../../stores';
import {
  DebugInfo,
  DownloadedModel,
  MediaAttachment,
  Message,
  ONNXImageModel,
  Project,
} from '../../types';
import { saveImageToGallery } from './useSaveImage';
import { ActiveModelInfo } from './chatScreenTypes';
import { computePendingSettings } from './chatScreenSettings';
import {
  GenerationDeps,
  handleSelectProjectFn,
  handleSendFn,
  startGenerationFn,
} from './useChatGenerationActions';
import { handleModelSelectFn, initiateModelLoad } from './useChatModelActions';
import {
  handleDeleteConversationFn,
  handleEditMessageFn,
  handleGenerateImageFromMsgFn,
  handleRetryMessageFn,
} from './useChatMessageHandlers';

type SetState<T> = Dispatch<SetStateAction<T>>;
type StartGeneration = (id: string, text: string) => Promise<void>;
type ModelDeps = Parameters<typeof handleModelSelectFn>[0];

type Params = {
  genDeps: GenerationDeps;
  modelDeps: ModelDeps;
  genDepsRef: MutableRefObject<GenerationDeps>;
  startGenerationRef: MutableRefObject<StartGeneration>;
  pendingMessageRef: MutableRefObject<{
    text: string;
    attachments?: MediaAttachment[];
  } | null>;
  activeModelInfo: ActiveModelInfo;
  activeModel: DownloadedModel | undefined;
  activeConversationId: string | null | undefined;
  activeConversation: any;
  activeImageModel: ONNXImageModel | undefined;
  hasActiveModel: boolean;
  supportsToolCalling: boolean;
  settings: GenerationDeps['settings'];
  loadedSettings: unknown;
  viewerImageUri: string | null;
  setViewerImageUri: SetState<string | null>;
  setShowModelSelector: SetState<boolean>;
  setShowProjectSelector: SetState<boolean>;
  setPendingProjectId: SetState<string | undefined>;
  setDebugInfo: SetState<DebugInfo | null>;
  setAlertState: SetState<AlertState>;
  deleteMessagesAfter: (conversationId: string, messageId: string) => void;
  updateMessageContent: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => void;
  setConversationProject: (
    conversationId: string,
    projectId: string | null,
  ) => void;
};

export function useChatScreenActions({
  genDeps,
  modelDeps,
  genDepsRef,
  startGenerationRef,
  pendingMessageRef,
  activeModelInfo,
  activeModel,
  activeConversationId,
  activeConversation,
  activeImageModel,
  hasActiveModel,
  supportsToolCalling,
  settings,
  loadedSettings,
  viewerImageUri,
  setViewerImageUri,
  setShowModelSelector,
  setShowProjectSelector,
  setPendingProjectId,
  setDebugInfo,
  setAlertState,
  deleteMessagesAfter,
  updateMessageContent,
  setConversationProject,
}: Params) {
  const startGeneration: StartGeneration = async (
    targetConversationId,
    messageText,
  ) => {
    await startGenerationFn(genDeps, {
      setDebugInfo,
      targetConversationId,
      messageText,
    });
  };
  startGenerationRef.current = startGeneration;

  const enabledTools = supportsToolCalling ? settings.enabledTools || [] : [];
  const handleToggleTool = (toolId: string) => {
    const currentTools = settings.enabledTools || [];
    useAppStore.getState().updateSettings({
      enabledTools: currentTools.includes(toolId)
        ? currentTools.filter(id => id !== toolId)
        : [...currentTools, toolId],
    });
  };
  const hasPendingSettings = computePendingSettings(
    activeModel?.engine,
    settings as unknown as Record<string, unknown>,
    loadedSettings as Record<string, unknown> | null | undefined,
  );

  const handleReloadTextModel = useCallback(async () => {
    if (!activeModelInfo.modelId || activeModelInfo.isRemote) return;
    setShowModelSelector(true);
    await activeModelService.unloadTextModel(true);
    await initiateModelLoad(modelDeps, false);
  }, [
    activeModelInfo.modelId,
    activeModelInfo.isRemote,
    modelDeps,
    setShowModelSelector,
  ]);

  const handleSend = (
    text: string,
    attachments?: MediaAttachment[],
    imageMode?: 'auto' | 'force' | 'disabled',
  ) =>
    handleSendFn(genDeps, {
      text,
      attachments,
      imageMode,
      startGeneration,
      setDebugInfo,
    });

  const handleModelSelect = async (model: DownloadedModel) => {
    await handleModelSelectFn(modelDeps, model);
    const pending = pendingMessageRef.current;
    if (!pending) return;
    pendingMessageRef.current = null;
    await handleSendFn(genDepsRef.current, {
      text: pending.text,
      attachments: pending.attachments,
      startGeneration: startGenerationRef.current,
      setDebugInfo,
    });
  };

  const handleSelectProject = (project: Project | null) => {
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
  };

  const handleSaveImage = () => {
    const uri = viewerImageUri;
    setViewerImageUri(null);
    const viewerFadeOutMs = 350;
    setTimeout(() => {
      saveImageToGallery(uri, setAlertState).catch(() => {});
    }, viewerFadeOutMs);
  };

  return {
    enabledTools,
    handleToggleTool,
    hasPendingSettings,
    handleReloadTextModel,
    handleSend,
    handleModelSelect,
    handleSelectProject,
    handleSaveImage,
    handleDeleteConversation: () =>
      handleDeleteConversationFn(genDeps, {
        activeConversationId,
        activeConversation,
        setAlertState,
      }),
    handleRetryMessage: (message: Message) =>
      handleRetryMessageFn(message, genDeps, {
        activeConversationId,
        hasActiveModel,
        activeConversation,
        deleteMessagesAfter,
        setDebugInfo,
      }),
    handleEditMessage: (message: Message, newContent: string) =>
      handleEditMessageFn(genDeps, {
        message,
        newContent,
        activeConversationId,
        hasActiveModel,
        activeConversation,
        updateMessageContent,
        deleteMessagesAfter,
        setDebugInfo,
      }),
    handleGenerateImageFromMessage: (prompt: string) =>
      handleGenerateImageFromMsgFn(prompt, genDeps, {
        activeConversationId,
        activeImageModel,
        setAlertState,
      }),
    handleImagePress: (uri: string) => setViewerImageUri(uri),
  };
}
