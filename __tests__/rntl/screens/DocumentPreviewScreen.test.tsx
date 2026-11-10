/**
 * DocumentPreviewScreen Tests
 */

import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import RNFS from 'react-native-fs';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      goBack: mockGoBack,
      setOptions: jest.fn(),
    }),
    useRoute: () => ({
      params: { filePath: '/mock/documents/test.txt', fileName: 'test.txt', fileSize: 1024 },
    }),
  };
});

const mockProcessDocument = jest.fn();

jest.mock('../../../src/services', () => ({
  documentService: {
    processDocumentFromPath: (...args: any[]) => mockProcessDocument(...args),
  },
}));

const flushPromises = () => act(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
});

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

import { DocumentPreviewScreen } from '../../../src/screens/DocumentPreviewScreen';

describe('DocumentPreviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
    mockProcessDocument.mockResolvedValue({ textContent: 'Hello world content' });
  });

  describe('basic rendering', () => {
    it('shows the file name in header', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      const { getByText } = render(<DocumentPreviewScreen />);
      await flushPromises();
      expect(getByText('test.txt')).toBeTruthy();
    });

    it('shows file size in header when > 0', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      const { getByText } = render(<DocumentPreviewScreen />);
      await flushPromises();
      expect(getByText('1.0 KB')).toBeTruthy();
    });

    it('shows loading indicator initially', () => {
      const { UNSAFE_getByType } = render(<DocumentPreviewScreen />);
      const { ActivityIndicator } = require('react-native');
      expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    });
  });

  describe('content loading', () => {
    it('shows content when file exists and text extracted', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      mockProcessDocument.mockResolvedValue({ textContent: 'Hello world content' });
      const { getByText } = render(<DocumentPreviewScreen />);
      await flushPromises();
      expect(getByText('Hello world content')).toBeTruthy();
    });

    it('shows error when file not found in any location', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(false);
      const { getByText } = render(<DocumentPreviewScreen />);
      await flushPromises();
      expect(getByText(/File not found/)).toBeTruthy();
    });

    it('shows error when processDocument returns no text content', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      mockProcessDocument.mockResolvedValue({ textContent: null });
      const { getByText } = render(<DocumentPreviewScreen />);
      await flushPromises();
      expect(getByText('Could not extract text from this document')).toBeTruthy();
    });

    it('shows error when processDocument returns null', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      mockProcessDocument.mockResolvedValue(null);
      const { getByText } = render(<DocumentPreviewScreen />);
      await flushPromises();
      expect(getByText('Could not extract text from this document')).toBeTruthy();
    });

    it('shows error message when loadContent throws', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      mockProcessDocument.mockRejectedValue(new Error('Read failed'));
      const { getByText } = render(<DocumentPreviewScreen />);
      await flushPromises();
      expect(getByText('Read failed')).toBeTruthy();
    });
  });

  describe('file path decoding', () => {
    it('handles URL-encoded file paths', async () => {
      jest.mock('@react-navigation/native', () => ({
        ...jest.requireActual('@react-navigation/native'),
        useNavigation: () => ({ goBack: jest.fn(), setOptions: jest.fn() }),
        useRoute: () => ({
          params: { filePath: 'file:///mock%20path/doc.txt', fileName: 'doc.txt', fileSize: 0 },
        }),
      }));
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      mockProcessDocument.mockResolvedValue({ textContent: 'decoded content' });
      // just verify no crash
      render(<DocumentPreviewScreen />);
      await flushPromises();
    });

    it('tries uuid-stripped filename as fallback', async () => {
      // Simulate: file not at original path, but found at stripped path
      let callCount = 0;
      (RNFS.exists as jest.Mock).mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 3); // third check succeeds
      });

      jest.doMock('@react-navigation/native', () => ({
        ...jest.requireActual('@react-navigation/native'),
        useNavigation: () => ({ goBack: jest.fn(), setOptions: jest.fn() }),
        useRoute: () => ({
          params: {
            filePath: '/docs/abc123-myfile.txt',
            fileName: 'abc123-myfile.txt',
            fileSize: 0,
          },
        }),
      }));

      mockProcessDocument.mockResolvedValue({ textContent: 'content' });
      render(<DocumentPreviewScreen />);
      await flushPromises();
    });
  });

  describe('navigation', () => {
    it('calls goBack when back button pressed', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      const { getByText } = render(<DocumentPreviewScreen />);
      await flushPromises();
      fireEvent.press(getByText('arrow-left'));
      expect(mockGoBack).toHaveBeenCalled();
    });
  });
});

describe('DocumentPreviewScreen: save as Markdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    mockProcessDocument.mockResolvedValue({ textContent: '# Report\n\nBody text.' });
  });
  it('saves the converted text as <name>.md in the workspace Converted folder', async () => {
    jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => undefined);
    jest.doMock('../../../src/atlasTools/deviceTools', () => ({ workspaceDir: async () => '/ws' }));
    const { getByTestId } = render(<DocumentPreviewScreen />);
    await flushPromises();
    await act(async () => { fireEvent.press(getByTestId('save-markdown')); });
    expect(RNFS.writeFile).toHaveBeenCalledWith('/ws/Converted/test.md', '# Report\n\nBody text.', 'utf8');
  });
});
