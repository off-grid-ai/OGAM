import { registerHook, HOOKS } from '../bootstrap/hookRegistry';
import { registerSlot, SLOTS } from '../bootstrap/slotRegistry';
import { useUiModeStore } from '../stores/uiModeStore';
import { useChatStore } from '../stores/chatStore';
import { prepareMessageForSpeech } from '../utils/messageContent';
import { speak, stop, ttsAvailable, warmUp } from './tts';
import { finishStreamSpeech, onStreamToken } from './streamSpeech';
import { restoreVoice, restoreSavedVoice, loadVoiceForSpeech } from './neural';
import { profileForConversation, profileForMessage, type VoiceProfile } from './profiles';
import { useAtlasVoiceStore } from './store';
import { AtlasAudioInput } from './AudioInput';
import { AtlasModeToggle, AtlasSpeakButton } from './Buttons';
import { AtlasVoicePanel } from './VoicePanel';
import logger from '../utils/logger';

/** Voice mode is a phone call: talk like a person on the phone, not like a document. */
export const VOICE_CALL_STYLE = [
  'PHONE CALL MODE. You are talking to the user on a phone call, and every word you write is read aloud.',
  'Keep it super simple: short sentences, everyday words a ten-year-old knows, no jargon.',
  'Answer in one or two sentences. Only say more if the user asks for details, and even then stay under five sentences.',
  'Answer the question first, then stop. If there is more worth saying, ask "Want me to go on?" and wait.',
  'Talk like a friendly person: contractions (it\'s, you\'re, don\'t), a short reaction now and then ("Got it."), and a short follow-up question when it helps.',
  'Never use lists, markdown, headings, tables, code, links, symbols or emojis. Say numbers the way you would speak them.',
  'If the user interrupts you, do not repeat what you already said; respond to what they just said.',
].join(' ');

/**
 * Read a reply in the answering agent's own voice profile (if any), then put the saved
 * voice back so emergency cards, study and other screens keep the user's choice.
 */
function speakAsAgent(text: string, messageId: string, profile: VoiceProfile | null): void {
  if (!profile) {
    restoreSavedVoice().catch(() => undefined).finally(() => speak(text, messageId));
    return;
  }
  loadVoiceForSpeech(profile.voiceId, profile.sid).catch(() => undefined).finally(() => {
    speak(text, messageId, profile.rate);
  });
}

/**
 * Atlas voice: read-aloud, voice mode and hands-free "phone call" mode for the free
 * build, using the phone's built-in text-to-speech. Fills the same hooks/slots the
 * paid add-on uses, so the rest of the app needs no changes.
 */
export function registerAtlasVoice(): void {
  if (!ttsAvailable()) {
    logger.log('[AtlasVoice] native TTS module missing - voice features disabled');
    return;
  }
  warmUp();
  // Re-load the chosen natural voice once saved settings are loaded.
  const restore = () => {
    // Voices may live on the SD card: tell the native side where, then reload the chosen voice.
    const { useStoragePrefs, applyStoragePrefs } = require('../atlasTools/storage');
    const sp: any = useStoragePrefs.persist;
    const go = () => { applyStoragePrefs(); restoreVoice().catch(() => undefined); };
    if (sp?.hasHydrated?.()) go(); else sp?.onFinishHydration?.(go);
  };
  const ps: any = (useAtlasVoiceStore as any).persist;
  if (ps?.hasHydrated?.()) restore(); else ps?.onFinishHydration?.(restore);
  registerHook(HOOKS.audioCanSpeak, () => true);
  registerHook(HOOKS.audioSpeak, (text: string, messageId: string) => {
    speakAsAgent(prepareMessageForSpeech(text), messageId, profileForMessage(messageId));
  });
  registerHook(HOOKS.audioStop, () => stop());
  // Call mode: speak the reply sentence by sentence while it is still being written.
  registerHook(HOOKS.audioOnStreamingToken, (answerSoFar: string) => onStreamToken(answerSoFar));
  registerHook(HOOKS.audioOnStreamingEnd, (conversationId: string) => {
    const voiceMode = useUiModeStore.getState().interfaceMode === 'audio';
    if (voiceMode) {
      const whole = () => {
        const conv = (useChatStore.getState() as any).conversations?.find((c: any) => c.id === conversationId);
        const last = conv?.messages?.[conv.messages.length - 1];
        if (last?.role === 'assistant' && last.content?.trim()) speakAsAgent(prepareMessageForSpeech(last.content), last.id, profileForConversation(conversationId));
      };
      if (finishStreamSpeech(conversationId, whole)) return;
    }
    if (!voiceMode && !useAtlasVoiceStore.getState().autoSpeakInChat) return;
    const conv = (useChatStore.getState() as any).conversations?.find((c: any) => c.id === conversationId);
    const last = conv?.messages?.[conv.messages.length - 1];
    if (!last || last.role !== 'assistant' || !last.content?.trim()) {
      // Nothing to read out: still let hands-free mode reopen the mic.
      if (voiceMode && useAtlasVoiceStore.getState().handsFree) setTimeout(() => useAtlasVoiceStore.getState().markDone(), 300);
      return;
    }
    speakAsAgent(prepareMessageForSpeech(last.content), last.id, profileForConversation(conversationId));
  });
  registerHook(HOOKS.audioAugmentPrompt, (base: string) =>
    useUiModeStore.getState().interfaceMode === 'audio'
      ? `${base}\n\n${VOICE_CALL_STYLE}`
      : base,
  );
  registerSlot(SLOTS.chatInputAudioMode, AtlasAudioInput);
  registerSlot(SLOTS.chatInputModeToggle, AtlasModeToggle);
  registerSlot(SLOTS.messageSpeakButton, AtlasSpeakButton);
  registerSlot(SLOTS.modelsScreenVoiceTab, AtlasVoicePanel);
}
