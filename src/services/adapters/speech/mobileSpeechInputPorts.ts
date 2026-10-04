/** React Native microphone and transcription I/O for Shared's Speech application. */
import RNFS from 'react-native-fs';
import {
  readVoicePreferences,
  VOICE_SETTING_KEYS,
  type SpeechPlatformPorts,
  type VoicePreferences,
} from '@offgrid/application';
import { cleanTranscription } from '@offgrid/models';
import { audioRecorderService } from '../../audioRecorderService';
import { whisperService } from '../../whisperService';
import { prepareMessageForSpeech } from '../../../utils/messageContent';
import { trimWavSilence } from '../../wavTrimmer';
import { useAppStore } from '../../../stores';
import { useWhisperStore } from '../../../stores/whisperStore';
import { activeMobileRoute } from '../../modelServices/mobileLLMService';
import { transcribeRemoteMobileFile } from '../../modelServices/transcriptionGenerationAdapter';

function selectedTranscriptionModel() {
  return activeMobileRoute('transcription').model;
}

function selectedTranscriberReady(): boolean {
  try {
    const model = selectedTranscriptionModel();
    if (!model) return false;
    if (model.source === 'remote') return true;
    return (
      whisperService.isModelLoaded() &&
      whisperService.getLoadedModelPath() ===
        whisperService.getModelPath(model.id)
    );
  } catch {
    return false;
  }
}

export type MobileSpeechInputPorts = Pick<
  SpeechPlatformPorts,
  | 'microphone'
  | 'recordingFinalizer'
  | 'transcriber'
  | 'files'
  | 'clock'
  | 'cleanTranscript'
  | 'initialPreferences'
  | 'preferences'
>;

const persistedVoicePreferences = (): VoicePreferences => {
  const settings = useAppStore.getState().settings;
  return readVoicePreferences({
    [VOICE_SETTING_KEYS.turnMode]: settings.voiceTurnMode,
    [VOICE_SETTING_KEYS.silenceAfterSpeechMs]:
      settings.voiceSilenceAfterSpeechMs,
    [VOICE_SETTING_KEYS.speakerDrainMs]: settings.voiceSpeakerDrainMs,
    [VOICE_SETTING_KEYS.transcriptionLanguage]:
      useWhisperStore.getState().transcriptionLanguage,
  });
};

/** Native input adapters only. Shared owns recording and transcription policy. */
export const mobileSpeechInputPorts: MobileSpeechInputPorts = {
  get initialPreferences() {
    return persistedVoicePreferences();
  },
  preferences: {
    supported: [
      'turnMode',
      'silenceAfterSpeechMs',
      'speakerDrainMs',
      'transcriptionLanguage',
    ],
    async write(preferences) {
      useAppStore.getState().updateSettings({
        voiceTurnMode: preferences.turnMode,
        voiceSilenceAfterSpeechMs: preferences.silenceAfterSpeechMs,
        voiceSpeakerDrainMs: preferences.speakerDrainMs,
      });
      useWhisperStore
        .getState()
        .setTranscriptionLanguage(preferences.transcriptionLanguage);
    },
  },
  microphone: {
    start: () => audioRecorderService.startRecording(),
    async stop() {
      const recording = await audioRecorderService.stopRecording();
      return {
        path: recording.path,
        mime: 'audio/wav',
        durationSeconds: recording.durationSeconds,
        // Message audio is durable so a failed or cancelled decode can be retried.
        transient: false,
      };
    },
    cancel: () => audioRecorderService.cancelRecording(),
    onLevel: listener => audioRecorderService.onAudioLevel(listener),
    echoCancelled: () => audioRecorderService.isEchoCancelled(),
  },
  recordingFinalizer: {
    async finalize(recording, trim) {
      if (!recording.path) return recording;
      const trimmed = await trimWavSilence(
        recording.path,
        trim.frontSeconds,
        trim.tailSeconds,
      );
      if (!trimmed || recording.durationSeconds === undefined) return recording;
      return {
        ...recording,
        durationSeconds: Math.max(
          0,
          recording.durationSeconds - trim.frontSeconds - trim.tailSeconds,
        ),
      };
    },
  },
  transcriber: {
    ready: selectedTranscriberReady,
    async transcribe(source, options) {
      if (source.kind !== 'file') {
        throw new TypeError(
          'Mobile Speech transcription requires a file source.',
        );
      }
      const model = selectedTranscriptionModel();
      if (!model) throw new Error('No transcription model is selected.');
      const text =
        model.source === 'remote'
          ? await transcribeRemoteMobileFile(model, {
              fileUri: source.path,
              language: options.language,
              signal: options.signal,
            })
          : await whisperService.transcribeFileRaw(source.path, {
              language: options.language,
              signal: options.signal,
            });
      return { text };
    },
  },
  files: {
    remove: path => RNFS.unlink(path),
  },
  clock: {
    now: () => Date.now(),
    after(ms, callback) {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
  },
  cleanTranscript: cleanTranscription,
};

/**
 * Core has native speech input but no speech-output engine. Supplying the complete port keeps the
 * Shared speech application as the session and transcription owner in both core and Pro builds;
 * Pro replaces these unavailable output adapters with its native TTS implementation.
 */
export const mobileCoreSpeechPorts: SpeechPlatformPorts = {
  ...mobileSpeechInputPorts,
  synthesizer: {
    ready: () => false,
    async synthesize() {
      throw new Error('Speech output is not available.');
    },
  },
  playback: {
    async play() {
      throw new Error('Speech output is not available.');
    },
    stop: () => undefined,
  },
  cleanForSpeech: prepareMessageForSpeech,
  selection: {
    async readVoice() {
      return null;
    },
    async writeVoice(_voice, commitVoice) {
      commitVoice();
    },
  },
};
