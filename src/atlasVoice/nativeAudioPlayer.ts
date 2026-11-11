/**
 * Thin JS wrapper around the AtlasAudio native module (Android only).
 *
 * When the app goes to background on Android the React Native JS thread pauses,
 * so the in-process AudioContext player (podcastAudio.ts) stops mid-line.
 * This module hands a full file queue to a native MediaPlayer foreground service
 * that keeps playing even when the app is backgrounded.
 *
 * Usage:
 *   isAvailable()       — true on Android when the native module is loaded
 *   play(files, opts)   — start playing a list of WAV file paths
 *   stop()              — stop immediately
 *   onProgress(fn)      — called with the current file index as each line starts
 *   onFinished(fn)      — called once the last file completes
 *   onError(fn)         — called with an error message on failure
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { AtlasAudio } = NativeModules;
const emitter = AtlasAudio ? new NativeEventEmitter(AtlasAudio) : null;

export function isAvailable(): boolean {
  return Platform.OS === 'android' && !!AtlasAudio;
}

export interface PlayOptions {
  startIndex?: number;
  speed?: number;
  volume?: number;
}

export function play(files: string[], opts: PlayOptions = {}): void {
  if (!isAvailable()) throw new Error('Native audio player not available on this platform');
  AtlasAudio.play(files, opts.startIndex ?? 0, opts.speed ?? 1.0, opts.volume ?? 1.0);
}

export function stop(): void {
  if (!isAvailable()) return;
  AtlasAudio.stop();
}

type ProgressListener = (index: number) => void;
type FinishedListener = () => void;
type ErrorListener = (message: string) => void;

export function onProgress(fn: ProgressListener): () => void {
  if (!emitter) return () => undefined;
  const sub = emitter.addListener('AtlasAudioProgress', (e: { index: number }) => fn(e.index));
  return () => sub.remove();
}

export function onFinished(fn: FinishedListener): () => void {
  if (!emitter) return () => undefined;
  const sub = emitter.addListener('AtlasAudioFinished', () => fn());
  return () => sub.remove();
}

export function onError(fn: ErrorListener): () => void {
  if (!emitter) return () => undefined;
  const sub = emitter.addListener('AtlasAudioError', (e: { message: string }) => fn(e.message));
  return () => sub.remove();
}
