/**
 * Shared mock factories for onboarding spotlight tests.
 *
 * Usage:
 *   import { mockGoTo, ... } from '../../utils/spotlightMocks';
 *   jest.mock('react-native-spotlight-tour', () =>
 *     require('../../utils/spotlightMocks').createSpotlightTourMock()
 *   );
 *
 * Using require() inside the jest.mock factory avoids hoisting issues
 * while keeping mock implementations in a single place.
 */

import React from 'react';

// ─── Shared mock refs ──────────────────────────────────────────────
export const mockGoTo = jest.fn();
export const mockStart = jest.fn();
export const mockStop = jest.fn();
export const mockNavigate = jest.fn();
export const mockGoBack = jest.fn();

// ─── react-native-spotlight-tour ───────────────────────────────────
export function createSpotlightTourMock() {
  return {
    SpotlightTourProvider: ({ children }: { children: React.ReactNode }) => children,
    AttachStep: ({ children }: { children: React.ReactNode }) => children,
    useSpotlightTour: () => ({
      start: mockStart,
      stop: mockStop,
      next: jest.fn(),
      previous: jest.fn(),
      goTo: mockGoTo,
      current: 0,
      status: 'idle',
      pause: jest.fn(),
      resume: jest.fn(),
    }),
  };
}

// ─── @react-navigation/native ──────────────────────────────────────
export function createNavigationMock(extras?: Record<string, any>) {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    ...extras,
  };
}

// ─── CustomAlert ────────────────────────────────────────────────────
export function createCustomAlertMock() {
  return {
    CustomAlert: () => null,
    showAlert: jest.fn(),
    hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
    initialAlertState: { visible: false, title: '', message: '', buttons: [] },
  };
}

// ─── Animated components ────────────────────────────────────────────
export function createAnimatedEntryMock() {
  return { AnimatedEntry: ({ children }: any) => children };
}

export function createAnimatedPressableMock() {
  return {
    AnimatedPressable: ({ children, onPress, style, testID }: any) => {
      const { TouchableOpacity } = require('react-native');
      return (
        <TouchableOpacity onPress={onPress} style={style} testID={testID}>
          {children}
        </TouchableOpacity>
      );
    },
  };
}

export function createAnimatedListItemMock() {
  return {
    AnimatedListItem: ({ children, onPress, style, testID }: any) => {
      const { TouchableOpacity } = require('react-native');
      return (
        <TouchableOpacity onPress={onPress} style={style} testID={testID}>
          {children}
        </TouchableOpacity>
      );
    },
  };
}

// ─── Services ───────────────────────────────────────────────────────
export function createHardwareServiceMock() {
  return {
    hardwareService: {
      getDeviceInfo: jest.fn(() => Promise.resolve({
        totalMemory: 8 * 1024 * 1024 * 1024,
        availableMemory: 4 * 1024 * 1024 * 1024,
      })),
      getAccelerationCapability: jest.fn(() => Promise.resolve({ hasNpu: false, hasGpu: false })),
      formatBytes: jest.fn((bytes: number) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`),
      formatModelSize: jest.fn(() => '4.0 GB'),
    },
  };
}

export function createModelManagerMock() {
  return {
    modelManager: {
      getDownloadedModels: jest.fn(() => Promise.resolve([])),
      linkOrphanMmProj: jest.fn().mockResolvedValue(undefined),
      getDownloadedImageModels: jest.fn(() => Promise.resolve([])),
      deleteModel: jest.fn(() => Promise.resolve()),
    },
  };
}

// ─── Test lifecycle helpers ─────────────────────────────────────────
export function clearSpotlightMocks() {
  mockGoTo.mockClear();
  mockStart.mockClear();
  mockStop.mockClear();
  mockNavigate.mockClear();
  mockGoBack.mockClear();
}
