/**
 * useClearGpuCache — Clear GPU Cache in image settings. On an Android phone the native diffusion module keeps
 * compiled OpenCL kernels beside the model; clearing them makes the next image retune.
 *
 * The phone is the boundary: an Android phone with its native diffusion module (harness/nativeBoundary) and
 * the OS alert. The hook, the image generator service and the app store run for real, and the image model is
 * added to the store through its own actions.
 */
import { installNativeBoundary, requireRTL, GB, type NativeBoundary } from '../../harness/nativeBoundary';

let device: NativeBoundary;
let rtl: ReturnType<typeof requireRTL>;
let useClearGpuCache: typeof import('../../../src/hooks/useImageGenerationSettings')['useClearGpuCache'];
/** The OS alert: what the phone was asked to show. */
let osAlert: jest.SpyInstance;
const alerts = () => osAlert.mock.calls.map(([title, message]) => ({ title, message }));

/** An Android phone with `modelPath` as the downloaded, selected image model (or none). */
function phone(model: { id: string; modelPath: string | null } | null) {
  device = installNativeBoundary({ ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  rtl = requireRTL();
  osAlert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => undefined);
  const { useAppStore } = require('../../../src/stores');
  if (model) {
    useAppStore.getState().addDownloadedImageModel({ id: model.id, name: 'Image model', modelPath: model.modelPath } as never);
    useAppStore.getState().setActiveImageModelId(model.id);
  }
  ({ useClearGpuCache } = require('../../../src/hooks/useImageGenerationSettings'));
}

const activeModel = { id: 'model1', modelPath: '/path/to/model' };

describe('useClearGpuCache', () => {
  beforeEach(() => phone(activeModel));

  it('initializes with clearing=false', () => {
    const { result } = rtl.renderHook(() => useClearGpuCache());
    expect(result.current.clearing).toBe(false);
  });

  it('shows No Model alert when no active model', async () => {
    phone(null);
    const { result } = rtl.renderHook(() => useClearGpuCache());
    await rtl.act(async () => { result.current.handleClearCache(); });
    expect(alerts().map(a => a.title)).toEqual(['No Model']);
    expect(device.diffusion.module.clearOpenCLCache).not.toHaveBeenCalled();
  });

  it('shows No Model alert when active model has no modelPath', async () => {
    phone({ id: 'model1', modelPath: null });
    const { result } = rtl.renderHook(() => useClearGpuCache());
    await rtl.act(async () => { result.current.handleClearCache(); });
    expect(alerts().map(a => a.title)).toEqual(['No Model']);
  });

  it('asks the native module to clear the kernels beside the model', async () => {
    device.diffusion.module.clearOpenCLCache.mockResolvedValue(2);
    const { result } = rtl.renderHook(() => useClearGpuCache());
    await rtl.act(async () => { await result.current.handleClearCache(); });
    expect(device.diffusion.module.clearOpenCLCache.mock.calls).toEqual([['/path/to/model']]);
  });

  it('shows Cache Cleared alert with count on success', async () => {
    device.diffusion.module.clearOpenCLCache.mockResolvedValue(3);
    const { result } = rtl.renderHook(() => useClearGpuCache());
    await rtl.act(async () => { await result.current.handleClearCache(); });
    expect(alerts()).toEqual([{ title: 'Cache Cleared', message: expect.stringContaining('3') }]);
  });

  it('resets clearing to false after success', async () => {
    device.diffusion.module.clearOpenCLCache.mockResolvedValue(1);
    const { result } = rtl.renderHook(() => useClearGpuCache());
    await rtl.act(async () => { await result.current.handleClearCache(); });
    expect(result.current.clearing).toBe(false);
  });

  it('shows Error alert when clearOpenCLCache throws', async () => {
    device.diffusion.module.clearOpenCLCache.mockRejectedValue(new Error('GPU error'));
    const { result } = rtl.renderHook(() => useClearGpuCache());
    await rtl.act(async () => { await result.current.handleClearCache(); });
    expect(alerts()).toEqual([{ title: 'Error', message: expect.stringContaining('GPU error') }]);
  });

  it('resets clearing to false after error', async () => {
    device.diffusion.module.clearOpenCLCache.mockRejectedValue(new Error('fail'));
    const { result } = rtl.renderHook(() => useClearGpuCache());
    await rtl.act(async () => { await result.current.handleClearCache(); });
    expect(result.current.clearing).toBe(false);
  });
});
