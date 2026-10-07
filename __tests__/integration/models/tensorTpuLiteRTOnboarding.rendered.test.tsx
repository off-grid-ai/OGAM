/**
 * Pixel 10 (Tensor G5): its TPU runs only LiteRT builds compiled for it, and its GPU has no working
 * LiteRT path, so onboarding offers the Tensor G5 build there — and nowhere else, since no other phone
 * can run it.
 *
 * Real AdvancedSetupScreen + real hardwareService + curated registry; fakes ONLY the native boundary
 * (the LiteRT module's TPU probe answers like a Pixel 10, or like any other phone).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {}, replace: () => {} }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

async function renderOnboarding(tpu: { supported: boolean; tensorGeneration: number | null; reason: string | null }) {
  const boundary = installNativeBoundary({ ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  boundary.litert.module.getTpuSupport.mockResolvedValue(tpu);
  const React = require('react');
  const rtl = requireRTL();
  const { hardwareService } = require('../../../src/services/hardware');
  const { AdvancedSetupScreen } = require('../../../src/screens/ModelDownloadScreen');
  await hardwareService.getDeviceInfo();
  const nav: any = { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {}, replace: () => {} };
  const view = rtl.render(React.createElement(AdvancedSetupScreen, { navigation: nav }));
  await rtl.waitFor(() => { expect(view.getByTestId('onboarding-litert-model-1')).toBeTruthy(); }, { timeout: 10000 });
  return { rtl, view };
}

describe('Tensor TPU LiteRT build in onboarding', () => {
  it('offers the Tensor G5 build on a Pixel 10 whose TPU LiteRT can reach', async () => {
    const { rtl, view } = await renderOnboarding({ supported: true, tensorGeneration: 5, reason: null });
    const card = await rtl.waitFor(() => view.getByTestId('onboarding-litert-model-2'), { timeout: 10000 });
    expect(rtl.within(card).getByText('Gemma 4 E2B (Tensor TPU)')).toBeTruthy();
  }, 60000);

  it('does not offer it on a phone without a Tensor G5 TPU', async () => {
    const { view } = await renderOnboarding({ supported: false, tensorGeneration: null, reason: 'not_tensor' });
    expect(view.queryByText('Gemma 4 E2B (Tensor TPU)')).toBeNull();
    expect(view.queryByTestId('onboarding-litert-model-2')).toBeNull();
  }, 60000);
});
