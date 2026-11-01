/**
 * The microphone as whisper.rn's realtime transcriber reads it: the recorder's own buffers, as 16-bit
 * PCM. Only the device microphone (react-native-audio-api's AudioRecorder) is faked.
 */
import { Platform } from 'react-native';
import { AudioRecorder } from 'react-native-audio-api';
import { audioRecorderService } from '../../../src/services/audioRecorderService';
import { RecorderAudioStream, toPcm16 } from '../../../src/services/recorderAudioStream';

type BufferEvent = { buffer?: { getChannelData?: (i: number) => Float32Array }; numFrames?: number };

/** The device microphone: each recorder's buffer callback, driven by the test. */
function installMicrophone() {
  const mic = { deliver: (_samples: Float32Array) => {} };
  (AudioRecorder as unknown as jest.Mock).mockImplementation(() => ({
    enableFileOutput: jest.fn(() => ({ status: 'success' })),
    start: jest.fn(() => ({ status: 'success' })),
    stop: jest.fn(() => ({ status: 'success', path: '/mock/audio/input.wav', duration: 1 })),
    isRecording: jest.fn(() => true),
    onAudioReady: jest.fn((_options: unknown, callback: (event: BufferEvent) => void) => {
      mic.deliver = samples =>
        callback({ buffer: { getChannelData: () => samples }, numFrames: samples.length });
    }),
    clearOnAudioReady: jest.fn(() => {
      mic.deliver = () => {};
    }),
  }));
  return mic;
}

const pcmOf = (data: Uint8Array) => Array.from(new Int16Array(data.buffer));

describe('the microphone as whisper.rn reads it', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
  });

  afterEach(() => {
    audioRecorderService.cancelRecording();
    Object.defineProperty(Platform, 'OS', { get: () => originalOS });
  });

  it('turns float samples into clipped 16-bit PCM', () => {
    expect(pcmOf(toPcm16(new Float32Array([0, 1, -1, 0.5, 2, -2])))).toEqual([
      0, 32767, -32768, 16383, 32767, -32768,
    ]);
  });

  it('hands the recording\'s buffers to the transcriber only while the stream runs', async () => {
    const mic = installMicrophone();
    await audioRecorderService.startRecording();
    const stream = new RecorderAudioStream();
    const onData = jest.fn();
    const onStatus = jest.fn();
    stream.onData(onData);
    stream.onStatusChange(onStatus);
    stream.onError();
    await stream.initialize();

    await stream.start();
    await stream.start(); // a second start keeps the one subscription
    expect(stream.isRecording()).toBe(true);
    mic.deliver(new Float32Array([0.5, -0.5]));
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData.mock.calls[0][0]).toEqual(
      expect.objectContaining({ sampleRate: 16000, channels: 1 }),
    );
    expect(pcmOf(onData.mock.calls[0][0].data)).toEqual([16383, -16384]);

    await stream.stop();
    await stream.stop(); // stopping twice is harmless
    mic.deliver(new Float32Array([0.5]));
    expect(onData).toHaveBeenCalledTimes(1);
    expect(stream.isRecording()).toBe(false);
    expect(onStatus.mock.calls).toEqual([[true], [false]]);
  });

  it('starts hearing a recording that begins after the stream', async () => {
    const mic = installMicrophone();
    const stream = new RecorderAudioStream();
    const onData = jest.fn();
    stream.onData(onData);
    await stream.start();

    await audioRecorderService.startRecording();
    mic.deliver(new Float32Array([0.25]));

    expect(onData).toHaveBeenCalledTimes(1);
    await stream.release();
    expect(stream.isRecording()).toBe(false);
  });

  it('keeps the level meter running when the transcriber stops listening', async () => {
    const mic = installMicrophone();
    await audioRecorderService.startRecording();
    const levels: number[] = [];
    const stopLevels = audioRecorderService.onAudioLevel(rms => levels.push(rms));
    const stream = new RecorderAudioStream();
    await stream.start();

    await stream.stop();
    mic.deliver(new Float32Array([0.5, 0.5]));
    expect(levels).toEqual([0.5]);

    stopLevels();
    mic.deliver(new Float32Array([0.5, 0.5]));
    expect(levels).toEqual([0.5]);
  });

  it('keeps feeding other listeners when one throws', async () => {
    const mic = installMicrophone();
    await audioRecorderService.startRecording();
    const stopBroken = audioRecorderService.onAudioSamples(() => {
      throw new Error('bad listener');
    });
    const heard: number[] = [];
    const stopGood = audioRecorderService.onAudioSamples(samples => heard.push(samples.length));

    mic.deliver(new Float32Array([0.1, 0.2, 0.3]));

    expect(heard).toEqual([3]);
    stopBroken();
    stopGood();
  });
});
