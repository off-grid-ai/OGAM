/**
 * Onboarding: steps through the flow, writes each choice to the store, requests the mic, and marks
 * setup done at the end. Store setters + permission + nav are mocked.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ replace: mockReplace }) };
});
jest.mock('../../../src/theme', () => {
  const colors = { background: '#000', text: '#fff', textMuted: '#999', textSecondary: '#bbb', surface: '#111', border: '#333', primary: '#34D399' };
  return { useTheme: () => ({ colors, isDark: true }), useThemedStyles: (fn: any) => fn(colors) };
});
const mockRequest = jest.fn(async () => true);
jest.mock('../../../src/services/audioRecorderService', () => ({
  audioRecorderService: { requestPermissions: () => mockRequest() }
}));
jest.mock('../../../src/stores/ambientTimelineStore', () => {
  const setProcessingMode = jest.fn();
  const setCaptureMode = jest.fn();
  const setOnboardingComplete = jest.fn();
  const state = {
    processingMode: 'live', captureMode: 'session', onDeviceOnly: false,
    setProcessingMode, setCaptureMode, setOnDeviceOnly: jest.fn(), setOnboardingComplete
  };
  const hook: any = (sel: any) => sel(state);
  hook.__mocks = { setProcessingMode, setCaptureMode, setOnboardingComplete };
  return { useAmbientTimelineStore: hook };
});

import { AmbientOnboardingScreen } from '../../../src/screens/AmbientOnboardingScreen';
import { useAmbientTimelineStore } from '../../../src/stores/ambientTimelineStore';
const m = (useAmbientTimelineStore as any).__mocks;

async function tapNext(getByTestId: any, id = 'ambient-onboard-next') {
  await act(async () => fireEvent.press(getByTestId(id)));
}

describe('AmbientOnboardingScreen', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockRequest.mockClear();
    m.setProcessingMode.mockClear();
    m.setCaptureMode.mockClear();
    m.setOnboardingComplete.mockClear();
  });

  it('walks the flow, records choices, requests the mic, and finishes', async () => {
    const { getByTestId } = render(<AmbientOnboardingScreen />);
    await tapNext(getByTestId); // 0 Welcome -> Get started
    await tapNext(getByTestId); // 1 Consent -> Next
    await act(async () => fireEvent.press(getByTestId('ambient-onboard-mic'))); // 2 Mic
    expect(mockRequest).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId('ambient-onboard-opt-nightly')); // 3 Processing
    expect(m.setProcessingMode).toHaveBeenCalledWith('nightly');
    await tapNext(getByTestId);
    fireEvent.press(getByTestId('ambient-onboard-opt-always-on')); // 4 Capture
    expect(m.setCaptureMode).toHaveBeenCalledWith('always-on');
    await tapNext(getByTestId);
    await tapNext(getByTestId); // 5 Privacy -> Next
    await act(async () => fireEvent.press(getByTestId('ambient-onboard-start'))); // 6 Ready -> Start
    expect(m.setOnboardingComplete).toHaveBeenCalledWith(true);
    expect(mockReplace).toHaveBeenCalledWith('AmbientDay');
  });
});
