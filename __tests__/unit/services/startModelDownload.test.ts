import type { OffGridApplication } from '@offgrid/application';
import { registerApplicationFacade } from '../../../src/services/applicationFacade';
import { startModelDownload } from '../../../src/services/startModelDownload';

const control = jest.fn();
const FILE = {
  name: 'model.Q4_K_M.gguf',
  size: 1_024,
  quantization: 'Q4_K_M',
  downloadUrl: 'https://huggingface.co/author/model/resolve/main/model.Q4_K_M.gguf',
};

beforeEach(() => {
  jest.clearAllMocks();
  control.mockResolvedValue({
    ok: true,
    value: { status: 'completed', operationId: 'queue-1', projection: {} },
  });
  registerApplicationFacade(() => ({ models: { control } } as unknown as OffGridApplication));
});

describe('startModelDownload', () => {
  it('sends only the selected repository and file to Shared admission', async () => {
    await startModelDownload('author/model', FILE);

    expect(control).toHaveBeenCalledWith({
      type: 'queue-download',
      modelId: 'author/model/model.Q4_K_M.gguf',
      selection: {
        repositoryId: 'author/model',
        fileName: 'model.Q4_K_M.gguf',
      },
    });
  });

  it('reports a Shared refusal through the presentation callback', async () => {
    control.mockResolvedValue({
      ok: false,
      failure: { kind: 'unknown_model', identifier: 'author/model' },
    });
    const onError = jest.fn();

    await startModelDownload('author/model', FILE, { onError });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
