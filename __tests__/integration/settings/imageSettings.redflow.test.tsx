/**
 * RED-FLOW (UI integration) — image-settings bugs Q12 + Q13. Pure store + render: mounts the REAL
 * GenerationSettingsModal over the REAL appStore (no native leaf, so no harness needed) and asserts
 * what the user sees on the sliders. Deleting/altering the real store logic changes the result.
 *
 * Q12 — "Reset to defaults" resets only the 7 text params (index.tsx DEFAULT_SETTINGS), never the image
 *       ones, so after a reset the Image Size the user sees is unchanged.
 * Q13 (T067) — the two Image-Size surfaces must AGREE on the floor. Device ground truth
 *       (DEVICE_TEST_FINDINGS "Image size — Q1 GUARDED at input", confirmed with the product owner:
 *       "image cannot be lower than 256") makes 256 the intended floor and 128 UNREACHABLE. The bug was
 *       that the Model Settings screen slider allowed min 128 while the chat modal (ImageQualitySliders)
 *       floored at 256 — the surfaces diverged, so a 128 set from Model Settings was silently floored by
 *       the pipeline. Correct: both surfaces read the SAME floor (SWEET_SPOT_SIZE) so a persisted 128
 *       shows as 256 on BOTH, and 128x128 is nowhere. This asserts the chat-modal surface; the
 *       Model-Settings surface is asserted in imageSettingsSurfaceParity below.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { GenerationSettingsModal } from '../../../src/components/GenerationSettingsModal';
import { ImageGenerationSection } from '../../../src/screens/ModelSettingsScreen/ImageGenerationSection';
import { useAppStore } from '../../../src/stores';

/** Open Image section + its advanced controls so the Image Size slider is on screen. */
function openImageSettings(view: ReturnType<typeof render>) {
  fireEvent.press(view.getByText('IMAGE GENERATION'));
  fireEvent.press(view.getByTestId('modal-image-advanced-toggle'));
}

describe('image settings — UI red-flow (assert what the user sees)', () => {
  it('Q12: "Reset to defaults" also resets the Image Size the user sees', () => {
    // Preserve an explicit smaller size until the user resets it.
    useAppStore.getState().updateSettings({ imageWidth: 256, imageHeight: 256 });

    const view = render(<GenerationSettingsModal visible onClose={() => {}} />);
    openImageSettings(view);
    expect(view.getByText('256x256')).toBeTruthy();

    fireEvent.press(view.getByText('Reset to defaults'));

    expect(view.queryByText('256x256')).toBeNull();
    expect(view.queryByText('512x512')).not.toBeNull();
    expect(useAppStore.getState().settings.imageWidth).toBe(512);
    expect(useAppStore.getState().settings.imageHeight).toBe(512);
  });

  it('Q13: the chat modal Image Size floors a stale sub-256 value to the 256 sweet spot', () => {
    // A sub-256 width could reach the store from a stale persisted value or a programmatic path.
    useAppStore.getState().updateSettings({ imageWidth: 128, imageHeight: 128 });

    const view = render(<GenerationSettingsModal visible onClose={() => {}} />);
    openImageSettings(view);

    // Correct (device-confirmed floor of 256): the modal shows "256x256", never the garbage-tier 128.
    expect(view.queryByText('256x256')).not.toBeNull();
    expect(view.queryByText('128x128')).toBeNull();
  });

  it('Q13 (T067): the Model-Settings surface floors to the SAME 256 as the chat modal (no divergence)', () => {
    // The two surfaces must share ONE floor. A sub-256 value shows as 256 on BOTH — before the fix the
    // Model-Settings slider allowed min 128 and displayed 128x128 here while the chat modal showed 256x256.
    useAppStore.getState().updateSettings({ imageWidth: 128, imageHeight: 128 });

    // Chat modal surface.
    const modal = render(<GenerationSettingsModal visible onClose={() => {}} />);
    openImageSettings(modal);
    expect(modal.queryByText('256x256')).not.toBeNull();

    // Model Settings surface (real screen section on the real nav stack).
    const modelSettings = render(
      <NavigationContainer>
        <ImageGenerationSection />
      </NavigationContainer>,
    );
    // Both surfaces agree: 256x256, and neither shows the sub-floor 128x128.
    expect(modelSettings.queryByText('256x256')).not.toBeNull();
    expect(modelSettings.queryByText('128x128')).toBeNull();
  });
});
