/**
 * ImageProgressIndicator — the placeholder image glyph must disappear once the live preview renders.
 *
 * Device 2026-07-16: during "Refining Image" the real preview thumbnail is shown, but the placeholder
 * <Icon name="image"> stayed in the header and overlapped/duplicated the image. It's only meaningful in
 * the pre-preview "Generating Image" phase. Presentational component (styles/colors injected), so this
 * renders it directly with both states and asserts the placeholder's presence tracks imagePreviewPath.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { ImageProgressIndicator } from '../../../src/screens/ChatScreen/ChatScreenComponents';

// The component reads styles/colors purely for presentation; return benign values for any key.
const styles = new Proxy({}, { get: () => ({}) }) as never;
const colors = new Proxy({}, { get: () => '#000000' }) as never;

const renderIndicator = (imagePreviewPath: string | null) =>
  render(
    <ImageProgressIndicator
      styles={styles}
      colors={colors}
      imagePreviewPath={imagePreviewPath}
      imageGenerationStatus="Refining"
      imageGenerationProgress={{ step: 7, totalSteps: 8 }}
      onStop={() => {}}
    />,
  );

describe('ImageProgressIndicator placeholder glyph', () => {
  it('shows the placeholder image glyph BEFORE a preview exists (Generating Image)', () => {
    const { queryByTestId } = renderIndicator(null);
    expect(queryByTestId('image-progress-placeholder-icon')).not.toBeNull();
  });

  it('HIDES the placeholder glyph once the live preview is showing (Refining Image)', () => {
    // The real thumbnail is up — the placeholder would just overlap it.
    const { queryByTestId } = renderIndicator('file:///tmp/preview.png');
    expect(queryByTestId('image-progress-placeholder-icon')).toBeNull();
  });
});
