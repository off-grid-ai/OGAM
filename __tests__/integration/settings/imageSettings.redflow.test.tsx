/**
 * RED-FLOW (UI integration) — image-settings bugs Q12 + Q13. Pure store + render: mounts the REAL
 * ModelSettingsScreen (Image tab) over the REAL appStore (no native leaf, so no harness needed) and
 * asserts what the user sees on the sliders. Deleting/altering the real store logic changes the result.
 * The chat's settings sheet no longer copies the image settings: its "Model settings" row opens this
 * same screen, so Model settings is now the one Image-Size surface.
 *
 * Q12 — "Reset to defaults" resets only the 7 text params (index.tsx DEFAULT_SETTINGS), never the image
 *       ones, so after a reset the Image Size the user sees is unchanged.
 * Q13 (T067) — the two Image-Size surfaces must AGREE on the floor. Device ground truth
 *       (DEVICE_TEST_FINDINGS "Image size — Q1 GUARDED at input", confirmed with the product owner:
 *       "image cannot be lower than 256") makes 256 the intended floor and 128 UNREACHABLE. The bug was
 *       that the Model Settings screen slider allowed min 128 while the chat modal (ImageQualitySliders)
 *       floored at 256 — the surfaces diverged, so a 128 set from Model Settings was silently floored by
 *       the pipeline. Correct: both surfaces read the SAME floor (SWEET_SPOT_SIZE) so a persisted 128
 *       shows as 256 on BOTH, and 128x128 is nowhere. With one surface left, the screen and its
 *       Image section (the component the screen renders) must both show 256.
 */
import React from 'react';
import { render, fireEvent, within } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { ModelSettingsScreen } from '../../../src/screens/ModelSettingsScreen';
import { ImageGenerationSection } from '../../../src/screens/ModelSettingsScreen/ImageGenerationSection';
import { useAppStore } from '../../../src/stores';

/** Open Model settings on its Image tab, where the Image size slider is. */
function openImageSettings() {
  const view = render(
    <NavigationContainer>
      <ModelSettingsScreen />
    </NavigationContainer>,
  );
  fireEvent.press(view.getByTestId('model-settings-tab-image'));
  expect(view.getByText('Image size')).toBeTruthy();
  return view;
}

describe('image settings — UI red-flow (assert what the user sees)', () => {
  it('Q12: "Reset to defaults" also resets the Image Size the user sees', () => {
    // Preserve an explicit smaller size until the user resets it.
    useAppStore.getState().updateSettings({ imageWidth: 256, imageHeight: 256 });

    const view = openImageSettings();
    expect(view.getByText('256x256')).toBeTruthy();

    fireEvent.press(view.getByLabelText('Reset to defaults'));
    // The alert's own Reset (the header button reads "Reset" too).
    fireEvent.press(within(view.getByTestId('app-alert')).getByText('Reset'));

    expect(view.queryByText('256x256')).toBeNull();
    expect(view.queryByText('512x512')).not.toBeNull();
    expect(useAppStore.getState().settings.imageWidth).toBe(512);
    expect(useAppStore.getState().settings.imageHeight).toBe(512);
  });

  it('Q13: Model settings floors a stale sub-256 Image Size to the 256 sweet spot', () => {
    // A sub-256 width could reach the store from a stale persisted value or a programmatic path.
    useAppStore.getState().updateSettings({ imageWidth: 128, imageHeight: 128 });

    const view = openImageSettings();

    // Correct (device-confirmed floor of 256): the screen shows "256x256", never the garbage-tier 128.
    expect(view.queryByText('256x256')).not.toBeNull();
    expect(view.queryByText('128x128')).toBeNull();
  });

  it('Q13 (T067): the Image section floors to the SAME 256 as the Model settings screen (no divergence)', () => {
    // One floor everywhere: a sub-256 value shows as 256 on the screen and in its section rendered alone.
    useAppStore.getState().updateSettings({ imageWidth: 128, imageHeight: 128 });

    const screen = openImageSettings();
    expect(screen.queryByText('256x256')).not.toBeNull();
    screen.unmount();

    const section = render(
      <NavigationContainer>
        <ImageGenerationSection />
      </NavigationContainer>,
    );
    expect(section.queryByText('256x256')).not.toBeNull();
    expect(section.queryByText('128x128')).toBeNull();
  });
});
