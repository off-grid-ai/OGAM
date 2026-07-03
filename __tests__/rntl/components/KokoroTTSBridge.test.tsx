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
import { useTextToSpeech } from 'react-native-executorch';
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';
import { KokoroEngine } from '../../../pro/audio/engine/tts/engines/kokoro/KokoroEngine';
import { useTTSStore } from '../../../pro/audio/ttsStore';

const listDownloadedFiles = BareResourceFetcher.listDownloadedFiles as jest.Mock;
const KOKORO_FILES = ['duration_predictor.pte', 'synthesizer.pte', 'af_heart.bin', 'tagger.pt', 'lexicon.json'];
const onDisk = () => KOKORO_FILES.map((f) => `/x/${f}`);

const setDownloadedFlag = (v: boolean) =>
  useTTSStore.setState((s) => ({
    settings: { ...s.settings, modelDownloaded: { ...s.settings.modelDownloaded, kokoro: v } },
  }));

describe('KokoroTTSBridge mount gating', () => {
  beforeEach(() => {
    listDownloadedFiles.mockReset().mockResolvedValue([]);
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
    listDownloadedFiles.mockResolvedValue(onDisk());
    setDownloadedFlag(true);
    const engine = new KokoroEngine();
    const Bridge = engine.getBridgeComponent() as React.FC;
    render(<Bridge />);
    await waitFor(() => expect(engine.getPhase()).toBe('ready'));
  });

  it('REGRESSION: deleting unmounts the hook (no auto re-download)', async () => {
    listDownloadedFiles.mockResolvedValue(onDisk());
    setDownloadedFlag(true);
    const engine = new KokoroEngine();
    const Bridge = engine.getBridgeComponent() as React.FC;
    render(<Bridge />);
    await waitFor(() => expect(engine.getPhase()).toBe('ready'));

    // Delete: the engine clears its on-disk/progress state, and the store flag
    // flips false. Before the fix, shouldLoad stayed true and the hook re-fetched.
    await act(async () => {
      await engine.deleteAssets();
      listDownloadedFiles.mockResolvedValue([]);
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
    listDownloadedFiles.mockResolvedValue(onDisk());
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

  // Regression for the seekbar-frozen / button-resets-immediately bug: executorch's
  // tts.stream resolves at SYNTHESIS end (~100ms) having only SCHEDULED the audio
  // buffers, which then play for seconds. speak() must resolve at TRUE audio end (the
  // last buffer's onEnded), not at synthesis end — otherwise the engine reports
  // 'ready' and the playback machine goes idle while audio is still draining.
  it('REGRESSION: speak() resolves at audio end (last buffer onEnded), not at synthesis end', async () => {
    listDownloadedFiles.mockResolvedValue(onDisk());
    setDownloadedFlag(true);
    // Simulate executorch: synthesize a chunk, SCHEDULE it (do NOT await playback),
    // then end synthesis while the buffer is still "playing".
    const stream = jest.fn(async ({ onNext, onEnd }: any) => {
      onNext(new Float32Array(8)); // fire-and-forget — schedules a buffer (inflight++)
      await onEnd?.();             // synthesis complete; audio still playing
    });
    (useTextToSpeech as jest.Mock).mockReturnValue({ isReady: true, downloadProgress: 1, error: null, stream, streamStop: jest.fn() });

    const engine = new KokoroEngine();
    const Bridge = engine.getBridgeComponent() as React.FC;
    render(<Bridge />);
    await waitFor(() => expect(engine.getPhase()).toBe('ready'));

    let resolved = false;
    await act(async () => {
      const p = engine.speak('hello').then(() => { resolved = true; });
      // Let synthesis run to completion (stream resolves) but the buffer keep "playing".
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      // Synthesis ended, audio not done → speak must NOT have resolved; engine busy.
      expect(resolved).toBe(false);
      expect(engine.getPhase()).toBe('processing');
      // Fire the scheduled buffer's onEnded → audio truly done → speak resolves.
      const ctx = (AudioContext as jest.Mock).mock.results.at(-1)?.value;
      const src = ctx.createBufferSource.mock.results.at(-1)?.value;
      src.onEnded?.();
      await p;
    });
    expect(resolved).toBe(true);
    expect(engine.getPhase()).toBe('ready');
  });

  // Regression for the SAME bug from a different trigger: the bridge component
  // re-registers its handle on every executorch-hook re-render (which fires DURING
  // streaming). _setBridge used to force phase 'ready' unconditionally, resetting an
  // active playback (processing → ready) → the machine ended it early.
  it('REGRESSION: a bridge re-register mid-playback does not reset processing → ready', async () => {
    listDownloadedFiles.mockResolvedValue(onDisk());
    setDownloadedFlag(true);
    const stream = jest.fn(async ({ onNext, onEnd }: any) => {
      onNext(new Float32Array(8)); // schedule a buffer; keep it "playing"
      await onEnd?.();
    });
    (useTextToSpeech as jest.Mock).mockReturnValue({ isReady: true, downloadProgress: 1, error: null, stream, streamStop: jest.fn() });

    const engine = new KokoroEngine();
    const Bridge = engine.getBridgeComponent() as React.FC;
    render(<Bridge />);
    await waitFor(() => expect(engine.getPhase()).toBe('ready'));

    await act(async () => {
      engine.speak('hi'); // → processing; bridge.speak stays pending (buffer not ended)
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(engine.getPhase()).toBe('processing');
      // Simulate the executorch hook re-rendering → bridge re-registers its handle.
      const e = engine as any;
      e._setBridge(e._bridge, e._activeVoiceId);
      // Must NOT clobber the active playback.
      expect(engine.getPhase()).toBe('processing');
    });
  });
});
