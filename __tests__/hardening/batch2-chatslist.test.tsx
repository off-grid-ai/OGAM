/**
 * Batch 2 hardening — Chats list (sort, timestamp formatting, delete, empty state)
 *
 * Renders the REAL ChatsListScreen so the REAL inline formatDate() + the REAL sort
 * comparator + the REAL chatStore.deleteConversation run. The existing RNTL suite
 * (__tests__/rntl/screens/ChatsListScreen.test.tsx) only asserts that the row title
 * renders for each date bucket — it does NOT assert the actual formatted string, nor
 * the actual row order. These tests close that false-green gap by asserting:
 *
 *   25/30 — most-recently-active conversation floats to position 1 (real sort order).
 *   26    — a conversation from TODAY shows a clock time (HH:MM), not a date.
 *   27    — a conversation from a prior day shows a weekday / month-day, not a clock.
 *   31    — deleting a conversation removes exactly that row (real store delete).
 *   32    — deleting all conversations shows the empty state ("No Chats Yet").
 *
 * Boundaries mocked: navigation, animation wrappers, Swipeable, CustomAlert, the
 * services barrel, and vector icons — none of which is the logic under test.
 */

import React from 'react';
import { render, fireEvent, within } from '@testing-library/react-native';
import { useAppStore } from '../../src/stores/appStore';
import { useChatStore } from '../../src/stores/chatStore';
import { resetStores } from '../utils/testHelpers';
import { createConversation, createDownloadedModel } from '../utils/factories';

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
    useRoute: () => ({ params: {} }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

jest.mock('../../src/hooks/useFocusTrigger', () => ({ useFocusTrigger: () => 0 }));
jest.mock('../../src/components/AnimatedEntry', () => ({ AnimatedEntry: ({ children }: any) => children }));
jest.mock('../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, onPress, style, testID }: any) => {
    const { TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity style={style} onPress={onPress} testID={testID}>
        {children}
      </TouchableOpacity>
    );
  },
}));

const mockShowAlert = jest.fn((_t: string, _m: string, _b?: any[]) => ({
  visible: true,
  title: _t,
  message: _m,
  buttons: _b || [{ text: 'OK', style: 'default' }],
}));

jest.mock('../../src/components/CustomAlert', () => ({
  CustomAlert: ({ visible, title, buttons }: any) => {
    if (!visible) return null;
    const { View, Text, TouchableOpacity: TO } = require('react-native');
    return (
      <View testID="custom-alert">
        <Text testID="alert-title">{title}</Text>
        {buttons && buttons.map((btn: any, i: number) => (
          <TO key={i} testID={`alert-button-${btn.text}`} onPress={btn.onPress}>
            <Text>{btn.text}</Text>
          </TO>
        ))}
      </View>
    );
  },
  showAlert: (...args: any[]) => (mockShowAlert as any)(...args),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
  initialAlertState: { visible: false, title: '', message: '', buttons: [] },
}));

jest.mock('../../src/services', () => ({
  onnxImageGeneratorService: { deleteGeneratedImage: jest.fn(() => Promise.resolve()) },
  activeModelService: {
    loadTextModel: jest.fn(() => Promise.resolve()),
    loadImageModel: jest.fn(() => Promise.resolve()),
    unloadTextModel: jest.fn(() => Promise.resolve()),
    unloadImageModel: jest.fn(() => Promise.resolve()),
  },
  llmService: { getLoadedModelPath: jest.fn(() => null), isModelLoaded: jest.fn(() => false) },
  remoteServerManager: { clearActiveRemoteModel: jest.fn() },
}));

jest.mock('../../src/components', () => ({
  ModelSelectorModal: ({ visible }: any) => {
    if (!visible) return null;
    const { View, Text } = require('react-native');
    return (<View testID="model-selector-modal"><Text>Select Model</Text></View>);
  },
}));

// Render Swipeable's right actions so the delete button is reachable.
jest.mock('react-native-gesture-handler/Swipeable', () => {
  return ({ children, renderRightActions }: any) => {
    const { View } = require('react-native');
    return (<View>{children}{renderRightActions && renderRightActions()}</View>);
  };
});

import { ChatsListScreen } from '../../src/screens/ChatsListScreen';

describe('batch2 ChatsListScreen — sort, timestamp format, delete, empty', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    // a downloaded model so the empty-state uses the "with models" copy (doesn't matter here)
    const model = createDownloadedModel();
    useAppStore.setState({ downloadedModels: [model], activeModelId: model.id });
  });

  // Case 26: today's conversation shows a clock time, NOT a date.
  it('case26: shows a clock time (HH:MM) for a conversation from today', () => {
    const now = new Date();
    const conv = createConversation({ title: 'Today Chat', updatedAt: now.toISOString() });
    useChatStore.setState({ conversations: [conv] });

    const { getByText } = render(<ChatsListScreen />);
    const expectedClock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(getByText(expectedClock)).toBeTruthy();
    // it is NOT a weekday or month/day string
    expect(expectedClock).toMatch(/\d/);
  });

  // Case 27: a prior-day conversation shows a weekday (within a week) — not a clock.
  it('case27: shows a weekday name for a conversation 3 days ago (not a clock time)', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const conv = createConversation({ title: 'Recent Chat', updatedAt: threeDaysAgo.toISOString() });
    useChatStore.setState({ conversations: [conv] });

    const { getByText } = render(<ChatsListScreen />);
    const expectedWeekday = threeDaysAgo.toLocaleDateString([], { weekday: 'short' });
    expect(getByText(expectedWeekday)).toBeTruthy();
    // guard: a weekday short name is not a HH:MM clock
    expect(expectedWeekday).not.toMatch(/^\d{1,2}:\d{2}/);
  });

  // Case 27 (older bucket): a >1-week-old conversation shows month/day.
  it('case27: shows month/day for a conversation 14 days ago', () => {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const conv = createConversation({ title: 'Old Chat', updatedAt: twoWeeksAgo.toISOString() });
    useChatStore.setState({ conversations: [conv] });

    const { getByText } = render(<ChatsListScreen />);
    const expectedMonthDay = twoWeeksAgo.toLocaleDateString([], { month: 'short', day: 'numeric' });
    expect(getByText(expectedMonthDay)).toBeTruthy();
  });

  // Cases 25/30: most-recently-active conversation is at position 1 (row index 0).
  it('case25/30: most-recently-updated conversation sorts to the top row', () => {
    const older = createConversation({ title: 'Older Chat', updatedAt: new Date('2024-01-01T10:00:00Z').toISOString() });
    const newer = createConversation({ title: 'Newer Chat', updatedAt: new Date('2024-06-01T10:00:00Z').toISOString() });
    // insert oldest-first so ONLY the real comparator can produce the correct order
    useChatStore.setState({ conversations: [older, newer] });

    const { getByTestId } = render(<ChatsListScreen />);
    const row0 = getByTestId('conversation-item-0');
    const row1 = getByTestId('conversation-item-1');
    expect(within(row0).getByText('Newer Chat')).toBeTruthy();
    expect(within(row1).getByText('Older Chat')).toBeTruthy();
  });

  // Case 31 (through the UI): the swipe-delete action opens a confirm alert whose
  // Delete button removes exactly that conversation from the real store, leaving the
  // rest intact.
  it('case31: confirming the swipe-delete alert removes exactly that conversation', () => {
    const a = createConversation({ title: 'Alpha', updatedAt: new Date('2024-06-02T10:00:00Z').toISOString() });
    const b = createConversation({ title: 'Bravo', updatedAt: new Date('2024-06-01T10:00:00Z').toISOString() });
    useChatStore.setState({ conversations: [a, b] });

    const { UNSAFE_getAllByType } = render(<ChatsListScreen />);
    const { TouchableOpacity } = require('react-native');
    const touchables = UNSAFE_getAllByType(TouchableOpacity);

    // Press each touchable until one raises the "Delete Chat" confirm alert (the
    // swipe-delete action). Row 0 is the newest ("Alpha").
    for (const t of touchables) {
      fireEvent.press(t);
      if (mockShowAlert.mock.calls.some(c => c[0] === 'Delete Chat')) break;
    }

    expect(mockShowAlert).toHaveBeenCalledWith(
      'Delete Chat',
      expect.any(String),
      expect.any(Array),
    );

    // Invoke the confirm handler the screen passed to the alert -> real store delete.
    const call = mockShowAlert.mock.calls.find(c => c[0] === 'Delete Chat')!;
    const buttons = call[2] as any[];
    const del = buttons.find(btn => btn.text === 'Delete')!;
    del.onPress();

    const remaining = useChatStore.getState().conversations;
    expect(remaining).toHaveLength(1);
    // exactly one conversation was removed; the other survives
    expect(remaining.map(c => c.title)).toEqual(['Bravo']);
  });

  // Case 32: deleting all conversations shows the empty state.
  it('case32: empty conversation list renders the "No Chats Yet" empty state', () => {
    useChatStore.setState({ conversations: [] });
    const { getByText, queryByTestId } = render(<ChatsListScreen />);
    expect(getByText('No Chats Yet')).toBeTruthy();
    expect(queryByTestId('conversation-list')).toBeNull();
  });
});
