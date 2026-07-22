import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
} from 'react';
import { AppState } from 'react-native';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import {
  contextCompactionService,
  generationService,
  ImageGenerationState,
  imageGenerationService,
  llmService,
  QueuedMessage,
} from '../../services';
import { generationSession } from '../../services/generationSession';
import { MediaAttachment } from '../../types';
import {
  dispatchGenerationFn,
  GenerationDeps,
} from './useChatGenerationActions';

type SetState<T> = Dispatch<SetStateAction<T>>;
type StartGeneration = (id: string, text: string) => Promise<void>;

type Params = {
  navigation: any;
  routeConversationId?: string;
  routeProjectId?: string;
  activeConversationId: string | null | undefined;
  setActiveConversation: (id: string | null) => void;
  setPendingProjectId: SetState<string | undefined>;
  setImageGenState: SetState<ImageGenerationState>;
  setIsCompacting: SetState<boolean>;
  setQueueCount: SetState<number>;
  setQueuedTexts: SetState<string[]>;
  genDepsRef: MutableRefObject<GenerationDeps>;
  startGenerationRef: MutableRefObject<StartGeneration>;
  displayMessageCount: number;
  lastMessageCountRef: MutableRefObject<number>;
  setAnimateLastN: SetState<number>;
  isStreamingForThisConversation: boolean;
  prevStreamingRef: MutableRefObject<boolean>;
};

export function useChatScreenEffects({
  navigation,
  routeConversationId,
  routeProjectId,
  activeConversationId,
  setActiveConversation,
  setPendingProjectId,
  setImageGenState,
  setIsCompacting,
  setQueueCount,
  setQueuedTexts,
  genDepsRef,
  startGenerationRef,
  displayMessageCount,
  lastMessageCountRef,
  setAnimateLastN,
  isStreamingForThisConversation,
  prevStreamingRef,
}: Params): void {
  useEffect(() => {
    const unsubBlur = navigation.addListener('blur', () => {
      callHook(HOOKS.audioStop);
    });
    const unsubRemove = navigation.addListener('beforeRemove', () => {
      callHook(HOOKS.audioStop);
    });
    const appStateSub = AppState.addEventListener('change', nextState => {
      callHook(
        nextState === 'active'
          ? HOOKS.audioOnAppForeground
          : HOOKS.audioOnAppBackground,
      );
    });
    return () => {
      unsubBlur();
      unsubRemove();
      appStateSub.remove();
    };
  }, [navigation]);

  useEffect(() => {
    const unsubscribeImages =
      imageGenerationService.subscribe(setImageGenState);
    const unsubscribeCompaction =
      contextCompactionService.subscribeCompacting(setIsCompacting);
    return () => {
      unsubscribeImages();
      unsubscribeCompaction();
    };
  }, [setImageGenState, setIsCompacting]);

  useEffect(
    () =>
      generationService.subscribe(state => {
        setQueueCount(state.queuedMessages.length);
        setQueuedTexts(state.queuedMessages.map(message => message.text));
      }),
    [setQueueCount, setQueuedTexts],
  );

  const handleQueuedSend = useCallback(
    async (item: QueuedMessage) => {
      await dispatchGenerationFn(
        genDepsRef.current,
        {
          text: item.text,
          attachments: item.attachments as MediaAttachment[] | undefined,
          conversationId: item.conversationId,
          imageMode: item.imageMode,
        },
        startGenerationRef.current,
      );
    },
    [genDepsRef, startGenerationRef],
  );

  useEffect(() => {
    generationService.setQueueProcessor(handleQueuedSend);
    return () => generationService.setQueueProcessor(null);
  }, [handleQueuedSend]);

  useEffect(() => {
    setActiveConversation(routeConversationId || null);
  }, [routeConversationId, setActiveConversation]);

  useEffect(() => {
    setPendingProjectId(routeProjectId);
  }, [routeProjectId, setPendingProjectId]);

  useEffect(() => {
    if (
      generationSession.getConversationId() &&
      !generationSession.isGeneratingFor(activeConversationId)
    ) {
      generationSession.end('conversation-switch');
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled && llmService.isModelLoaded()) {
        llmService.clearKVCache(false).catch(() => {});
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeConversationId]);

  useEffect(() => {
    const previousCount = lastMessageCountRef.current;
    if (displayMessageCount > previousCount && previousCount > 0) {
      setAnimateLastN(displayMessageCount - previousCount);
    }
    lastMessageCountRef.current = displayMessageCount;
  }, [displayMessageCount, lastMessageCountRef, setAnimateLastN]);

  useEffect(() => {
    lastMessageCountRef.current = 0;
    setAnimateLastN(0);
  }, [activeConversationId, lastMessageCountRef, setAnimateLastN]);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreamingForThisConversation;
    if (
      wasStreaming &&
      !isStreamingForThisConversation &&
      activeConversationId
    ) {
      callHook(HOOKS.audioOnStreamingEnd, activeConversationId);
    }
  }, [activeConversationId, isStreamingForThisConversation, prevStreamingRef]);
}
