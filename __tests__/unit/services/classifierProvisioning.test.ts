/**
 * classifierProvisioning — downloads and selects the default SmolLM2 classifier so model routing works out
 * of the box.
 *
 * Real: ensureDefaultClassifier, startModelDownload (the one download entry point), modelManager and the
 * background download service, huggingFaceService, the stores. Faked (device / network): the native
 * background downloader, the disk and storage (harness/modelManagerDevice), and the Hugging Face API at
 * fetch (harness/hfModelApiServer).
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';
import { serveHfModelApi, type HfModelApiServer } from '../../harness/hfModelApiServer';
import { createDownloadedModel } from '../../utils/factories';

const REPO = 'bartowski/SmolLM2-135M-Instruct-GGUF';
const Q8 = 'SmolLM2-135M-Instruct-Q8_0.gguf';

let device: ModelManagerDevice;
let hf: HfModelApiServer;
let useAppStore: any;
let ensureDefaultClassifier: () => Promise<void>;

beforeEach(async () => {
  device = await installModelManagerDevice({ platform: 'android' });
  hf = serveHfModelApi({
    repos: {
      [REPO]: [
        { path: 'SmolLM2-135M-Instruct-Q4_K_M.gguf', size: 90 * 1024 * 1024 },
        { path: Q8, size: 145 * 1024 * 1024 },
      ],
    },
  });
  ({ useAppStore } = require('../../../src/stores'));
  ({ ensureDefaultClassifier } = require('../../../src/services/classifierProvisioning'));
});

afterEach(() => hf.restore());

const classifierId = () => useAppStore.getState().settings.classifierModelId;

describe('ensureDefaultClassifier', () => {
  it('does nothing when a downloaded classifier is already chosen', async () => {
    useAppStore.getState().addDownloadedModel(createDownloadedModel({ id: 'x/y.gguf' }));
    useAppStore.getState().updateSettings({ classifierModelId: 'x/y.gguf' });

    await ensureDefaultClassifier();

    expect(classifierId()).toBe('x/y.gguf');
    expect(device.nativeRows()).toHaveLength(0);
    expect(hf.requests).toHaveLength(0);
  });

  it('chooses the default classifier already on the phone instead of downloading it again', async () => {
    useAppStore.getState().addDownloadedModel(createDownloadedModel({ id: `${REPO}/${Q8}` }));

    await ensureDefaultClassifier();

    expect(classifierId()).toBe(`${REPO}/${Q8}`);
    expect(device.nativeRows()).toHaveLength(0);
  });

  it('downloads the Q8_0 file in the background and chooses it once the download is registered', async () => {
    await ensureDefaultClassifier();
    await device.settle();

    const rows = device.nativeRows();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).toContain(Q8);
    expect(classifierId()).toBeFalsy(); // not chosen before it is on the phone

    await device.finishDownload(rows[0].downloadId, 145 * 1024 * 1024);
    await device.settle();

    expect(useAppStore.getState().downloadedModels.map((m: any) => m.id)).toContain(`${REPO}/${Q8}`);
    expect(classifierId()).toBe(`${REPO}/${Q8}`);
  });

  it('starts one download when asked twice while the first is running', async () => {
    await Promise.all([ensureDefaultClassifier(), ensureDefaultClassifier()]);
    await device.settle();

    expect(device.nativeRows()).toHaveLength(1);
  });

  it('downloads nothing when Hugging Face does not answer, and can try again later', async () => {
    hf.serve({ status: 503 });

    await ensureDefaultClassifier();
    await device.settle();
    expect(device.nativeRows()).toHaveLength(0);

    hf.serve({ repos: { [REPO]: [{ path: Q8, size: 145 * 1024 * 1024 }] } });
    await ensureDefaultClassifier();
    await device.settle();
    expect(device.nativeRows()).toHaveLength(1);
  });
});
