/**
 * audioCoordinator.resetForEngineLoss — when the TTS engine is released mid-stream, a
 * voice switch applying on it can never complete. The coordinator must clear it now
 * (via the owner's own cancelVoiceSwitch) rather than leaving the picker spinner stuck
 * until the 45s timeout.
 */
import { resetForEngineLoss } from '../../../pro/audio/audioCoordinator';
import { useTTSStore } from '../../../pro/audio/ttsStore';

describe('resetForEngineLoss', () => {
  it('cancels an in-flight voice switch on engine loss', () => {
    useTTSStore.setState({ isSwitchingVoice: true } as never);
    resetForEngineLoss('engine wedged');
    expect(useTTSStore.getState().isSwitchingVoice).toBe(false);
  });

  it('is a no-op when no voice switch is in flight', () => {
    useTTSStore.setState({ isSwitchingVoice: false } as never);
    resetForEngineLoss('engine wedged');
    expect(useTTSStore.getState().isSwitchingVoice).toBe(false);
  });
});
