/**
 * The pack port: the native BundledModel module on Android, and no packs anywhere else. The boundary is
 * the native module (its promises and its event stream).
 */
type Port = typeof import('../../../../src/services/bundledModel/port')['bundledModelPort'];

function loadPort(os: 'android' | 'ios', native?: Record<string, jest.Mock>): Port {
  jest.resetModules();
  const rn = require('react-native');
  rn.Platform.OS = os;
  rn.NativeModules.BundledModel = native;
  return require('../../../../src/services/bundledModel/port').bundledModelPort;
}

afterEach(() => {
  const rn = require('react-native');
  delete rn.NativeModules.BundledModel;
});

describe('bundledModelPort', () => {
  it('on Android asks the native module and forwards its pack events', async () => {
    const state = { name: 'chat_model', status: 'downloading', bytesDownloaded: 5, totalBytes: 10, errorCode: 0, assetsPath: null };
    const native = {
      getPacks: jest.fn(async () => ({ chat_model: state })),
      fetch: jest.fn(async () => ({ chat_model: state })),
      removePack: jest.fn(async () => true),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    const port = loadPort('android', native);
    const names = ['chat_model'] as const;
    expect(await port.getPacks(names)).toEqual({ chat_model: state });
    expect(await port.fetch(names)).toEqual({ chat_model: state });
    expect(await port.removePack('chat_model')).toBe(true);
    expect(native.getPacks).toHaveBeenCalledWith(['chat_model']);

    const seen: unknown[] = [];
    const stop = port.onPack(s => seen.push(s));
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('BundledModelPack', state);
    stop();
    DeviceEventEmitter.emit('BundledModelPack', { ...state, bytesDownloaded: 9 });
    expect(seen).toEqual([state]);
  });

  it('with no native module (iOS until its pack lands) no pack ever comes', async () => {
    const port = loadPort('ios');
    expect(await port.getPacks(['chat_model'])).toEqual({
      chat_model: { name: 'chat_model', status: 'not_installed', bytesDownloaded: 0, totalBytes: 0, errorCode: 0, assetsPath: null },
    });
    expect((await port.fetch(['chat_mmproj'])).chat_mmproj.status).toBe('not_installed');
    expect(await port.removePack('chat_model')).toBe(false);
    const stop = port.onPack(() => {});
    expect(stop()).toBeUndefined();
  });
});
