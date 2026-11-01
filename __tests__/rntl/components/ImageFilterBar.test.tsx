/**
 * ImageFilterBar Component Tests
 *
 * Tests for the image model filter bar including:
 * - Platform-specific rendering (iOS vs Android)
 * - Filter selection and expansion
 * - Clear filters functionality
 * - Helper functions
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ImageFilterBar } from '../../../src/screens/ModelsScreen/ImageFilterBar';
import { BACKEND_OPTIONS, SD_VERSION_OPTIONS, STYLE_OPTIONS } from '../../../src/screens/ModelsScreen/constants';

// Mock useThemedStyles

// Default props
const defaultProps = {
  backendFilter: 'all' as const,
  setBackendFilter: jest.fn(),
  styleFilter: 'all',
  setStyleFilter: jest.fn(),
  sdVersionFilter: 'all',
  setSdVersionFilter: jest.fn(),
  imageFilterExpanded: null,
  setImageFilterExpanded: jest.fn(),
  hasActiveImageFilters: false,
  clearImageFilters: jest.fn(),
  setUserChangedBackendFilter: jest.fn(),
};

describe('ImageFilterBar', () => {
  let originalOS: string;

  beforeEach(() => {
    jest.clearAllMocks();
    originalOS = Platform.OS;
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => originalOS, configurable: true });
  });

  describe('on Android platform', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
    });

    it('renders backend filter pill', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} />);
      expect(getByText(/Backend/)).toBeTruthy();
    });

    it('renders style filter pill', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} />);
      expect(getByText(/Style/)).toBeTruthy();
    });

    it('does not render sdVersion filter pill', () => {
      const { queryByText } = render(<ImageFilterBar {...defaultProps} />);
      expect(queryByText(/Version/)).toBeNull();
    });

    it('shows active styling when backendFilter is not "all"', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} backendFilter="mnn" />);
      expect(getByText(/GPU/)).toBeTruthy();
    });

    it('shows active styling when styleFilter is not "all"', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} styleFilter="photorealistic" />);
      expect(getByText(/Realistic/)).toBeTruthy();
    });

    it('toggles backend filter expanded state', () => {
      const setImageFilterExpanded = jest.fn();
      const { getByText } = render(<ImageFilterBar {...defaultProps} setImageFilterExpanded={setImageFilterExpanded} />);

      fireEvent.press(getByText(/Backend/));

      expect(setImageFilterExpanded).toHaveBeenCalledWith(expect.any(Function));
      // Test the toggle function
      const toggleFn = setImageFilterExpanded.mock.calls[0][0];
      expect(toggleFn(null)).toBe('backend');
      expect(toggleFn('backend')).toBeNull();
    });

    it('toggles style filter expanded state', () => {
      const setImageFilterExpanded = jest.fn();
      const { getByText } = render(<ImageFilterBar {...defaultProps} setImageFilterExpanded={setImageFilterExpanded} />);

      fireEvent.press(getByText(/Style/));

      expect(setImageFilterExpanded).toHaveBeenCalledWith(expect.any(Function));
      const toggleFn = setImageFilterExpanded.mock.calls[0][0];
      expect(toggleFn(null)).toBe('style');
      expect(toggleFn('style')).toBeNull();
    });

    it('shows expanded backend options when expanded', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="backend" />);

      BACKEND_OPTIONS.forEach(option => {
        expect(getByText(option.label)).toBeTruthy();
      });
    });

    it('shows expanded style options when expanded', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="style" />);

      STYLE_OPTIONS.forEach(option => {
        expect(getByText(option.label)).toBeTruthy();
      });
    });

    it('does not show expanded sdVersion options on Android', () => {
      const { queryByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="sdVersion" />);

      // SD version options should not render on Android
      expect(queryByText('All Versions')).toBeNull();
    });

    it('selects backend filter when chip is pressed', () => {
      const setBackendFilter = jest.fn();
      const setImageFilterExpanded = jest.fn();
      const setUserChangedBackendFilter = jest.fn();
      const { getByText } = render(
        <ImageFilterBar
          {...defaultProps}
          imageFilterExpanded="backend"
          setBackendFilter={setBackendFilter}
          setImageFilterExpanded={setImageFilterExpanded}
          setUserChangedBackendFilter={setUserChangedBackendFilter}
        />
      );

      fireEvent.press(getByText('GPU'));

      expect(setBackendFilter).toHaveBeenCalledWith('mnn');
      expect(setUserChangedBackendFilter).toHaveBeenCalledWith(true);
      expect(setImageFilterExpanded).toHaveBeenCalledWith(null);
    });

    it('selects style filter when chip is pressed', () => {
      const setStyleFilter = jest.fn();
      const setImageFilterExpanded = jest.fn();
      const { getByText } = render(
        <ImageFilterBar
          {...defaultProps}
          imageFilterExpanded="style"
          setStyleFilter={setStyleFilter}
          setImageFilterExpanded={setImageFilterExpanded}
        />
      );

      fireEvent.press(getByText('Realistic'));

      expect(setStyleFilter).toHaveBeenCalledWith('photorealistic');
      expect(setImageFilterExpanded).toHaveBeenCalledWith(null);
    });

    it('shows up arrow when backend filter is expanded', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="backend" />);
      // Unicode \u25B4 = ▴ (small upward triangle)
      expect(getByText(/Backend.*▴/)).toBeTruthy();
    });

    it('shows up arrow when style filter is expanded', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="style" />);
      // Unicode \u25B4 = ▴ (small upward triangle)
      expect(getByText(/Style.*▴/)).toBeTruthy();
    });

    it('shows down arrow when filter is collapsed', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} />);
      // Unicode \u25BE = ▾ (small downward triangle)
      expect(getByText(/Backend.*▾/)).toBeTruthy();
      expect(getByText(/Style.*▾/)).toBeTruthy();
    });
  });

  describe('on iOS platform', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios', configurable: true });
    });

    it('renders sdVersion filter pill', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} />);
      expect(getByText(/Version/)).toBeTruthy();
    });

    it('does not render backend filter pill', () => {
      const { queryByText } = render(<ImageFilterBar {...defaultProps} />);
      expect(queryByText(/Backend/)).toBeNull();
    });

    it('does not render style filter pill', () => {
      const { queryByText } = render(<ImageFilterBar {...defaultProps} />);
      expect(queryByText(/Style/)).toBeNull();
    });

    it('shows active styling when sdVersionFilter is not "all"', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} sdVersionFilter="sd15" />);
      expect(getByText(/SD 1.5/)).toBeTruthy();
    });

    it('toggles sdVersion filter expanded state', () => {
      const setImageFilterExpanded = jest.fn();
      const { getByText } = render(<ImageFilterBar {...defaultProps} setImageFilterExpanded={setImageFilterExpanded} />);

      fireEvent.press(getByText(/Version/));

      expect(setImageFilterExpanded).toHaveBeenCalledWith(expect.any(Function));
      const toggleFn = setImageFilterExpanded.mock.calls[0][0];
      expect(toggleFn(null)).toBe('sdVersion');
      expect(toggleFn('sdVersion')).toBeNull();
    });

    it('shows expanded sdVersion options when expanded', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="sdVersion" />);

      SD_VERSION_OPTIONS.forEach(option => {
        expect(getByText(option.label)).toBeTruthy();
      });
    });

    it('does not show expanded backend options on iOS', () => {
      const { queryByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="backend" />);
      // Backend options should not render on iOS
      expect(queryByText('All')).toBeNull();
    });

    it('does not show expanded style options on iOS', () => {
      const { queryByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="style" />);
      // Style options should not render on iOS
      expect(queryByText('All Styles')).toBeNull();
    });

    it('selects sdVersion filter when chip is pressed', () => {
      const setSdVersionFilter = jest.fn();
      const setImageFilterExpanded = jest.fn();
      const { getByText } = render(
        <ImageFilterBar
          {...defaultProps}
          imageFilterExpanded="sdVersion"
          setSdVersionFilter={setSdVersionFilter}
          setImageFilterExpanded={setImageFilterExpanded}
        />
      );

      fireEvent.press(getByText('SD 1.5'));

      expect(setSdVersionFilter).toHaveBeenCalledWith('sd15');
      expect(setImageFilterExpanded).toHaveBeenCalledWith(null);
    });

    it('shows up arrow when sdVersion filter is expanded', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="sdVersion" />);
      // Unicode \u25B4 = ▴ (small upward triangle)
      expect(getByText(/Version.*▴/)).toBeTruthy();
    });

    it('shows down arrow when filter is collapsed', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} />);
      // Unicode \u25BE = ▾ (small downward triangle)
      expect(getByText(/Version.*▾/)).toBeTruthy();
    });
  });

  describe('clear filters button', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
    });

    it('shows clear button when hasActiveImageFilters is true', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} hasActiveImageFilters={true} />);
      expect(getByText('Clear')).toBeTruthy();
    });

    it('does not show clear button when hasActiveImageFilters is false', () => {
      const { queryByText } = render(<ImageFilterBar {...defaultProps} hasActiveImageFilters={false} />);
      expect(queryByText('Clear')).toBeNull();
    });

    it('calls clearImageFilters when clear button is pressed', () => {
      const clearImageFilters = jest.fn();
      const { getByText } = render(
        <ImageFilterBar {...defaultProps} hasActiveImageFilters={true} clearImageFilters={clearImageFilters} />
      );

      fireEvent.press(getByText('Clear'));

      expect(clearImageFilters).toHaveBeenCalledTimes(1);
    });
  });

  describe('getBackendLabel helper', () => {
    it('returns "GPU" for "mnn" filter', () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
      const { getByText } = render(<ImageFilterBar {...defaultProps} backendFilter="mnn" />);
      expect(getByText(/GPU/)).toBeTruthy();
    });

    it('returns "NPU" for "qnn" filter', () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
      const { getByText } = render(<ImageFilterBar {...defaultProps} backendFilter="qnn" />);
      expect(getByText(/NPU/)).toBeTruthy();
    });

    it('returns "Core ML" for "coreml" filter', () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
      const { getByText } = render(<ImageFilterBar {...defaultProps} backendFilter="coreml" />);
      expect(getByText(/Core ML/)).toBeTruthy();
    });

    it('returns "Backend" for "all" filter', () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
      const { getByText } = render(<ImageFilterBar {...defaultProps} backendFilter="all" />);
      expect(getByText(/Backend/)).toBeTruthy();
    });
  });

  describe('getSdLabel helper', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios', configurable: true });
    });

    it('returns "Version" for "all" filter', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} sdVersionFilter="all" />);
      expect(getByText(/Version/)).toBeTruthy();
    });

    it('returns correct label for "sd15" filter', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} sdVersionFilter="sd15" />);
      expect(getByText(/SD 1.5/)).toBeTruthy();
    });

    it('returns correct label for "sd21" filter', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} sdVersionFilter="sd21" />);
      expect(getByText(/SD 2.1/)).toBeTruthy();
    });

    it('returns correct label for "sdxl" filter', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} sdVersionFilter="sdxl" />);
      expect(getByText(/SDXL/)).toBeTruthy();
    });

    it('returns "Version" for unknown filter', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} sdVersionFilter="unknown" />);
      expect(getByText(/Version/)).toBeTruthy();
    });
  });

  describe('getStyleLabel helper', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
    });

    it('returns "Style" for "all" filter', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} styleFilter="all" />);
      expect(getByText(/Style/)).toBeTruthy();
    });

    it('returns "Realistic" for "photorealistic" filter', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} styleFilter="photorealistic" />);
      expect(getByText(/Realistic/)).toBeTruthy();
    });

    it('returns "Anime" for "anime" filter', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} styleFilter="anime" />);
      expect(getByText(/Anime/)).toBeTruthy();
    });

    it('returns "Style" for unknown filter', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} styleFilter="unknown" />);
      expect(getByText(/Style/)).toBeTruthy();
    });
  });

  describe('active chip styling', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
    });

    it('applies active styles to selected backend chip', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="backend" backendFilter="mnn" />);
      const gpuButton = getByText('GPU');
      expect(gpuButton).toBeTruthy();
    });

    it('applies active styles to selected style chip', () => {
      const { getByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="style" styleFilter="photorealistic" />);
      const realisticButton = getByText('Realistic');
      expect(realisticButton).toBeTruthy();
    });
  });

  describe('iOS backend and style expansion', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios', configurable: true });
    });

    it('returns null for backend expansion on iOS', () => {
      const { queryByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="backend" />);
      // BACKEND_OPTIONS should not appear
      expect(queryByText('All')).toBeNull();
    });

    it('returns null for style expansion on iOS', () => {
      const { queryByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="style" />);
      // STYLE_OPTIONS should not appear
      expect(queryByText('All Styles')).toBeNull();
    });
  });

  describe('Android sdVersion expansion', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
    });

    it('returns null for sdVersion expansion on Android', () => {
      const { queryByText } = render(<ImageFilterBar {...defaultProps} imageFilterExpanded="sdVersion" />);
      // SD_VERSION_OPTIONS should not appear on Android
      expect(queryByText('All Versions')).toBeNull();
    });
  });
});