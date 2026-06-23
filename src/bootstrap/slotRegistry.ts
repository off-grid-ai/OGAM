import type { ComponentType } from 'react';

/**
 * Component-slot seam. Pro features register UI components against named slots
 * during activation; core renders whatever is registered and renders nothing
 * (its own fallback) when a slot is empty. This lets the private pro package
 * inject UI into core screens without core ever importing pro — free builds
 * leave every slot empty and behave exactly as before.
 *
 * Slot names are plain strings (see SLOTS below for the known set). Props are
 * passed through untyped on purpose: each slot documents its own prop shape and
 * the registering component declares it.
 */
const slots: Record<string, ComponentType<any>> = {};

export function registerSlot(name: string, component: ComponentType<any>): void {
  slots[name] = component;
}

export function getSlot(name: string): ComponentType<any> | undefined {
  return slots[name];
}

export function _clearSlotsForTesting(): void {
  for (const key of Object.keys(slots)) {
    delete slots[key];
  }
}

/** Known slot names, centralised so core and pro stay in sync. */
export const SLOTS = {
  /** Always-mounted root component(s) rendered near the app root (e.g. the TTS
   *  engine bridge). Mounted regardless of screen. */
  appRoot: 'app.root',
  /** Replaces the chat input row when audio (voice) interface mode is active. */
  chatInputAudioMode: 'chatInput.audioMode',
  /** Voice-mode empty-state hero (big "tap to speak" mic) shown in the message
   *  area when an audio conversation has no messages yet. */
  chatEmptyAudio: 'chatEmpty.audio',
  /** Renders a chat message in audio mode (user/assistant bubbles, thinking,
   *  streaming) — owns the whole audio-mode message presentation. */
  messageAudioMode: 'message.audioMode',
  /** Per-message meta-row control (the TTS speak/play button) in chat mode. */
  messageSpeakButton: 'message.speakButton',
  /** Extra row in the chat-input quick-settings popover (voice mode toggle). */
  quickSettingsAudioRow: 'quickSettings.audioRow',
  /** One-tap Chat↔Audio interface toggle in the chat-input pill icon row.
   *  Mirrors the Audio-mode "back to chat" button so the switch is reachable
   *  directly from the bar (not only via the quick-settings popover). */
  chatInputModeToggle: 'chatInput.modeToggle',
  /** The "Text to Speech" body in the Chat Settings modal (TTS section). */
  generationSettingsTts: 'generationSettings.tts',
  /** Body of the "Voice" tab on the Models screen (TTS engine model
   *  download/management). The tab itself only appears when this is
   *  registered, so free builds show just Text/Image. */
  modelsScreenVoiceTab: 'modelsScreen.voiceTab',
} as const;
