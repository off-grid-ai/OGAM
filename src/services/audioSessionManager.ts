/**
 * AudioSessionManager — the single owner of the iOS AVAudioSession.
 *
 * Before this existed, the session was configured from two unrelated places (the
 * recorder set `playAndRecord`, the Kokoro TTS bridge set `playback`) with no
 * coordination and no restore, so whichever ran last decided the category — which
 * is why playback was sometimes silent (a `record`-only or stale session routes
 * AudioContext output nowhere on iOS). Every code path that needs the session now
 * goes through here, so there is exactly one owner of its category + activation.
 *
 * iOS-only: on Android there is no equivalent session to manage, so every method
 * is a no-op (the platform routes audio without app-level session activation).
 *
 * See docs/design/AUDIO_PLAYBACK_SERVICE.md.
 */
import { Platform } from 'react-native';
import { AudioManager } from 'react-native-audio-api';
import logger from '../utils/logger';

type AudioSessionMode = 'playback' | 'record';

class AudioSessionManager {
  /** The category currently applied to the AVAudioSession (null = never set). */
  private mode: AudioSessionMode | null = null;

  /** Serializes the check-then-apply of every session op so a mode guard is never
   *  evaluated against a stale value. Without this, a concurrent ensurePlayback +
   *  ensureRecording both read the old `mode`, both call apply(), and whichever
   *  setAudioSessionActivity resolves last silently wins the category — exactly the
   *  "last writer decides" race this owner exists to eliminate. */
  private queue: Promise<unknown> = Promise.resolve();
  private runSerial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {}); // never let a rejection wedge the chain
    return next;
  }

  /** The mode last applied (testing/diagnostics). */
  getMode(): AudioSessionMode | null {
    return this.mode;
  }

  /**
   * Ensure a playback-capable session is active before any audio is scheduled.
   * (Re)asserts the playback session on EVERY call — iOS can deactivate the
   * session between operations, and the audio engines relied on per-call
   * re-activation, so this is intentionally NOT idempotent on activation. The one
   * exception: an active recording session is left untouched (`playAndRecord`
   * already permits playback, so we must not downgrade mid-record).
   */
  async ensurePlayback(): Promise<void> {
    if (Platform.OS !== 'ios') return;
    await this.runSerial(async () => {
      if (this.mode === 'record') return; // checked inside the serialized block → not stale
      await this.apply('playback');
    });
  }

  /** Ensure a record+playback session is active before recording starts.
   *  (Re)asserts every call, matching the recorder's prior per-start activation. */
  async ensureRecording(): Promise<void> {
    if (Platform.OS !== 'ios') return;
    await this.runSerial(() => this.apply('record'));
  }

  /**
   * Configure a record+playback session for the iOS realtime-transcription path
   * AND surface the result (this is also what triggers the iOS mic-permission
   * prompt — activating a record session prompts on first use).
   *
   * This exists so the realtime STT path no longer talks to whisper.rn's
   * AudioSessionIos directly: doing so set the category/active flag WITHOUT
   * updating this owner's `mode`, so a later TTS ensurePlayback() saw a stale
   * `mode` and could make the wrong session decision (silent TTS after STT).
   * Routing through here keeps `mode` authoritative.
   *
   * Returns true if the session activated (permission effectively granted), false
   * if activation threw (treated as permission denied by the caller). Behaviour
   * matches `ensureRecording` (same category/options, per-call re-activation); it
   * only differs in surfacing success/failure as a boolean for the permission gate.
   * iOS-only: returns true on Android (no session to manage; the caller handles
   * Android permission via PermissionsAndroid).
   */
  async ensureRecordingPermission(): Promise<boolean> {
    if (Platform.OS !== 'ios') return true;
    // Returns whether the record session activated; a throw on activation is how
    // iOS surfaces a denied mic permission, so false === denied here (matching the
    // old whisperService.requestPermissions, which returned false on setActive throw).
    return this.runSerial(() => this.apply('record'));
  }

  /**
   * Restore a playback-only session after recording ends. Recording raises the
   * category to `playAndRecord`; without restoring it, later playback would run
   * against a record session. No-op if we weren't recording.
   */
  async restorePlaybackAfterRecording(): Promise<void> {
    if (Platform.OS !== 'ios') return;
    await this.runSerial(async () => {
      if (this.mode !== 'record') return; // checked inside the serialized block → not stale
      await this.apply('playback');
    });
  }

  /**
   * Release the iOS AVAudioSession so a native modal that grabs audio/hardware — the
   * camera / photo picker — can present without a conflict. Device 2026-07-15: opening
   * the image picker in VOICE MODE, while the playback session was active, hung the app
   * completely (main thread wedged on the audio-route handoff; you could not even
   * navigate back). Deactivating first avoids the collision; TTS/recording re-assert the
   * session on their next call (ensurePlayback re-activates on EVERY call), so no explicit
   * restore is needed. iOS-only; no-op on Android (and harmless if nothing was active).
   */
  async deactivate(): Promise<void> {
    if (Platform.OS !== 'ios') return;
    await this.runSerial(async () => {
      try {
        await AudioManager.setAudioSessionActivity(false);
        this.mode = null;
        logger.log('[TTS-SM] iOS session deactivated (native-modal handoff)');
      } catch (e) {
        logger.warn('[AudioSession] failed to deactivate', e instanceof Error ? e.message : String(e));
      }
    });
  }

  /** @returns true if the session activated, false if activation threw (swallowed). */
  private async apply(mode: AudioSessionMode): Promise<boolean> {
    // Part of the [TTS-SM] trace: a silent/wrong AVAudioSession is a top cause of
    // "audio plays but nothing comes out" on iOS, so every (re)assert is logged.
    logger.log(`[TTS-SM] iOS session apply → ${mode} (was ${this.mode ?? 'none'})`);
    try {
      if (mode === 'playback') {
        AudioManager.setAudioSessionOptions({ iosCategory: 'playback', iosMode: 'default' });
      } else {
        AudioManager.setAudioSessionOptions({
          iosCategory: 'playAndRecord',
          iosMode: 'default',
          iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
        });
      }
      await AudioManager.setAudioSessionActivity(true);
      this.mode = mode;
      return true;
    } catch (e) {
      // Non-fatal: a failed activation shouldn't crash playback/recording. The
      // caller proceeds; worst case is the pre-existing silent-on-iOS behaviour.
      // (The recording-permission gate uses the return value to detect denial.)
      logger.warn('[AudioSession] failed to set', mode, e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** Test helper. */
  _reset(): void {
    this.mode = null;
  }
}

export const audioSessionManager = new AudioSessionManager();
