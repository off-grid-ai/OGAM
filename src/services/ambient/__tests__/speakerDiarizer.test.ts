/**
 * dispatchDiarize must never hand a missing recording path to an engine — the Mac upload turns that
 * into an uncaught native multipart error that crashes the app. It also prefers the asked engine and
 * falls back on failure.
 */
import RNFS from 'react-native-fs';
import { dispatchDiarize } from '../speakerDiarizer';

const phoneDiarize = jest.fn(async () => ({ turns: [] }));
const macDiarize = jest.fn(async () => ({ turns: [] }));
const deps = { phone: { diarize: phoneDiarize }, mac: { diarize: macDiarize } };

beforeEach(() => {
  jest.clearAllMocks();
  (RNFS.exists as jest.Mock).mockResolvedValue(true);
});

it('returns null without touching any engine when the recording file is gone', async () => {
  (RNFS.exists as jest.Mock).mockResolvedValue(false);
  const result = await dispatchDiarize('/gone/rec.wav', deps, 'mac');
  expect(result).toBeNull();
  expect(macDiarize).not.toHaveBeenCalled();
  expect(phoneDiarize).not.toHaveBeenCalled();
});

it('runs the preferred engine when the file exists', async () => {
  const result = await dispatchDiarize('/ok/rec.wav', deps, 'mac');
  expect(macDiarize).toHaveBeenCalledWith('/ok/rec.wav');
  expect(result).toEqual({ turns: [] });
});

it('falls back to the phone engine when the Mac engine throws', async () => {
  macDiarize.mockRejectedValueOnce(new Error('mac offload failed'));
  await dispatchDiarize('/ok/rec.wav', deps, 'mac');
  expect(macDiarize).toHaveBeenCalled();
  expect(phoneDiarize).toHaveBeenCalledWith('/ok/rec.wav');
});
