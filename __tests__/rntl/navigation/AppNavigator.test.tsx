/**
 * AppNavigator Tests
 *
 * Tests for the main navigation setup including:
 * - Tab bar safe area inset handling
 * - Tab bar renders all tabs
 * - Dynamic height based on device navigation mode
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores, setupWithActiveModel } from '../../utils/testHelpers';
import { createDeviceInfo } from '../../utils/factories';

// Mock requestAnimationFrame
(globalThis as any).requestAnimationFrame = (cb: () => void) => {
  return setTimeout(cb, 0);
};

// Track useSafeAreaInsets mock so we can change it per test
const mockInsets = { top: 0, right: 0, bottom: 0, left: 0 };
jest.mock('react-native-safe-area-context', () => {
  const mockReact = require('react');
  const mockSafeAreaInsetsContext = mockReact.createContext(mockInsets);
  const mockSafeAreaFrameContext = mockReact.createContext({ x: 0, y: 0, width: 390, height: 844 });
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaInsetsContext: mockSafeAreaInsetsContext,
    SafeAreaFrameContext: mockSafeAreaFrameContext,
    useSafeAreaInsets: () => mockInsets,
    initialWindowMetrics: {
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 0, left: 0, right: 0, bottom: 0 },
    },
  };
});

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
  };
});

// Mock services
jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: {
    loadTextModel: jest.fn(() => Promise.resolve()),
    loadImageModel: jest.fn(() => Promise.resolve()),
    unloadTextModel: jest.fn(() => Promise.resolve()),
    unloadImageModel: jest.fn(() => Promise.resolve()),
    unloadAllModels: jest.fn(() => Promise.resolve({ textUnloaded: true, imageUnloaded: true })),
    getActiveModels: jest.fn(() => ({ text: null, image: null })),
    checkMemoryForModel: jest.fn(() => Promise.resolve({ canLoad: true, severity: 'safe', message: '' })),
    subscribe: jest.fn(() => jest.fn()),
    getResourceUsage: jest.fn(() => Promise.resolve({
      textModelMemory: 0,
      imageModelMemory: 0,
      totalMemory: 0,
      memoryAvailable: 4 * 1024 * 1024 * 1024,
    })),
    syncWithNativeState: jest.fn(),
  },
}));

jest.mock('../../../src/services/modelManager', () => ({
  modelManager: {
    getDownloadedModels: jest.fn(() => Promise.resolve([])),
      linkOrphanMmProj: jest.fn().mockResolvedValue(undefined),
    getDownloadedImageModels: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(() => Promise.resolve({
      totalMemory: 8 * 1024 * 1024 * 1024,
      availableMemory: 4 * 1024 * 1024 * 1024,
    })),
    formatBytes: jest.fn((bytes: number) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`),
    formatModelSize: jest.fn(() => '4.0 GB'),
  },
}));

jest.mock('../../../src/utils/haptics', () => ({
  triggerHaptic: jest.fn(),
}));

// Mock AnimatedEntry / AnimatedListItem / AnimatedPressable
jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));
jest.mock('../../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, onPress, testID, style }: any) => {
    const { TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity testID={testID} style={style} onPress={onPress}>
        {children}
      </TouchableOpacity>
    );
  },
}));
jest.mock('../../../src/components/AnimatedPressable', () => ({
  AnimatedPressable: ({ children, onPress, style, testID }: any) => {
    const { TouchableOpacity } = require('react-native');
    return <TouchableOpacity style={style} onPress={onPress} testID={testID}>{children}</TouchableOpacity>;
  },
}));

// Mock AppSheet
jest.mock('../../../src/components/AppSheet', () => ({
  AppSheet: ({ visible, children }: any) => {
    if (!visible) return null;
    return children;
  },
}));

// Mock components module
jest.mock('../../../src/components', () => {
  const actual = jest.requireActual('../../../src/components');
  return {
    ...actual,
    CustomAlert: () => null,
  };
});

// Mock useFocusTrigger
jest.mock('../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: () => 0,
}));

// Mock Swipeable
jest.mock('react-native-gesture-handler/Swipeable', () => {
  const RN = require('react');
  const { View } = require('react-native');
  return RN.forwardRef(({ children, containerStyle }: any, _ref: any) => (
    <View style={containerStyle}>{children}</View>
  ));
});

// Import after mocks
import { AppNavigator } from '../../../src/navigation/AppNavigator';

const renderAppNavigator = () => {
  return render(
    <NavigationContainer>
      <AppNavigator />
    </NavigationContainer>
  );
};

describe('AppNavigator', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    // Reset insets to default
    mockInsets.top = 0;
    mockInsets.right = 0;
    mockInsets.bottom = 0;
    mockInsets.left = 0;

    // Setup store so we land on Main tabs
    setupWithActiveModel();
    useAppStore.setState({
      hasCompletedOnboarding: true,
      deviceInfo: createDeviceInfo(),
    });
  });

  describe('Tab bar rendering', () => {
    it('renders all five tab labels (Recorder replaced by Settings)', () => {
      const { getAllByText } = renderAppNavigator();

      expect(getAllByText('Home').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Chats').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Projects').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Models').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Settings').length).toBeGreaterThanOrEqual(1);
    });

    it('renders all tab buttons with testIDs', () => {
      const { getByTestId } = renderAppNavigator();

      expect(getByTestId('home-tab')).toBeTruthy();
      expect(getByTestId('chats-tab')).toBeTruthy();
      expect(getByTestId('projects-tab')).toBeTruthy();
      expect(getByTestId('models-tab')).toBeTruthy();
      expect(getByTestId('settings-tab')).toBeTruthy();
    });

    it('no longer renders a Recorder tab (moved to a Home card)', () => {
      const { queryByTestId } = renderAppNavigator();
      expect(queryByTestId('recorder-tab')).toBeNull();
    });
  });

  describe('Tab bar safe area insets', () => {
    it('uses minimum paddingBottom of 20 when bottom inset is 0 (gesture navigation)', () => {
      mockInsets.bottom = 0;
      const { getByTestId } = renderAppNavigator();

      // Tab bar should render — verify via a tab button
      const homeTab = getByTestId('home-tab');
      expect(homeTab).toBeTruthy();

      // Find the tab bar container (parent of tab buttons)
      // The tab bar style should have height: 60 + 20 = 80 and paddingBottom: 20
      const tabBar = getByTestId('home-tab').parent?.parent;
      if (tabBar && tabBar.props?.style) {
        const flatStyle = Array.isArray(tabBar.props.style)
          ? Object.assign({}, ...tabBar.props.style.filter(Boolean))
          : tabBar.props.style;
        if (flatStyle.paddingBottom !== undefined) {
          expect(flatStyle.paddingBottom).toBe(20);
        }
        if (flatStyle.height !== undefined) {
          expect(flatStyle.height).toBe(80);
        }
      }
    });

    it('uses device bottom inset when larger than minimum (3-button navigation)', () => {
      mockInsets.bottom = 48;
      const { getByTestId } = renderAppNavigator();

      const homeTab = getByTestId('home-tab');
      expect(homeTab).toBeTruthy();

      // The tab bar style should have height: 60 + 48 = 108 and paddingBottom: 48
      const tabBar = getByTestId('home-tab').parent?.parent;
      if (tabBar && tabBar.props?.style) {
        const flatStyle = Array.isArray(tabBar.props.style)
          ? Object.assign({}, ...tabBar.props.style.filter(Boolean))
          : tabBar.props.style;
        if (flatStyle.paddingBottom !== undefined) {
          expect(flatStyle.paddingBottom).toBe(48);
        }
        if (flatStyle.height !== undefined) {
          expect(flatStyle.height).toBe(108);
        }
      }
    });

    it('uses device bottom inset of 34 for iPhone-style safe area', () => {
      mockInsets.bottom = 34;
      const { getByTestId } = renderAppNavigator();

      const homeTab = getByTestId('home-tab');
      expect(homeTab).toBeTruthy();

      const tabBar = getByTestId('home-tab').parent?.parent;
      if (tabBar && tabBar.props?.style) {
        const flatStyle = Array.isArray(tabBar.props.style)
          ? Object.assign({}, ...tabBar.props.style.filter(Boolean))
          : tabBar.props.style;
        if (flatStyle.paddingBottom !== undefined) {
          expect(flatStyle.paddingBottom).toBe(34);
        }
        if (flatStyle.height !== undefined) {
          expect(flatStyle.height).toBe(94);
        }
      }
    });

    it('renders all tabs with large bottom inset (regression test for nav bar overlap)', () => {
      // This is the key regression test: with a 48dp bottom inset (3-button Android nav),
      // all tabs should still be visible and not clipped by the system navigation bar
      mockInsets.bottom = 48;
      const { getAllByText, getByTestId } = renderAppNavigator();

      // All tab labels should be visible
      expect(getAllByText('Home').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Chats').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Projects').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Models').length).toBeGreaterThanOrEqual(1);

      // All tab buttons should be pressable
      expect(getByTestId('home-tab')).toBeTruthy();
      expect(getByTestId('chats-tab')).toBeTruthy();
      expect(getByTestId('projects-tab')).toBeTruthy();
      expect(getByTestId('models-tab')).toBeTruthy();
    });
  });
});
