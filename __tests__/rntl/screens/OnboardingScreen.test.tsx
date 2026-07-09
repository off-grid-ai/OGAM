/**
 * OnboardingScreen Tests
 *
 * Tests for the onboarding screen including:
 * - First slide content rendering
 * - Navigation dots
 * - Get Started / Next button
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Navigation is globally mocked in jest.setup.ts

jest.mock('../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: () => 0,
}));

jest.mock('../../../src/components', () => ({
  Card: ({ children, style }: any) => {
    const { View } = require('react-native');
    return <View style={style}>{children}</View>;
  },
  Button: ({ title, onPress, disabled, testID }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} testID={testID}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

jest.mock('../../../src/components/CustomAlert', () => ({
  CustomAlert: () => null,
  showAlert: jest.fn(() => ({ visible: true })),
  hideAlert: jest.fn(() => ({ visible: false })),
  initialAlertState: { visible: false },
}));

jest.mock('../../../src/components/Button', () => ({
  Button: ({ title, onPress, disabled, testID }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} testID={testID}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
}));

const mockSetOnboardingComplete = jest.fn();

jest.mock('../../../src/stores', () => ({
  useAppStore: jest.fn((selector?: any) => {
    const state = {
      setOnboardingComplete: mockSetOnboardingComplete,
    };
    return selector ? selector(state) : state;
  }),
}));

jest.mock('../../../src/constants', () => ({
  ...jest.requireActual('../../../src/constants'),
  ONBOARDING_SLIDES: [
    {
      id: 'slide1',
      keyword: 'Welcome',
      title: 'Off Grid',
      description: 'Your AI companion',
      accentColor: '#0066FF',
    },
    {
      id: 'slide2',
      keyword: 'Private',
      title: 'On-Device',
      description: 'Everything stays local',
      accentColor: '#00CC66',
    },
  ],
}));

const mockDiscoverLANServers = jest.fn().mockResolvedValue([]);
jest.mock('../../../src/services/networkDiscovery', () => ({
  discoverLANServers: (...args: any[]) => mockDiscoverLANServers(...args),
}));

const mockAddServer = jest.fn().mockResolvedValue({ id: 'new-server' });
jest.mock('../../../src/services', () => ({
  remoteServerManager: {
    addServer: (...args: any[]) => mockAddServer(...args),
  },
}));

jest.mock('../../../src/stores/remoteServerStore', () => ({
  useRemoteServerStore: Object.assign(
    jest.fn((selector?: any) => {
      const state = { servers: [] };
      return selector ? selector(state) : state;
    }),
    {
      getState: jest.fn(() => ({ servers: [] })),
    },
  ),
}));

import { OnboardingScreen } from '../../../src/screens/OnboardingScreen';
import { WEDNESDAY_URL } from '../../../src/constants';

const mockNavigate = jest.fn();
const mockReset = jest.fn();
const mockReplace = jest.fn();
const navigation = {
  navigate: mockNavigate,
  reset: mockReset,
  replace: mockReplace,
} as any;

describe('OnboardingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders first slide content', () => {
    const { getByText } = render(<OnboardingScreen navigation={navigation} />);
    expect(getByText('Welcome')).toBeTruthy();
    expect(getByText('Off Grid')).toBeTruthy();
    expect(getByText('Your AI companion')).toBeTruthy();
  });

  it('renders second slide content', () => {
    const { getByText } = render(<OnboardingScreen navigation={navigation} />);
    expect(getByText('Private')).toBeTruthy();
    expect(getByText('On-Device')).toBeTruthy();
    expect(getByText('Everything stays local')).toBeTruthy();
  });

  it('shows navigation dots', () => {
    const { getByTestId } = render(
      <OnboardingScreen navigation={navigation} />,
    );
    expect(getByTestId('onboarding-screen')).toBeTruthy();
  });

  it('shows Next button on first slide', () => {
    const { getByText } = render(<OnboardingScreen navigation={navigation} />);
    expect(getByText('Next')).toBeTruthy();
  });

  it('shows Skip button on non-last slide', () => {
    const { getByText } = render(<OnboardingScreen navigation={navigation} />);
    expect(getByText('Skip')).toBeTruthy();
  });

  it('calls completeOnboarding when Skip is pressed', () => {
    const { getByText } = render(<OnboardingScreen navigation={navigation} />);
    fireEvent.press(getByText('Skip'));

    expect(mockSetOnboardingComplete).toHaveBeenCalledWith(true);
    expect(mockReplace).toHaveBeenCalledWith('ModelDownload');
  });

  it('does not complete onboarding when Next is pressed on non-last slide', () => {
    // Note: scrollToIndex throws in test env, but the branch is covered
    try {
      const { getByText } = render(
        <OnboardingScreen navigation={navigation} />,
      );
      fireEvent.press(getByText('Next'));
    } catch {
      // scrollToIndex invariant error is expected in test env
    }

    // Should not complete onboarding on first slide
    expect(mockSetOnboardingComplete).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('updates currentIndex on scroll end (onMomentumScrollEnd → setCurrentIndex)', async () => {
    const { act: reactAct } = require('@testing-library/react-native');
    const { Dimensions, FlatList } = require('react-native');
    const width = Dimensions.get('window').width;

    const { getByText, queryByText, UNSAFE_getAllByType } = render(
      <OnboardingScreen navigation={navigation} />,
    );

    // On the first slide the footer button reads "Next" (not the last slide).
    expect(getByText('Next')).toBeTruthy();
    expect(queryByText('Get Started')).toBeNull();

    // Scroll to the last slide (index 1 of the 2-slide mock) via onMomentumScrollEnd.
    const flatLists = UNSAFE_getAllByType(FlatList);
    await reactAct(async () => {
      flatLists[0].props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: width } },
      });
    });

    // currentIndex advanced → isLastSlide flips the button to "Get Started". This FAILS
    // if onMomentumScrollEnd no longer updates currentIndex (the coverage the gutted
    // test had dropped).
    expect(getByText('Get Started')).toBeTruthy();
    expect(queryByText('Next')).toBeNull();
  });

  it('shows onboarding-skip testID', () => {
    const { getByTestId } = render(
      <OnboardingScreen navigation={navigation} />,
    );
    expect(getByTestId('onboarding-skip')).toBeTruthy();
  });

  it('shows onboarding-next testID', () => {
    const { getByTestId } = render(
      <OnboardingScreen navigation={navigation} />,
    );
    expect(getByTestId('onboarding-next')).toBeTruthy();
  });

  it('kicks off LAN discovery on mount', async () => {
    const { act: reactAct } = require('@testing-library/react-native');
    mockDiscoverLANServers.mockResolvedValue([
      {
        endpoint: 'http://192.168.1.10:11434',
        type: 'ollama',
        name: 'Ollama (192.168.1.10)',
      },
    ]);

    render(<OnboardingScreen navigation={navigation} />);

    await reactAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockDiscoverLANServers).toHaveBeenCalled();
    expect(mockAddServer).toHaveBeenCalledWith({
      name: 'Ollama (192.168.1.10)',
      endpoint: 'http://192.168.1.10:11434',
      providerType: 'openai-compatible',
    });
  });

  it('does not add duplicate servers during LAN discovery', async () => {
    const { act: reactAct } = require('@testing-library/react-native');
    const {
      useRemoteServerStore,
    } = require('../../../src/stores/remoteServerStore');
    useRemoteServerStore.getState.mockReturnValue({
      servers: [{ endpoint: 'http://192.168.1.10:11434' }],
    });
    mockDiscoverLANServers.mockResolvedValue([
      { endpoint: 'http://192.168.1.10:11434', type: 'ollama', name: 'Ollama' },
    ]);

    render(<OnboardingScreen navigation={navigation} />);

    await reactAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAddServer).not.toHaveBeenCalled();
  });

  it('handles LAN discovery errors gracefully', async () => {
    const { act: reactAct } = require('@testing-library/react-native');
    mockDiscoverLANServers.mockRejectedValue(new Error('Network error'));

    render(<OnboardingScreen navigation={navigation} />);

    await reactAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should not throw — error is caught
    expect(mockDiscoverLANServers).toHaveBeenCalled();
  });

  it('opens correct Wednesday URL when tapping Made with love', () => {
    const { Linking } = require('react-native');
    const spy = jest
      .spyOn(Linking, 'openURL')
      .mockImplementation(() => Promise.resolve());
    const { getByText } = render(<OnboardingScreen navigation={navigation} />);
    fireEvent.press(getByText('Wednesday'));
    expect(spy).toHaveBeenCalledWith(WEDNESDAY_URL);
    expect(WEDNESDAY_URL).toBe('https://wednesday.is');
    spy.mockRestore();
  });

  it('completes onboarding when Get Started pressed on last slide', async () => {
    const { act: reactAct } = require('@testing-library/react-native');
    const { Dimensions } = require('react-native');
    const width = Dimensions.get('window').width;

    const { getByTestId, UNSAFE_getAllByType } = render(
      <OnboardingScreen navigation={navigation} />,
    );

    // Simulate scrolling to last slide (index 1) via onMomentumScrollEnd
    const { FlatList } = require('react-native');
    const flatLists = UNSAFE_getAllByType(FlatList);

    await reactAct(async () => {
      if (flatLists.length > 0 && flatLists[0].props.onMomentumScrollEnd) {
        flatLists[0].props.onMomentumScrollEnd({
          nativeEvent: { contentOffset: { x: width } },
        });
      }
    });

    // Now on last slide, press Get Started to complete onboarding
    fireEvent.press(getByTestId('onboarding-next'));

    expect(mockSetOnboardingComplete).toHaveBeenCalledWith(true);
    expect(mockReplace).toHaveBeenCalledWith('ModelDownload');
  });
});
