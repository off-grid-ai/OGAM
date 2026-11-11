/** The version shown in Settings and About is the installed app's, build number included. */
describe('appVersionLabel', () => {
  afterEach(() => jest.resetModules());

  it('shows the version of the installed build, with its build number', () => {
    jest.doMock('react-native-device-info', () => ({ getVersion: () => '0.0.105 (build 93)' }));
    expect(require('../../src/utils/appVersion').appVersionLabel()).toBe('0.0.105 (build 93)');
  });

  it('falls back to the packaged version when the device cannot report one', () => {
    jest.doMock('react-native-device-info', () => ({ getVersion: () => { throw new Error('no native module'); } }));
    expect(require('../../src/utils/appVersion').appVersionLabel()).toBe(require('../../package.json').version);
  });
});
