/**
 * memorySnapshot unit tests
 *
 * logMemory() is a diagnostics probe used around whisper model load and each
 * transcribe chunk to capture the app's footprint. On iOS it surfaces whether
 * an apparent transcription "crash" was actually a jetsam low-memory kill.
 *
 * Guarantees under test:
 * - formats used/total in MB and a percentage
 * - never throws (a failing probe must not break the path it observes)
 * - no divide-by-zero when total memory is reported as 0
 */

import DeviceInfo from 'react-native-device-info';
import logger from '../../../src/utils/logger';
import { logMemory } from '../../../src/utils/memorySnapshot';

const mockedDeviceInfo = DeviceInfo as jest.Mocked<typeof DeviceInfo>;

describe('logMemory', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(logger, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('logs used/total in MB with a percentage, tagged with the call site', async () => {
    mockedDeviceInfo.getUsedMemory.mockResolvedValue(1.4 * 1024 * 1024 * 1024);
    mockedDeviceInfo.getTotalMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);

    await logMemory('whisper:beforeLoad');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const msg = logSpy.mock.calls[0][0] as string;
    expect(msg).toContain('[mem] whisper:beforeLoad');
    expect(msg).toContain('used=1434MB');
    expect(msg).toContain('total=4096MB');
    expect(msg).toContain('(35%)');
  });

  it('never throws and warns when the probe fails', async () => {
    mockedDeviceInfo.getUsedMemory.mockRejectedValue(new Error('boom'));
    mockedDeviceInfo.getTotalMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);

    await expect(logMemory('transcribe:chunk@0s')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('snapshot failed'));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('does not divide by zero when total memory is unavailable', async () => {
    mockedDeviceInfo.getUsedMemory.mockResolvedValue(100 * 1024 * 1024);
    mockedDeviceInfo.getTotalMemory.mockResolvedValue(0);

    await logMemory('zero');

    const msg = logSpy.mock.calls[0][0] as string;
    expect(msg).toContain('total=0MB');
    expect(msg).toContain('(0%)');
  });
});
