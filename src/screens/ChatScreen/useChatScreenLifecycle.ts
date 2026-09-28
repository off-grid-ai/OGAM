import {
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { NavigationProp } from '@react-navigation/native';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import {
  contextCompactionService,
  imageGenerationService,
  ImageGenerationState,
} from '../../services';
import type { RootStackParamList } from '../../navigation/types';
import { mobileChatSession } from './mobileChatSession';
import { requireWorkspaceConversationMessages } from '../../hooks/useApplicationProjection';
import { toWorkspaceMessage } from './types';

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
): {
  imageGenState: ImageGenerationState;
  isCompacting: boolean;
  queueCount: number;
  queuedTexts: string[];
} {
  const [imageGenState, setImageGenState] = useState<ImageGenerationState>(
    imageGenerationService.getState(),
  );
  const [isCompacting, setIsCompacting] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [queuedTexts, setQueuedTexts] = useState<string[]>([]);

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

  useEffect(() => {
    return mobileChatSession.subscribeQueue(projection => {
      const queued = projection.entries.filter(entry => entry.status === 'queued');
      setQueueCount(queued.length);
      setQueuedTexts(queued.map(entry => {
        const message = requireWorkspaceConversationMessages(entry.conversationId)
          .map(toWorkspaceMessage)
          .find(candidate => candidate.id === entry.turnId);
        return message?.content ?? '';
      }));
    });
  }, []);

  return { imageGenState, isCompacting, queueCount, queuedTexts };
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
  setActiveConversation,
  setPendingProjectId,
}: ConversationLifecycleArgs): void {
  useEffect(() => {
    setActiveConversation(routeConversationId ?? null);
    // Opening a chat asks the chat rules to repair anything the previous run left mid-flight. The
    // screen must never read a saved reply and decide for itself that it was cut short.
    if (routeConversationId) void mobileChatSession.restore(routeConversationId);
    // The route ID is the owner of this transition; store callbacks are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeConversationId]);

  useEffect(() => {
    setPendingProjectId(routeProjectId);
  }, [routeProjectId, setPendingProjectId]);

  // Switching conversations no longer clears anything here. The screen kept its own mark of which
  // conversation was replying, and this effect existed to wipe it; the shared chat queue already
  // records the conversation each running turn belongs to, so there is nothing left to reset.
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
