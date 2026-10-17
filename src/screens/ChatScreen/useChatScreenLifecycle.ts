import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { NavigationProp } from '@react-navigation/native';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import {
  contextCompactionService,
  generationService,
  imageGenerationService,
  ImageGenerationState,
  QueuedMessage,
} from '../../services';
import type { GenerationState } from '../../services/generationService';
import { generationSession } from '../../services/generationSession';
import type { RootStackParamList } from '../../navigation/types';
import {
  dispatchGenerationFn,
  GenerationDeps,
} from './useChatGenerationActions';

type StartGeneration = (
  conversationId: string,
  text: string,
) => Promise<void>;

/** A missing stream never belongs to a missing conversation. */
export function isStreamingActiveConversation(
  streamingConversationId: string | null,
  activeConversationId: string | null,
): boolean {
  return (
    streamingConversationId !== null &&
    streamingConversationId === activeConversationId
  );
}

export function useChatAudioLifecycle(
  navigation: Pick<NavigationProp<RootStackParamList>, 'addListener'>,
): void {
  useEffect(() => {
    // Leaving is unconditional. audioStop deliberately protects a warm-but-idle engine, which is
    // right at the start of a turn and wrong here: a reply that had not begun playing yet survived the
    // guard and started speaking into a screen the person had already left.
    const unsubscribeBlur = navigation.addListener('blur', () => {
      callHook(HOOKS.audioStopForExit);
    });
    const unsubscribeRemove = navigation.addListener('beforeRemove', () => {
      callHook(HOOKS.audioStopForExit);
    });
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        callHook(
          nextState === 'active'
            ? HOOKS.audioOnAppForeground
            : HOOKS.audioOnAppBackground,
        );
      },
    );
    return () => {
      unsubscribeBlur();
      unsubscribeRemove();
      appStateSubscription.remove();
    };
  }, [navigation]);
}

export function useChatRuntimeSubscriptions(
  generationDepsRef: MutableRefObject<GenerationDeps | null>,
  startGenerationRef: MutableRefObject<StartGeneration | null>,
): {
  imageGenState: ImageGenerationState;
  isCompacting: boolean;
  queuedMessages: QueuedMessage[];
  queueHold: GenerationState['queueHold'];
} {
  const [imageGenState, setImageGenState] = useState<ImageGenerationState>(
    imageGenerationService.getState(),
  );
  const [isCompacting, setIsCompacting] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>(
    generationService.getState().queuedMessages,
  );
  const [queueHold, setQueueHold] = useState<GenerationState['queueHold']>(
    generationService.getState().queueHold,
  );

  useEffect(() => {
    const unsubscribeImage =
      imageGenerationService.subscribe(setImageGenState);
    const unsubscribeCompaction =
      contextCompactionService.subscribeCompacting(setIsCompacting);
    return () => {
      unsubscribeImage();
      unsubscribeCompaction();
    };
  }, []);

  useEffect(
    () =>
      generationService.subscribe(state => {
        setQueuedMessages(state.queuedMessages);
        setQueueHold(state.queueHold);
      }),
    [],
  );

  const handleQueuedSend = useCallback(
    async (item: QueuedMessage) => {
      if (!generationDepsRef.current || !startGenerationRef.current) return;
      await dispatchGenerationFn(
        generationDepsRef.current,
        {
          text: item.text,
          attachments: item.attachments,
          conversationId: item.conversationId,
          imageMode: item.imageMode,
          assistantEnabled: item.assistantEnabled,
        },
        startGenerationRef.current,
      );
    },
    [generationDepsRef, startGenerationRef],
  );

  useEffect(() => {
    generationService.setQueueProcessor(handleQueuedSend);
    return () => generationService.setQueueProcessor(null);
  }, [handleQueuedSend]);

  return { imageGenState, isCompacting, queuedMessages, queueHold };
}

interface ConversationLifecycleArgs {
  routeConversationId?: string;
  routeProjectId?: string;
  activeConversationId: string | null;
  setActiveConversation: (conversationId: string | null) => void;
  setPendingProjectId: (projectId?: string) => void;
}

export function useChatConversationLifecycle({
  routeConversationId,
  routeProjectId,
  activeConversationId,
  setActiveConversation,
  setPendingProjectId,
}: ConversationLifecycleArgs): void {
  useEffect(() => {
    setActiveConversation(routeConversationId ?? null);
    // The route ID is the owner of this transition; store callbacks are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeConversationId]);

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
    // Native conversation isolation is awaited by generationService immediately
    // before a local turn starts. A navigation timer here raced the first Send and
    // could clear too late (context leak) or during prefill (no-op).
  }, [activeConversationId]);
}

export function useChatPresentationLifecycle(
  activeConversationId: string | null,
  messageCount: number,
  isStreamingForThisConversation: boolean,
): number {
  const [animateLastN, setAnimateLastN] = useState(0);
  const lastMessageCountRef = useRef(0);
  const previousStreamingRef = useRef(false);

  useEffect(() => {
    const previous = lastMessageCountRef.current;
    if (messageCount > previous && previous > 0) {
      setAnimateLastN(messageCount - previous);
    }
    lastMessageCountRef.current = messageCount;
  }, [messageCount]);

  useEffect(() => {
    lastMessageCountRef.current = 0;
    setAnimateLastN(0);
  }, [activeConversationId]);

  useEffect(() => {
    const wasStreaming = previousStreamingRef.current;
    previousStreamingRef.current = isStreamingForThisConversation;
    if (
      wasStreaming &&
      !isStreamingForThisConversation &&
      activeConversationId
    ) {
      callHook(HOOKS.audioOnStreamingEnd, activeConversationId);
    }
  }, [isStreamingForThisConversation]); // eslint-disable-line react-hooks/exhaustive-deps

  return animateLastN;
}
