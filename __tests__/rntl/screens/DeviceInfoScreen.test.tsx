/**
 * DeviceInfoScreen Tests
 *
 * Tests for the device information screen including:
 * - Title display
 * - Device model, system info, RAM, and tier
 * - Back button navigation
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Navigation is globally mocked in jest.setup.ts
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({
      params: {},
    }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

jest.mock('../../../src/stores', () => ({
  useAppStore: jest.fn((selector?: any) => {
    const state = {
      deviceInfo: {
        deviceModel: 'Pixel 7',
        systemName: 'Android',
        systemVersion: '14',
        isEmulator: false,
      },
      themeMode: 'system',
    };
    return selector ? selector(state) : state;
  }),
}));

jest.mock('../../../src/services', () => ({
  hardwareService: {
    getTotalMemoryGB: jest.fn(() => 8.0),
    getDeviceTier: jest.fn(() => 'high'),
    getProcessMemory: jest.fn(() => Promise.resolve({ availableMB: 5530, footprintMB: 660, limitMB: 6190 })),
  },
}));

jest.mock('../../../src/components', () => ({
  Card: ({ children, style }: any) => {
    const { View } = require('react-native');
    return <View style={style}>{children}</View>;
  },
}));

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

jest.mock('../../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, onPress, style }: any) => {
    const { TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity style={style} onPress={onPress}>
        {children}
      </TouchableOpacity>
    );
  },
}));

import { DeviceInfoScreen } from '../../../src/screens/DeviceInfoScreen';

describe('DeviceInfoScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders "Device Information" title', () => {
    const { getByText } = render(<DeviceInfoScreen />);
    expect(getByText('Device Information')).toBeTruthy();
  });

  it('shows device model', () => {
    const { getByText } = render(<DeviceInfoScreen />);
    expect(getByText('Pixel 7')).toBeTruthy();
  });

  it('shows system info', () => {
    const { getByText } = render(<DeviceInfoScreen />);
    expect(getByText('Android 14')).toBeTruthy();
  });

  it('shows RAM', () => {
    const { getByText } = render(<DeviceInfoScreen />);
    expect(getByText('8.0 GB')).toBeTruthy();
  });

  it('shows device tier', () => {
    const { getAllByText } = render(<DeviceInfoScreen />);
    // "High" appears both in the tier badge and in the compatibility section
    const highTexts = getAllByText('High');
    expect(highTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('back button calls goBack', () => {
    const { UNSAFE_getAllByType } = render(<DeviceInfoScreen />);
    const { TouchableOpacity } = require('react-native');
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('highlights "Low" tier when device tier is low', () => {
    const { hardwareService } = require('../../../src/services');
    (hardwareService.getDeviceTier as jest.Mock).mockReturnValue('low');
    (hardwareService.getTotalMemoryGB as jest.Mock).mockReturnValue(3.0);

    const { getAllByText } = render(<DeviceInfoScreen />);
    // "Low" should appear in the compatibility section
    const lowTexts = getAllByText('Low');
    expect(lowTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('highlights "Medium" tier when device tier is medium', () => {
    const { hardwareService } = require('../../../src/services');
    (hardwareService.getDeviceTier as jest.Mock).mockReturnValue('medium');
    (hardwareService.getTotalMemoryGB as jest.Mock).mockReturnValue(5.0);

    const { getAllByText } = render(<DeviceInfoScreen />);
    const mediumTexts = getAllByText('Medium');
    expect(mediumTexts.length).toBeGreaterThanOrEqual(1);
  });
});
