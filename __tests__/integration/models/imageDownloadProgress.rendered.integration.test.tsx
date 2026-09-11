import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

const MODEL = {
  id: 'anythingv5_cpu',
  name: 'AnythingV5',
  displayName: 'Anything V5 (GPU)',
  backend: 'mnn' as const,
  downloadUrl: 'https://huggingface.co/xororz/sd-mnn/resolve/main/AnythingV5.zip',
  fileName: 'AnythingV5.zip',
  size: 1_000,
  repo: 'xororz/sd-mnn',
};
const MODEL_ID = `image:${MODEL.id}`;
let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

describe('Image Models download projection', () => {
  it('shows progress inline after the user starts an image download', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    jest.spyOn(global, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith('/xororz/sd-mnn/tree/main')) {
        return {
          ok: true,
          json: async () => [{
            type: 'file',
            path: MODEL.fileName,
            size: MODEL.size,
            lfs: { oid: 'sha256:image-model', size: MODEL.size, pointerSize: 128 },
          }],
        } as Response;
      }
      if (url.endsWith('/xororz/sd-qnn/tree/main')) {
        return { ok: true, json: async () => [] } as unknown as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();

    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    const ui = render(React.createElement(ModelsScreen));

    fireEvent.press(ui.getByText('Image'));
    await waitFor(() => expect(ui.getByText(MODEL.displayName)).toBeTruthy());
    await act(async () => {
      fireEvent.press(ui.getByTestId('image-model-card-0-download'));
    });
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));

    const nativeRow = boundary.download!.active()[0]!;
    expect(fixture.application.models.snapshot().control.downloads).toEqual(
      expect.arrayContaining([expect.objectContaining({ modelId: MODEL_ID })]),
    );
    act(() => boundary.download!.progress(nativeRow.downloadId, 400, MODEL.size));

    await waitFor(() => expect(ui.getByText('40%')).toBeTruthy());
    expect(ui.getByText('400 B / 1000 B')).toBeTruthy();
    expect(ui.getByTestId('image-model-card-0-pause')).toBeTruthy();

    fireEvent.press(ui.getByTestId('image-model-card-0-cancel'));
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(0));
    await waitFor(() => expect(ui.getByTestId('image-model-card-0-download')).toBeTruthy());
  }, 30000);
});
