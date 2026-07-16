/**
 * RENDERED (UI integration) — onboarding "Your Device" card shows TOTAL physical RAM.
 *
 * REGRESSION (shipped in 0.0.103): the card labelled "Available Memory" rendered
 * deviceInfo.availableMemory, which the memory-budget rework changed to the per-process
 * allocatable ceiling (os_proc_available_memory) — a small number that reads as a wrong
 * device spec. On a device with 8GB total but a ~4.57GB process ceiling, the card showed
 * "4.57 GB" as if that were the phone's memory.
 *
 * SPEC (OGAM user's view): the "Your Device" card shows the device's TOTAL RAM — the number
 * the user recognises and the same one the model recommendations gate on (getTotalMemoryGB).
 * The per-process ceiling is a budget input, never surfaced here.
 *
 * BOUNDARY: 8GB Android device whose process-available snapshot is 4.57GB. RED before the fix:
 * card shows "4.57 GB". GREEN after: it shows "8.00 GB" and never "4.57 GB".
 *
 * Real ModelDownloadScreen + real hardwareService/appStore; fakes ONLY at the native RAM sensor
 * (installNativeBoundary). NEVER mocks our own code.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {}, replace: () => {} }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('Onboarding "Your Device" card — shows total RAM, not the per-process ceiling', () => {
  it('shows 8.00 GB total on an 8GB device whose process-available is only 4.57GB', async () => {
    installNativeBoundary({ ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 4.57 * GB } });

    const React = require('react');
    const rtl = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const { ModelDownloadScreen } = require('../../../src/screens/ModelDownloadScreen');

    // Prime the RAM cache the way the screen's own effect does (device-boundary read, not our state).
    await hardwareService.getDeviceInfo();

    const nav: any = { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {}, replace: () => {} };
    const view = rtl.render(React.createElement(ModelDownloadScreen, { navigation: nav }));

    // The screen renders once device analysis is done (no longer blocked on the HF file fetch).
    await rtl.waitFor(() => { expect(view.getByText('Set Up Your AI')).toBeTruthy(); }, { timeout: 10000 });

    // The device card shows TOTAL RAM (8.00 GB) — NOT the per-process ceiling (4.57 GB).
    expect(view.getByText('8.00 GB')).toBeTruthy();
    expect(view.queryByText('4.57 GB')).toBeNull();
  }, 30000);
});
