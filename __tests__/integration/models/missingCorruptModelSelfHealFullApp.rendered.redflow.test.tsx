import { renderMainApp } from '../../harness/appJourney';
import { createDownloadedModel } from '../../utils/factories';

const HEALTHY_ID = 'test/healthy/healthy-Q4_K_M.gguf';
const MISSING_ID = 'test/missing/missing-Q4_K_M.gguf';
const CORRUPT_ID = 'test/corrupt/corrupt-Q4_K_M.gguf';

describe('APP-P1-007 downloaded-model filesystem self-heal', () => {
  it('removes missing and corrupt records so only a real ready model remains visible', async () => {
    const models = [
      createDownloadedModel({
        id: HEALTHY_ID,
        name: 'Healthy Model',
        fileName: 'healthy-Q4_K_M.gguf',
        filePath: '/docs/models/healthy-Q4_K_M.gguf',
        fileSize: 2048,
      }),
      createDownloadedModel({
        id: MISSING_ID,
        name: 'Missing Model',
        fileName: 'missing-Q4_K_M.gguf',
        filePath: '/docs/models/missing-Q4_K_M.gguf',
        fileSize: 2048,
      }),
      createDownloadedModel({
        id: CORRUPT_ID,
        name: 'Corrupt Model',
        fileName: 'corrupt-Q4_K_M.gguf',
        filePath: '/docs/models/corrupt-Q4_K_M.gguf',
        fileSize: 2048,
      }),
    ];
    const { asyncStorage, boundary, rtl, view } = await renderMainApp({
      downloadedModels: models,
      beforeRender: async ({ boundary: device }) => {
        await (device.fs!.module.unlink as (path: string) => Promise<void>)(
          '/docs/models/missing-Q4_K_M.gguf',
        );
        device.fs!.seedFile('/docs/models/corrupt-Q4_K_M.gguf', 128);
      },
    });

    await rtl.waitFor(() =>
      expect(view.getByTestId('model-summary-count-text')).toHaveTextContent(
        '1',
      ),
    );
    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() => {
      expect(view.getByTestId(`completed-download-${HEALTHY_ID}`)).toBeTruthy();
      expect(view.queryByTestId(`completed-download-${MISSING_ID}`)).toBeNull();
      expect(view.queryByTestId(`completed-download-${CORRUPT_ID}`)).toBeNull();
      expect(view.queryByText('Missing Model')).toBeNull();
      expect(view.queryByText('Corrupt Model')).toBeNull();
    });

    const stored = JSON.parse(
      (await asyncStorage.getItem('@local_llm/downloaded_models')) ?? '[]',
    );
    expect(stored.map((model: { id: string }) => model.id)).toEqual([
      HEALTHY_ID,
    ]);
    await expect(
      (boundary.fs!.module.exists as (path: string) => Promise<boolean>)(
        '/docs/models/corrupt-Q4_K_M.gguf',
      ),
    ).resolves.toBe(false);
  }, 30000);
});
