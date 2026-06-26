/**
 * KokoroTTSBridge tests — mount gating + delete regression.
 *
 * Regression for the bug where tapping "Remove voice model" silently
 * re-downloaded Kokoro: the outer bridge's shouldLoad flag was one-way (only
 * ever set true), so after a delete the executorch useTextToSpeech hook stayed
 * mounted with preventLoad=false, saw the files gone, and re-fetched the model.
 *
 * The fix makes shouldLoad authoritative (false when the model is absent) and
 * unmounts the inner hook entirely when not loaded — which also frees the
 * ~82 MB model. The executorch hook mock reports isReady immediately, so a
 * mounted inner attaches the bridge and the engine phase becomes 'ready';
 * unmounted, it falls back to 'idle'.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { AudioContext, AudioManager } from 'react-native-audio-api';
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';
import { KokoroEngine } from '../../../pro/audio/engine/tts/engines/kokoro/KokoroEngine';
import { useTTSStore } from '../../../pro/audio/ttsStore';

const listDownloadedModels = BareResourceFetcher.listDownloadedModels as jest.Mock;
const KOKORO_FILES = ['duration_predictor.pte', 'synthesizer.pte'];
const onDisk = () => [`/x/${KOKORO_FILES[0]}`, `/x/${KOKORO_FILES[1]}`];

const setDownloadedFlag = (v: boolean) =>
  useTTSStore.setState((s) => ({
    settings: { ...s.settings, modelDownloaded: { ...s.settings.modelDownloaded, kokoro: v } },
  }));

describe('KokoroTTSBridge mount gating', () => {
  beforeEach(() => {
    listDownloadedModels.mockReset().mockResolvedValue([]);
    setDownloadedFlag(false);
  });

  it('does NOT mount the executorch hook when the model is not downloaded', async () => {
    const engine = new KokoroEngine();
    const Bridge = engine.getBridgeComponent() as React.FC;
    render(<Bridge />);
    await act(async () => { await Promise.resolve(); });
    // Inner never mounted → bridge never attached → engine stays idle.
    expect(engine.getPhase()).toBe('idle');
  });

  it('mounts the hook and becomes ready when the model is downloaded', async () => {
    listDownloadedModels.mockResolvedValue(onDisk());
    setDownloadedFlag(true);
    const engine = new KokoroEngine();
    const Bridge = engine.getBridgeComponent() as React.FC;
    render(<Bridge />);
    await waitFor(() => expect(engine.getPhase()).toBe('ready'));
  });

  it('REGRESSION: deleting unmounts the hook (no auto re-download)', async () => {
    listDownloadedModels.mockResolvedValue(onDisk());
    setDownloadedFlag(true);
    const engine = new KokoroEngine();
    const Bridge = engine.getBridgeComponent() as React.FC;
    render(<Bridge />);
    await waitFor(() => expect(engine.getPhase()).toBe('ready'));

    // Delete: the engine clears its on-disk/progress state, and the store flag
    // flips false. Before the fix, shouldLoad stayed true and the hook re-fetched.
    await act(async () => {
      await engine.deleteAssets();
      listDownloadedModels.mockResolvedValue([]);
      setDownloadedFlag(false);
    });

    // shouldLoad resolves false → inner unmounts → bridge detaches → idle.
    await waitFor(() => expect(engine.getPhase()).toBe('idle'));
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  // Regression for the iOS-silent bug: react-native-audio-api does not
  // auto-activate an AVAudioSession, and a fresh AudioContext starts suspended.
  // Without activating a playback session AND resuming the context, scheduled
  // buffers never play (silent, no progress, button stuck on pause).
  it('speak() activates an iOS playback session and resumes a suspended context', async () => {
    listDownloadedModels.mockResolvedValue(onDisk());
    setDownloadedFlag(true);
    const engine = new KokoroEngine();
    const Bridge = engine.getBridgeComponent() as React.FC;
    render(<Bridge />);
    await waitFor(() => expect(engine.getPhase()).toBe('ready'));

    await act(async () => { await engine.speak('hello'); });

    expect(AudioManager.setAudioSessionOptions).toHaveBeenCalledWith(
      expect.objectContaining({ iosCategory: 'playback' }),
    );
    expect(AudioManager.setAudioSessionActivity).toHaveBeenCalledWith(true);
    // The context created for playback starts 'suspended' and must be resumed.
    const ctx = (AudioContext as jest.Mock).mock.results.at(-1)?.value;
    expect(ctx.resume).toHaveBeenCalled();
  });
});
