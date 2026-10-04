import { useEffect, type MutableRefObject } from 'react';
import { recordingController } from '../../services/recordingController';
import logger from '../../utils/logger';
import type { FinalizedRecording } from '@offgrid/application';

interface VoiceControllerEffectInput {
  conversationId?: string | null;
  recordingConversationIdRef: MutableRefObject<string | null>;
  startRef: MutableRefObject<() => Promise<void>>;
  stopRef: MutableRefObject<() => Promise<void>>;
  cancelRef: MutableRefObject<() => void | Promise<void>>;
  finalResult: string;
  finalRecording: FinalizedRecording | null;
  clearResult: () => void;
  deliverTranscript: (text: string) => void;
  deliverCapture: (text: string, recording: FinalizedRecording) => void;
}

/** Register recorder intents and project completed Whisper results. */
export function useVoiceControllerEffects(
  input: VoiceControllerEffectInput,
): void {
  const {
    conversationId,
    recordingConversationIdRef,
    startRef,
    stopRef,
    cancelRef,
    finalResult,
    finalRecording,
    clearResult,
    deliverTranscript,
    deliverCapture,
  } = input;
  useEffect(
    () =>
      recordingController.registerHandlers({
        start: () => startRef.current(),
        stop: async () => {
          try {
            await stopRef.current();
          } catch (error) {
            logger.error('[Voice] Stop intent failed:', error);
          }
        },
        cancel: () => {
          Promise.resolve(cancelRef.current()).catch(error => {
            logger.error('[Voice] Cancel intent failed:', error);
          });
        },
      }),
    [startRef, stopRef, cancelRef],
  );

  useEffect(() => {
    if (
      recordingConversationIdRef.current &&
      recordingConversationIdRef.current !== conversationId
    ) {
      Promise.resolve(cancelRef.current()).catch(error => {
        logger.error('[Voice] Conversation-change cancel failed:', error);
      });
    }
  }, [conversationId, cancelRef, recordingConversationIdRef]);

  useEffect(() => {
    if (!finalResult) return;
    if (
      !recordingConversationIdRef.current ||
      recordingConversationIdRef.current === conversationId
    ) {
      if (finalRecording) deliverCapture(finalResult, finalRecording);
      else deliverTranscript(finalResult);
    }
    clearResult();
    recordingConversationIdRef.current = null;
  }, [
    finalResult,
    conversationId,
    deliverTranscript,
    deliverCapture,
    finalRecording,
    clearResult,
    recordingConversationIdRef,
  ]);
}
