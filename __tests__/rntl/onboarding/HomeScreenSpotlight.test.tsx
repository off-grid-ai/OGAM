/**
 * HomeScreen Spotlight Integration Tests
 *
 * Renders the actual HomeScreen component and verifies:
 * - handleStepPress queues correct pending spotlights
 * - handleStepPress navigates to correct tabs
 * - handleStepPress fires goTo() with correct step index after delay
 * - Reactive spotlight for image load (step 13) fires on state change
 * - OnboardingSheet visibility and interaction
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores } from '../../utils/testHelpers';
import { createONNXImageModel } from '../../utils/factories';
import { mockGoTo, mockNavigate, clearSpotlightMocks } from '../../utils/spotlightMocks';
import {
  peekPendingSpotlight,
  setPendingSpotlight,
} from '../../../src/components/onboarding/spotlightState';

jest.mock('react-native-spotlight-tour', () =>
  require('../../utils/spotlightMocks').createSpotlightTourMock()
);

// Mock requestAnimationFrame
(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);

jest.mock('@react-navigation/native', () =>
  require('../../utils/spotlightMocks').createNavigationMock()
);

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
      textModelMemory: 0, imageModelMemory: 0, totalMemory: 0,
      memoryAvailable: 4 * 1024 * 1024 * 1024,
    })),
    syncWithNativeState: jest.fn(),
  },
}));

jest.mock('../../../src/services/modelManager', () =>
  require('../../utils/spotlightMocks').createModelManagerMock()
);

jest.mock('../../../src/services/hardware', () =>
  require('../../utils/spotlightMocks').createHardwareServiceMock()
);

// Mock child components
jest.mock('../../../src/components/AppSheet', () => ({
  AppSheet: ({ visible, onClose, title, children }: any) => {
    const { View, Text, TouchableOpacity } = require('react-native');
    if (!visible) return null;
    return (
      <View testID="app-sheet">
        <Text testID="app-sheet-title">{title}</Text>
        {children}
        <TouchableOpacity testID="close-sheet" onPress={onClose}>
          <Text>Close</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

jest.mock('../../../src/components/AnimatedEntry', () =>
  require('../../utils/spotlightMocks').createAnimatedEntryMock()
);

jest.mock('../../../src/components/AnimatedPressable', () =>
  require('../../utils/spotlightMocks').createAnimatedPressableMock()
);

jest.mock('../../../src/components/AnimatedListItem', () =>
  require('../../utils/spotlightMocks').createAnimatedListItemMock()
);

jest.mock('../../../src/components/CustomAlert', () =>
  require('../../utils/spotlightMocks').createCustomAlertMock()
);

// Mock OnboardingSheet to expose step presses
jest.mock('../../../src/components/onboarding/OnboardingSheet', () => ({
  OnboardingSheet: ({ visible, onClose, onStepPress }: any) => {
    const { View, TouchableOpacity, Text } = require('react-native');
    if (!visible) return null;
    return (
      <View testID="onboarding-sheet">
        <TouchableOpacity testID="step-downloadedModel" onPress={() => onStepPress('downloadedModel')}>
          <Text>Download a model</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="step-loadedModel" onPress={() => onStepPress('loadedModel')}>
          <Text>Load a model</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="step-sentMessage" onPress={() => onStepPress('sentMessage')}>
          <Text>Send a message</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="step-triedImageGen" onPress={() => onStepPress('triedImageGen')}>
          <Text>Try image generation</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="step-exploredSettings" onPress={() => onStepPress('exploredSettings')}>
          <Text>Explore settings</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="step-createdProject" onPress={() => onStepPress('createdProject')}>
          <Text>Create a project</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="close-onboarding" onPress={onClose}>
          <Text>Close</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

jest.mock('../../../src/components/onboarding/PulsatingIcon', () => ({
  PulsatingIcon: ({ onPress }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity testID="pulsating-icon" onPress={onPress}>
        <Text>?</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('../../../src/components/onboarding/useOnboardingSheet', () => ({
  useOnboardingSheet: () => ({
    sheetVisible: true, // Always visible for testing
    openSheet: jest.fn(),
    closeSheet: jest.fn(),
    showIcon: true,
  }),
}));

// Mock the HomeScreen sub-components
jest.mock('../../../src/screens/HomeScreen/components/RecentConversations', () => ({
  RecentConversations: () => null,
}));

jest.mock('../../../src/screens/HomeScreen/components/ModelPickerSheet', () => ({
  ModelPickerSheet: () => null,
}));

import { HomeScreen } from '../../../src/screens/HomeScreen';

let unmountFn: (() => void) | null = null;

function renderHomeScreen() {
  const result = render(
    <NavigationContainer>
      <HomeScreen navigation={{ navigate: mockNavigate } as any} />
    </NavigationContainer>
  );
  unmountFn = result.unmount;
  return result;
}

describe('HomeScreen Spotlight Integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetStores();
    setPendingSpotlight(null);
    clearSpotlightMocks();
    unmountFn = null;
  });

  afterEach(() => {
    if (unmountFn) { unmountFn(); unmountFn = null; }
    jest.useRealTimers();
  });

  // ========================================================================
  // Flow 1: Download a Model
  // ========================================================================
  describe('Flow 1: downloadedModel', () => {
    it('queues pending spotlight 9, navigates to ModelsTab, fires goTo(0)', () => {
      const { getByTestId } = renderHomeScreen();

      act(() => {
        fireEvent.press(getByTestId('step-downloadedModel'));
      });

      expect(peekPendingSpotlight()).toBe(9);
      expect(mockNavigate).toHaveBeenCalledWith('ModelsTab');
      expect(mockGoTo).not.toHaveBeenCalled();

      act(() => { jest.advanceTimersByTime(800); });
      expect(mockGoTo).toHaveBeenCalledWith(0);
    });
  });

  // ========================================================================
  // Flow 2: Load a Model
  // ========================================================================
  describe('Flow 2: loadedModel', () => {
    it('queues pending spotlight 11, stays on HomeTab, fires goTo(1)', () => {
      const { getByTestId } = renderHomeScreen();

      act(() => {
        fireEvent.press(getByTestId('step-loadedModel'));
      });

      expect(peekPendingSpotlight()).toBe(11);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockGoTo).not.toHaveBeenCalled();

      act(() => { jest.advanceTimersByTime(600); });
      expect(mockGoTo).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Flow 3: Send a Message
  // ========================================================================
  describe('Flow 3: sentMessage', () => {
    it('queues pending spotlight 3, navigates to ChatsTab, fires goTo(2)', () => {
      const { getByTestId } = renderHomeScreen();

      act(() => {
        fireEvent.press(getByTestId('step-sentMessage'));
      });

      expect(peekPendingSpotlight()).toBe(3);
      expect(mockNavigate).toHaveBeenCalledWith('ChatsTab');

      act(() => { jest.advanceTimersByTime(800); });
      expect(mockGoTo).toHaveBeenCalledWith(2);
    });
  });

  // ========================================================================
  // Flow 4: Try Image Generation
  // ========================================================================
  describe('Flow 4: triedImageGen', () => {
    it('no image model: queues step 17, navigates to ModelsTab, fires goTo(4)', () => {
      const { getByTestId } = renderHomeScreen();

      act(() => {
        fireEvent.press(getByTestId('step-triedImageGen'));
      });

      expect(peekPendingSpotlight()).toBe(17);
      expect(mockNavigate).toHaveBeenCalledWith('ModelsTab');

      act(() => { jest.advanceTimersByTime(800); });
      expect(mockGoTo).toHaveBeenCalledWith(4);
    });

    it('image model downloaded but not loaded: fires goTo(13) on HomeTab', () => {
      const { addDownloadedImageModel } = useAppStore.getState();
      addDownloadedImageModel(createONNXImageModel());

      const { getByTestId } = renderHomeScreen();

      act(() => {
        fireEvent.press(getByTestId('step-triedImageGen'));
      });

      expect(peekPendingSpotlight()).toBeNull();
      expect(mockNavigate).not.toHaveBeenCalled();

      act(() => { jest.advanceTimersByTime(600); });
      expect(mockGoTo).toHaveBeenCalledWith(13);
    });

    it('image model already loaded: navigates to ChatsTab, fires goTo(14)', () => {
      const { addDownloadedImageModel, setActiveImageModelId } = useAppStore.getState();
      addDownloadedImageModel(createONNXImageModel());
      setActiveImageModelId('test-image-model');

      const { getByTestId } = renderHomeScreen();

      act(() => {
        fireEvent.press(getByTestId('step-triedImageGen'));
      });

      expect(peekPendingSpotlight()).toBe(15);
      expect(mockNavigate).toHaveBeenCalledWith('ChatsTab');

      act(() => { jest.advanceTimersByTime(800); });
      expect(mockGoTo).toHaveBeenCalledWith(14);
    });
  });

  // ========================================================================
  // Flow 5: Explore Settings
  // ========================================================================
  describe('Flow 5: exploredSettings', () => {
    it('queues pending spotlight 6, navigates to SettingsTab, fires goTo(5)', () => {
      const { getByTestId } = renderHomeScreen();

      act(() => {
        fireEvent.press(getByTestId('step-exploredSettings'));
      });

      expect(peekPendingSpotlight()).toBe(6);
      expect(mockNavigate).toHaveBeenCalledWith('SettingsTab');

      act(() => { jest.advanceTimersByTime(800); });
      expect(mockGoTo).toHaveBeenCalledWith(5);
    });
  });

  // ========================================================================
  // Flow 6: Create a Project
  // ========================================================================
  describe('Flow 6: createdProject', () => {
    it('queues pending spotlight 8, navigates to ProjectsTab, fires goTo(7)', () => {
      const { getByTestId } = renderHomeScreen();

      act(() => {
        fireEvent.press(getByTestId('step-createdProject'));
      });

      expect(peekPendingSpotlight()).toBe(8);
      expect(mockNavigate).toHaveBeenCalledWith('ProjectsTab');

      act(() => { jest.advanceTimersByTime(800); });
      expect(mockGoTo).toHaveBeenCalledWith(7);
    });
  });

  // ========================================================================
  // Timing: cross-tab vs same-tab
  // ========================================================================
  describe('timing', () => {
    it('cross-tab navigation uses 800ms delay', () => {
      const { getByTestId } = renderHomeScreen();

      act(() => { fireEvent.press(getByTestId('step-downloadedModel')); });

      act(() => { jest.advanceTimersByTime(799); });
      expect(mockGoTo).not.toHaveBeenCalled();

      act(() => { jest.advanceTimersByTime(1); });
      expect(mockGoTo).toHaveBeenCalledWith(0);
    });

    it('same-tab (HomeTab) uses 600ms delay', () => {
      const { getByTestId } = renderHomeScreen();

      act(() => { fireEvent.press(getByTestId('step-loadedModel')); });

      act(() => { jest.advanceTimersByTime(599); });
      expect(mockGoTo).not.toHaveBeenCalled();

      act(() => { jest.advanceTimersByTime(1); });
      expect(mockGoTo).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Reactive: Image Load spotlight (step 13)
  // ========================================================================
  describe('reactive: imageLoad spotlight (step 13)', () => {
    it('fires goTo(13) when image model downloaded but not loaded', () => {
      renderHomeScreen();

      act(() => {
        useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      });

      act(() => { jest.advanceTimersByTime(800); });
      expect(mockGoTo).toHaveBeenCalledWith(13);
      expect(useAppStore.getState().shownSpotlights.imageLoad).toBe(true);
    });

    it('does NOT fire when image model is already loaded', () => {
      act(() => {
        useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
        useAppStore.getState().setActiveImageModelId('some-model');
      });

      renderHomeScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });

    it('does NOT fire when already shown', () => {
      act(() => {
        useAppStore.getState().markSpotlightShown('imageLoad');
        useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      });

      renderHomeScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });

    it('does NOT fire when triedImageGen is completed', () => {
      act(() => {
        useAppStore.getState().completeChecklistStep('triedImageGen');
        useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      });

      renderHomeScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });
  });
});
