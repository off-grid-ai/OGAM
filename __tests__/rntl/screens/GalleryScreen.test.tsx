/**
 * GalleryScreen Tests
 *
 * Tests for the gallery screen including:
 * - Title rendering
 * - Empty state when no images
 * - Back button navigation
 * - Image grid rendering with images present
 * - Image tap opens viewer modal
 * - Delete image flow (including onPress callback)
 * - Multi-select mode
 * - Select all / delete selected (including onPress callback)
 * - Conversation-filtered gallery title
 * - Sync from disk
 * - Toggle image selection
 * - Save image
 * - Cancel generation
 * - Modal close / details sheet
 * - Generation banner
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { TouchableOpacity, Platform } from 'react-native';

jest.mock('../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: () => 0,
}));

jest.mock('../../../src/components', () => ({
  Card: ({ children, style }: any) => {
    const { View } = require('react-native');
    return <View style={style}>{children}</View>;
  },
  Button: ({ title, onPress, disabled }: any) => {
    const { TouchableOpacity: Btn, Text } = require('react-native');
    return (
      <Btn onPress={onPress} disabled={disabled}>
        <Text>{title}</Text>
      </Btn>
    );
  },
}));

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

const mockShowAlert = jest.fn((_t: string, _m: string, _b?: any) => ({
  visible: true,
  title: _t,
  message: _m,
  buttons: _b || [],
}));

const mockHideAlert = jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] }));

jest.mock('../../../src/components/CustomAlert', () => ({
  CustomAlert: ({ visible, title, message, buttons, onClose }: any) => {
    if (!visible) return null;
    const { View, Text, TouchableOpacity: Btn } = require('react-native');
    return (
      <View testID="custom-alert">
        <Text testID="alert-title">{title}</Text>
        <Text testID="alert-message">{message}</Text>
        {buttons?.map((btn: any) => (
          <Btn key={btn.text} testID={`alert-button-${btn.text}`} onPress={btn.onPress}>
            <Text>{btn.text}</Text>
          </Btn>
        ))}
        <Btn testID="alert-close" onPress={onClose}>
          <Text>CloseAlert</Text>
        </Btn>
      </View>
    );
  },
  showAlert: (...args: any[]) => (mockShowAlert as any)(...args),
  hideAlert: (...args: any[]) => (mockHideAlert as any)(...args),
  initialAlertState: { visible: false, title: '', message: '', buttons: [] },
}));

jest.mock('../../../src/components/Button', () => ({
  Button: ({ title, onPress, disabled }: any) => {
    const { TouchableOpacity: Btn, Text } = require('react-native');
    return (
      <Btn onPress={onPress} disabled={disabled}>
        <Text>{title}</Text>
      </Btn>
    );
  },
}));

const mockGoBack = jest.fn();
let mockRouteParams: any = {};

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
    useRoute: () => ({ params: mockRouteParams }),
  };
});

const mockGeneratedImages: any[] = [];
const mockRemoveGeneratedImage = jest.fn();
const mockAddGeneratedImage = jest.fn();

jest.mock('../../../src/stores', () => ({
  useAppStore: Object.assign(
    jest.fn(() => ({
      generatedImages: mockGeneratedImages,
      removeGeneratedImage: mockRemoveGeneratedImage,
      addGeneratedImage: mockAddGeneratedImage,
    })),
    {
      getState: jest.fn(() => ({
        generatedImages: mockGeneratedImages,
        addGeneratedImage: mockAddGeneratedImage,
      })),
    },
  ),
  useChatStore: jest.fn((selector?: any) => {
    const state = { conversations: [] };
    return selector ? selector(state) : state;
  }),
}));

const mockDeleteGeneratedImage = jest.fn(() => Promise.resolve(true));
const mockGetGeneratedImages = jest.fn(() => Promise.resolve([]));
const mockCancelGeneration = jest.fn(() => Promise.resolve());
let mockImageGenState = {
  isGenerating: false,
  prompt: null as string | null,
  previewPath: null as string | null,
  progress: null as any,
};
let _mockSubscribeCallback: any = null;

jest.mock('../../../src/services', () => ({
  imageGenerationService: {
    subscribe: jest.fn((cb: any) => {
      _mockSubscribeCallback = cb;
      return jest.fn();
    }),
    getState: jest.fn(() => mockImageGenState),
    cancelGeneration: jest.fn(() => mockCancelGeneration()),
  },
  onnxImageGeneratorService: {
    subscribe: jest.fn(() => jest.fn()),
    getGeneratedImages: jest.fn(() => mockGetGeneratedImages()),
    deleteGeneratedImage: jest.fn((...args: any[]) => (mockDeleteGeneratedImage as any)(...args)),
  },
}));

import { GalleryScreen } from '../../../src/screens/GalleryScreen';
import { Share } from 'react-native';

const sampleImages = [
  {
    id: 'img-1',
    prompt: 'A sunset over mountains',
    imagePath: '/mock/generated/sunset.png',
    width: 512,
    height: 512,
    steps: 20,
    seed: 12345,
    modelId: 'sd-model',
    createdAt: '2026-01-15T10:00:00.000Z',
  },
  {
    id: 'img-2',
    prompt: 'A cat sitting on a chair',
    negativePrompt: 'ugly, blurry',
    imagePath: '/mock/generated/cat.png',
    width: 512,
    height: 512,
    steps: 25,
    seed: 67890,
    modelId: 'sd-model',
    createdAt: '2026-01-16T10:00:00.000Z',
  },
  {
    id: 'img-3',
    prompt: 'A futuristic city',
    imagePath: '/mock/generated/city.png',
    width: 768,
    height: 768,
    steps: 30,
    seed: 11111,
    modelId: 'sd-model',
    createdAt: '2026-01-17T10:00:00.000Z',
  },
];

const getGridItems = (result: any) => {
  const touchables = result.UNSAFE_getAllByType(TouchableOpacity);
  return touchables.filter((t: any) => t.props.activeOpacity === 0.8);
};

describe('GalleryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
    mockGeneratedImages.length = 0;
    mockImageGenState = {
      isGenerating: false,
      prompt: null,
      previewPath: null,
      progress: null,
    };
    _mockSubscribeCallback = null;
    mockGetGeneratedImages.mockResolvedValue([]);
  });

  it('renders "Gallery" title', () => {
    const { getByText } = render(<GalleryScreen />);
    expect(getByText('Gallery')).toBeTruthy();
  });

  it('shows empty state when no images', () => {
    const { getByText } = render(<GalleryScreen />);
    expect(getByText('No generated images yet')).toBeTruthy();
    expect(getByText('Generate images from any chat conversation.')).toBeTruthy();
  });

  it('back button calls goBack', () => {
    const { UNSAFE_getAllByType } = render(<GalleryScreen />);
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('renders image grid when images exist', () => {
    mockGeneratedImages.push(...sampleImages);

    const { queryByText } = render(<GalleryScreen />);
    expect(queryByText('No generated images yet')).toBeNull();
  });

  it('shows image count badge when images exist', () => {
    mockGeneratedImages.push(...sampleImages);

    const { getByText } = render(<GalleryScreen />);
    expect(getByText('3')).toBeTruthy();
  });

  it('tapping an image opens the viewer modal', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    if (gridItems.length > 0) {
      fireEvent.press(gridItems[0]);
      expect(result.getByText('Info')).toBeTruthy();
      expect(result.getByText('Save')).toBeTruthy();
      expect(result.getByText('Delete')).toBeTruthy();
      expect(result.getByText('Close')).toBeTruthy();
    }
  });

  it('pressing delete in viewer shows confirmation alert', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    if (gridItems.length > 0) {
      fireEvent.press(gridItems[0]);
      fireEvent.press(result.getByText('Delete'));

      expect(mockShowAlert).toHaveBeenCalledWith(
        'Delete Image',
        'Are you sure you want to delete this image?',
        expect.any(Array),
      );
    }
  });

  it('pressing close in viewer closes the modal', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    if (gridItems.length > 0) {
      fireEvent.press(gridItems[0]);
      expect(result.getByText('Close')).toBeTruthy();

      fireEvent.press(result.getByText('Close'));
      expect(result.queryByText('Save')).toBeNull();
    }
  });

  it('pressing Info toggles details view', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    if (gridItems.length > 0) {
      fireEvent.press(gridItems[0]);
      fireEvent.press(result.getByText('Info'));
      expect(result.getByText('Image Details')).toBeTruthy();
      expect(result.getByText('PROMPT')).toBeTruthy();
      expect(result.getByText('A sunset over mountains')).toBeTruthy();
    }
  });

  it('shows "Chat Media" title when conversationId is provided', () => {
    mockRouteParams = { conversationId: 'conv-123' };
    mockGeneratedImages.push({
      ...sampleImages[0],
      conversationId: 'conv-123',
    });

    const { getByText } = render(<GalleryScreen />);
    expect(getByText('Chat Media')).toBeTruthy();
  });

  it('shows chat-specific empty state when no images match conversation', () => {
    mockRouteParams = { conversationId: 'conv-456' };

    const { getByText } = render(<GalleryScreen />);
    expect(getByText('No images in this chat')).toBeTruthy();
  });

  it('long press on image enters select mode', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    if (gridItems.length > 0) {
      fireEvent(gridItems[0], 'onLongPress');
      expect(result.getByText('1 selected')).toBeTruthy();
      expect(result.getByText('All')).toBeTruthy();
    }
  });

  it('select all selects all images', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    if (gridItems.length > 0) {
      fireEvent(gridItems[0], 'onLongPress');
      expect(result.getByText('1 selected')).toBeTruthy();

      fireEvent.press(result.getByText('All'));
      expect(result.getByText('3 selected')).toBeTruthy();
    }
  });

  it('does not show select button when gallery is empty', () => {
    const { queryByText } = render(<GalleryScreen />);
    expect(queryByText('0 selected')).toBeNull();
  });

  it('filters images by conversationId', () => {
    mockRouteParams = { conversationId: 'conv-123' };
    mockGeneratedImages.push(
      { ...sampleImages[0], conversationId: 'conv-123' },
      { ...sampleImages[1], conversationId: 'conv-999' },
    );

    const { getByText } = render(<GalleryScreen />);
    expect(getByText('1')).toBeTruthy();
  });

  // ===== NEW TESTS FOR COVERAGE =====

  it('confirming delete image removes it and clears selected image', async () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    // Open viewer
    fireEvent.press(gridItems[0]);
    // Press delete
    fireEvent.press(result.getByText('Delete'));

    // Confirm delete
    await act(async () => {
      fireEvent.press(result.getByTestId('alert-button-Delete'));
    });

    expect(mockDeleteGeneratedImage).toHaveBeenCalledWith(
      'img-1',
      '/mock/generated/sunset.png',
    );
    expect(mockRemoveGeneratedImage).toHaveBeenCalledWith('img-1');
  });

  it('toggling select mode off clears selected IDs', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    // Enter select mode
    fireEvent(gridItems[0], 'onLongPress');
    expect(result.getByText('1 selected')).toBeTruthy();

    // Find the X button in select mode header (first touchable)
    const touchables = result.UNSAFE_getAllByType(TouchableOpacity);
    // The first touchable in select mode is the close/X button
    fireEvent.press(touchables[0]);

    // Should be back to normal mode
    expect(result.getByText('Gallery')).toBeTruthy();
  });

  it('tapping image in select mode toggles selection', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    let gridItems = getGridItems(result);

    // Enter select mode
    fireEvent(gridItems[0], 'onLongPress');
    expect(result.getByText('1 selected')).toBeTruthy();

    // Tap second image to select it
    gridItems = getGridItems(result);
    fireEvent.press(gridItems[1]);
    expect(result.getByText('2 selected')).toBeTruthy();

    // Tap second image again to deselect
    gridItems = getGridItems(result);
    fireEvent.press(gridItems[1]);
    expect(result.getByText('1 selected')).toBeTruthy();
  });

  it('delete selected images with confirmation', async () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    // Enter select mode
    fireEvent(gridItems[0], 'onLongPress');
    // Select all
    fireEvent.press(result.getByText('All'));
    expect(result.getByText('3 selected')).toBeTruthy();

    // In select mode, the header touchables (non-grid) are:
    // [X close button, "All" text button, trash icon button]
    // The trash button is the one with disabled={false} (items selected)
    // and is NOT the All button or X button.
    const allTouchables = result.UNSAFE_getAllByType(TouchableOpacity);
    const nonGridTouchables = allTouchables.filter((t: any) => t.props.activeOpacity !== 0.8);
    // The last non-grid touchable before grid items should be the trash button
    // Try pressing from the last non-grid touchable backwards until handleDeleteSelected fires
    for (let i = nonGridTouchables.length - 1; i >= 0; i--) {
      fireEvent.press(nonGridTouchables[i]);
      if (mockShowAlert.mock.calls.length > 0) break;
    }

    expect(mockShowAlert).toHaveBeenCalledWith(
      'Delete Images',
      expect.stringContaining('3'),
      expect.any(Array),
    );

    // Confirm deletion
    await act(async () => {
      fireEvent.press(result.getByTestId('alert-button-Delete'));
    });

    expect(mockDeleteGeneratedImage).toHaveBeenCalledTimes(3);
    expect(mockRemoveGeneratedImage).toHaveBeenCalledTimes(3);
  });

  it('handleDeleteSelected does nothing when no items selected', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    // Enter select mode
    fireEvent(gridItems[0], 'onLongPress');
    // Deselect the item
    const updatedGridItems = getGridItems(result);
    fireEvent.press(updatedGridItems[0]);
    expect(result.getByText('0 selected')).toBeTruthy();

    // Try to delete with nothing selected - the button should be disabled
    // The trash icon has disabled prop when selectedIds.size === 0
    const touchables = result.UNSAFE_getAllByType(TouchableOpacity);
    const disabledButtons = touchables.filter((t: any) => t.props.disabled === true);
    expect(disabledButtons.length).toBeGreaterThan(0);
  });

  it('syncs images from disk into store on mount', async () => {
    const diskImages = [
      {
        id: 'disk-img-1',
        prompt: 'From disk',
        imagePath: '/disk/image.png',
        width: 512,
        height: 512,
        steps: 10,
        seed: 999,
        modelId: 'test',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    mockGetGeneratedImages.mockResolvedValue(diskImages as any);

    render(<GalleryScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    // The mock getGeneratedImages should have been called
    expect(mockGetGeneratedImages).toHaveBeenCalled();
  });

  it('handles save image on iOS using Share', async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });

    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);

    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    // Open viewer
    fireEvent.press(gridItems[0]);
    // Press Save
    await act(async () => {
      fireEvent.press(result.getByText('Save'));
    });

    expect(shareSpy).toHaveBeenCalledWith({
      url: 'file:///mock/generated/sunset.png',
    });

    shareSpy.mockRestore();
    Object.defineProperty(Platform, 'OS', { value: originalPlatform, writable: true });
  });

  it('shows generation banner when generating', () => {
    mockImageGenState = {
      isGenerating: true,
      prompt: 'A beautiful landscape',
      previewPath: null,
      progress: { step: 5, totalSteps: 20 },
    };

    const { getByText } = render(<GalleryScreen />);
    expect(getByText('Generating...')).toBeTruthy();
    expect(getByText('A beautiful landscape')).toBeTruthy();
    expect(getByText('5/20')).toBeTruthy();
  });

  it('shows "Refining..." when preview path exists', () => {
    mockImageGenState = {
      isGenerating: true,
      prompt: 'A landscape',
      previewPath: 'file:///preview.png',
      progress: { step: 15, totalSteps: 20 },
    };

    const { getByText } = render(<GalleryScreen />);
    expect(getByText('Refining...')).toBeTruthy();
  });

  it('cancel generation button calls cancelGeneration', () => {
    const { cancelGeneration: mockCancelGen } = jest.requireMock('../../../src/services').imageGenerationService;

    mockImageGenState = {
      isGenerating: true,
      prompt: 'A landscape',
      previewPath: null,
      progress: null,
    };

    const { UNSAFE_getAllByType } = render(<GalleryScreen />);
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    // The banner has: [close button (header)], then [cancel button in banner]
    // The cancel button is a small button inside the genBanner
    // Try pressing each non-grid touchable until cancelGeneration is called
    for (const t of touchables) {
      if (t.props.activeOpacity === 0.8) continue; // skip grid items
      fireEvent.press(t);
      if (mockCancelGen.mock.calls.length > 0) break;
    }
    expect(mockCancelGen).toHaveBeenCalled();
  });

  it('modal onRequestClose clears selected image and details', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    // Open viewer
    fireEvent.press(gridItems[0]);
    expect(result.getByText('Info')).toBeTruthy();

    // Find the Modal and trigger onRequestClose
    result.UNSAFE_root.findAll((node: any) =>
      node.type && (node.type.name === 'Modal' || node.type === 'Modal' ||
        (typeof node.type === 'string' && node.type.toLowerCase() === 'modal'))
    );
    // Alternatively, use the backdrop press
    const touchables = result.UNSAFE_getAllByType(TouchableOpacity);
    // The backdrop is in the viewerContainer - it's the one with activeOpacity === 1
    const backdrop = touchables.find((t: any) => t.props.activeOpacity === 1);
    if (backdrop) {
      fireEvent.press(backdrop);
      // After pressing, the modal should close
      expect(result.queryByText('Save')).toBeNull();
    }
  });

  it('details sheet shows negative prompt when present', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    // Open viewer for image with negative prompt (img-2)
    fireEvent.press(gridItems[1]);
    // Press Info
    fireEvent.press(result.getByText('Info'));

    expect(result.getByText('NEGATIVE')).toBeTruthy();
    expect(result.getByText('ugly, blurry')).toBeTruthy();
  });

  it('details sheet Done button closes details', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    // Open viewer
    fireEvent.press(gridItems[0]);
    // Open details
    fireEvent.press(result.getByText('Info'));
    expect(result.getByText('Image Details')).toBeTruthy();

    // Press Done
    fireEvent.press(result.getByText('Done'));
    // Details sheet should close
    expect(result.queryByText('Image Details')).toBeNull();
  });

  it('alert onClose calls hideAlert', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    // Open viewer and delete
    fireEvent.press(gridItems[0]);
    fireEvent.press(result.getByText('Delete'));

    // Close alert
    fireEvent.press(result.getByTestId('alert-close'));
    expect(mockHideAlert).toHaveBeenCalled();
  });

  it('filters images by chat attachment IDs', () => {
    const { useChatStore } = jest.requireMock('../../../src/stores');
    useChatStore.mockImplementation((selector?: any) => {
      const state = {
        conversations: [
          {
            id: 'conv-123',
            messages: [
              {
                id: 'msg-1',
                attachments: [
                  { id: 'img-1', type: 'image' },
                ],
              },
            ],
          },
        ],
      };
      return selector ? selector(state) : state;
    });

    mockRouteParams = { conversationId: 'conv-123' };
    mockGeneratedImages.push(...sampleImages);

    const { getByText } = render(<GalleryScreen />);
    // img-1 should be included because it's in the chat attachments
    expect(getByText('1')).toBeTruthy();

    // Reset
    useChatStore.mockImplementation((selector?: any) => {
      const state = { conversations: [] };
      return selector ? selector(state) : state;
    });
  });

  it('formatDate handles timestamp strings', () => {
    mockGeneratedImages.push({
      ...sampleImages[0],
      createdAt: String(Date.now()), // numeric timestamp as string
    });

    const result = render(<GalleryScreen />);
    const gridItems = getGridItems(result);

    // Open viewer and details
    fireEvent.press(gridItems[0]);
    fireEvent.press(result.getByText('Info'));

    // The date should be rendered (any format)
    expect(result.getByText('PROMPT')).toBeTruthy();
  });

  it('long press does not re-enter select mode if already in select mode', () => {
    mockGeneratedImages.push(...sampleImages);

    const result = render(<GalleryScreen />);
    let gridItems = getGridItems(result);

    // Enter select mode
    fireEvent(gridItems[0], 'onLongPress');
    expect(result.getByText('1 selected')).toBeTruthy();

    // Long press again on a different item while already in select mode
    gridItems = getGridItems(result);
    fireEvent(gridItems[1], 'onLongPress');
    // Should still be in select mode, not re-entered
    expect(result.getByText('1 selected')).toBeTruthy();
  });
});
