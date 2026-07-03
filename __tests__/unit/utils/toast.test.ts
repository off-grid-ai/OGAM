import { Platform, ToastAndroid, Alert } from 'react-native';
import { showToast } from '../../../src/utils/toast';

const originalOS = Platform.OS;

afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

describe('showToast', () => {
  it('uses the native toast on Android', () => {
    Platform.OS = 'android';
    const spy = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    showToast('hello');

    expect(spy).toHaveBeenCalledWith('hello', ToastAndroid.SHORT);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('falls back to an alert on iOS (no native toast)', () => {
    Platform.OS = 'ios';
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const toastSpy = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});

    showToast('hello');

    expect(alertSpy).toHaveBeenCalledWith('', 'hello');
    expect(toastSpy).not.toHaveBeenCalled();
  });
});
