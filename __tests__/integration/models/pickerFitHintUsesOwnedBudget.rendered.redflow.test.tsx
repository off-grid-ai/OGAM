/**
 * RED-FLOW (UI integration) — the Home "Text Models" picker's "(may not fit)" hint must come from
 * the ONE owned memory budget (memoryBudget.fileExceedsBudget — device-tier fraction of TOTAL RAM,
 * reclaim-aware), not a hand-rolled "current free RAM minus 1.5GB" check.
 *
 * Device ground truth (screenshots 2026-07-14 01:24, 12GB phone): with gemma-4-E2B (4.3GB est)
 * resident, EVERY model in the picker — including the 2.41GB E2B (~3.6GB est) — was tagged
 * "(may not fit)". A 12GB Android phone's model budget is ~8.4GB (12 × 0.70); these models fit
 * trivially. The picker's verdict compared against instantaneous FREE RAM, which the resident
 * model had consumed — the DR3 drift (third fit verdict bypassing memoryBudget.ts).
 *
 * The REAL ModelPickerSheet is mounted with the REAL activeModelService.getResourceUsage() read
 * over the seeded RAM boundary (12GB total, 4.5GB free — the resident-model device state), the
 * same wiring Home passes it. RED on HEAD: the 2.89GB model carries "(may not fit)". Falsifier:
 * a model whose file genuinely exceeds the device budget (9.6GB > 8.4GB) KEEPS the tag.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('Home picker fit hint — owned budget, not instantaneous free RAM (DR3, device 01:24)', () => {
  it('a 2.89GB model on a 12GB phone shows NO "(may not fit)" even with RAM currently consumed', async () => {
    // Device boundary: the 01:24 screenshot state — 12GB phone, ~4.5GB currently free.
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 4.5 * GB } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const rtl = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const { activeModelService } = require('../../../src/services/activeModelService');
    const { ModelPickerSheet } = require('../../../src/screens/HomeScreen/components/ModelPickerSheet');
    /* eslint-enable @typescript-eslint/no-var-requires */

    const docs = boundary.fs!.DocumentDirectoryPath;
    const seed = (id: string, fileName: string, size: number) => {
      boundary.fs!.seedFile(`${docs}/models/${fileName}`, 1024);
      return createDownloadedModel({ id, name: id, engine: 'llama', filePath: `${docs}/models/${fileName}`, fileName, fileSize: size });
    };
    // The device report's model (2.89GB) + a genuinely-over-budget one (9.6GB > 12GB × 0.70 ≈ 8.4GB).
    const models = [seed('gemma-e2b-gguf', 'e2b.gguf', 2.89 * GB), seed('huge-model', 'huge.gguf', 9.6 * GB)];
    await hardwareService.refreshMemoryInfo();
    // The REAL memory numbers Home hands the sheet, read through the real service over the boundary.
    const memoryInfo = await activeModelService.getResourceUsage();

    const view = rtl.render(React.createElement(ModelPickerSheet, {
      visible: true, pickerType: 'text', onClose: () => {},
      downloadedModels: models, downloadedImageModels: [],
      activeModelId: null, activeImageModelId: null,
      activeRemoteTextModelId: null, activeRemoteImageModelId: null,
      remoteTextModels: [], remoteImageModels: [],
      memoryInfo, loadingState: { isLoading: false },
      onSelectTextModel: () => {}, onSelectImageModel: () => {},
      onUnloadTextModel: () => {}, onUnloadImageModel: () => {},
      onSelectRemoteTextModel: () => {}, onUnloadRemoteTextModel: () => {},
      onSelectRemoteImageModel: () => {}, onUnloadRemoteImageModel: () => {},
      onBrowseModels: () => {}, onAddServer: () => {},
    }));
    await rtl.waitFor(() => { expect(view.queryAllByTestId('model-item').length).toBeGreaterThanOrEqual(2); }, { timeout: 4000 });
    await rtl.waitFor(() => { expect(view.queryAllByText(/GB RAM/).length).toBeGreaterThanOrEqual(2); }, { timeout: 4000 });

    // Falsifier first: the genuinely-over-budget model KEEPS its warning (the tag still means something).
    expect(view.queryByText(/~14\.\d GB RAM \(may not fit\)/)).not.toBeNull();

    // RED on HEAD: the 2.89GB model (est ~4.3GB) is tagged "(may not fit)" on a 12GB phone because the
    // check used FREE RAM (4.5GB - 1.5) instead of the owned device budget (~8.4GB). It must show the
    // plain hint with NO tag.
    expect(view.queryByText('~4.3 GB RAM')).not.toBeNull();
  }, 30000);
});
