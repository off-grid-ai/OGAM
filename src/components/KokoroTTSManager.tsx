/**
 * KokoroTTSManager
 *
 * Mounts the react-native-executorch useTextToSpeech hook and exposes its
 * speak/stop methods via module-level refs so they can be called from the
 * ttsStore without a React context dependency.
 *
 * Mount exactly once, near the root (App.tsx), only on supported platforms.
 * On Android <26 / iOS <17 this component should not be rendered at all.
 *
 * Voice changes use a key-based remount strategy: the outer component manages
 * voice switching with a cooldown, then remounts the inner component with a new
 * key so executorch gets a clean teardown/init cycle (avoids native SIGSEGV).
 */
import React, { useEffect, useRef } from 'react';
import { useTextToSpeech } from 'react-native-executorch';
import { AudioContext } from 'react-native-audio-api';
import { useTTSStore } from '../stores/ttsStore';
import { KOKORO_MEDIUM, getKokoroVoiceConfig } from '../constants/kokoroModels';
import type { KokoroVoiceId } from '../constants/kokoroModels';
import logger from '../utils/logger';

// ─── Module-level refs (callable from ttsStore without React context) ─────────

let _streamFn: ((text: string, speed: number) => Promise<void>) | null = null;
let _stopFn: ((instant?: boolean) => void) | null = null;
let _audioCtxRef: { current: AudioContext | null } = { current: null };
// Pending onNext resolvers — force-resolved on stop so isSpeaking is always cleared
const _pendingResolvers: Set<() => void> = new Set();
// When true, onEnd skips ctx.suspend() so the next chunk can start cleanly
let _skipSuspendOnEnd = false;
/** Timestamp of the last stream completion/stop — used by voice change cooldown */
let _lastStreamEndTime = 0;

export const kokoroRef = {
  speak: (text: string, speed = 1.0): Promise<void> =>
    _streamFn ? _streamFn(text, speed) : Promise.resolve(),
  /** Call before sequential chunks to prevent AudioContext suspension between them */
  setKeepAlive: (keepAlive: boolean) => { _skipSuspendOnEnd = keepAlive; },
  stop: (instant = true) => {
    _pendingResolvers.forEach((resolve) => resolve());
    _pendingResolvers.clear();
    _stopFn?.(instant);
    _lastStreamEndTime = Date.now();
  },
  /** Pause playback — suspends AudioContext, Kokoro waits for onNext to resolve */
  pause: () => { _audioCtxRef.current?.suspend().catch(() => {}); },
  /** Resume playback — AudioContext resumes, current chunk finishes, Kokoro continues */
  resume: () => { _audioCtxRef.current?.resume().catch(() => {}); },
};

// ─── Inner component — holds the useTextToSpeech hook for a single voice ─────

const KokoroTTSInner: React.FC<{ voiceId: KokoroVoiceId }> = ({ voiceId }) => {
  const audioCtxRef = useRef<AudioContext | null>(null);
  _audioCtxRef = audioCtxRef;

  const tts = useTextToSpeech({
    model: KOKORO_MEDIUM,
    voice: getKokoroVoiceConfig(voiceId),
  });

  // Sync isReady + downloadProgress into ttsStore
  useEffect(() => {
    logger.log('[Kokoro] isReady=', tts.isReady, 'downloadProgress=', tts.downloadProgress, 'voiceId=', voiceId);
    useTTSStore.getState().setKokoroState(tts.isReady, tts.downloadProgress);
    if (tts.isReady) {
      logger.log('[Kokoro] Setting kokoroActiveVoiceId to', voiceId);
      useTTSStore.getState().setKokoroActiveVoiceId(voiceId);
    }
  }, [tts.isReady, tts.downloadProgress, voiceId]);

  useEffect(() => {
    if (tts.error) {
      logger.warn('[Kokoro] Runtime error — falling back to OuteTTS:', tts.error);
      useTTSStore.getState().setKokoroState(false, 0);
    }
  }, [tts.error]);

  // Keep module refs pointing to the latest hook functions on every render
  _streamFn = async (text: string, speed: number) => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext({ sampleRate: 24000 });
    } else if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume().catch(() => {});
    }
    const ctx = audioCtxRef.current;

    try {
      await tts.stream({
        text,
        speed,
        onNext: (chunk: Float32Array) =>
          new Promise<void>((resolve) => {
            _pendingResolvers.add(resolve);
            const done = () => { _pendingResolvers.delete(resolve); resolve(); };
            useTTSStore.getState().setAudioPlaying(true);
            const currentSpeed = useTTSStore.getState().settings.speed;
            const buffer = ctx.createBuffer(1, chunk.length, 24000);
            buffer.copyToChannel(chunk, 0);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = currentSpeed;
            source.connect(ctx.destination);
            source.onEnded = done;
            source.start();
          }),
        onEnd: async () => {
          if (!_skipSuspendOnEnd) {
            await ctx.suspend().catch(() => {});
          }
        },
      });
    } catch (err) {
      logger.error('[Kokoro] stream error:', err);
      throw err;
    }
  };

  _stopFn = (instant = true) => {
    tts.streamStop(instant);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  };

  // Clear refs on unmount so stale closures don't fire during voice switch
  useEffect(() => {
    return () => {
      logger.log('[Kokoro] Inner unmounting, clearing refs');
      _streamFn = null;
      _stopFn = null;
    };
  }, []);

  return null;
};

// ─── Outer component — manages voice switching via key-based remount ─────────

export const KokoroTTSManager: React.FC = () => {
  const kokoroVoiceId = useTTSStore(s => s.settings.kokoroVoiceId) as KokoroVoiceId;
  const isSpeaking = useTTSStore(s => s.isSpeaking);

  // activeVoiceId controls which voice the inner component is mounted with.
  // Changed only after a cooldown to give executorch time to clean up.
  const [activeVoiceId, setActiveVoiceId] = React.useState(kokoroVoiceId);
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    logger.log('[Kokoro] Voice effect: kokoroVoiceId=', kokoroVoiceId, 'activeVoiceId=', activeVoiceId, 'isSpeaking=', isSpeaking);
    if (isSpeaking || kokoroVoiceId === activeVoiceId) {
      if (cooldownRef.current) { clearTimeout(cooldownRef.current); cooldownRef.current = null; }
      return;
    }
    const elapsed = Date.now() - _lastStreamEndTime;
    const waitMs = Math.max(100, 2000 - elapsed);
    logger.log('[Kokoro] Starting voice change cooldown:', waitMs, 'ms');
    // Mark Kokoro as not ready during the switch so UI shows loader
    useTTSStore.getState().setKokoroState(false, 0);
    cooldownRef.current = setTimeout(() => {
      logger.log('[Kokoro] Cooldown done, remounting with voice', kokoroVoiceId);
      setActiveVoiceId(kokoroVoiceId);
      cooldownRef.current = null;
    }, waitMs);
    return () => { if (cooldownRef.current) { clearTimeout(cooldownRef.current); cooldownRef.current = null; } };
  }, [kokoroVoiceId, isSpeaking, activeVoiceId]);

  // Key-based remount: when activeVoiceId changes, the inner component
  // fully unmounts (executorch teardown) then remounts (fresh init).
  return <KokoroTTSInner key={activeVoiceId} voiceId={activeVoiceId} />;
};
