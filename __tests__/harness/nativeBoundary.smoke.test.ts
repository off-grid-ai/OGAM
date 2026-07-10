/**
 * Harness self-test: proves installNativeBoundary() injects the LiteRT native fake so the REAL
 * liteRTService (a construct-time singleton that destructures NativeModules.LiteRTModule at import)
 * runs on top of it — and that we can drive native events into the real service. No assertions about
 * product bugs here; this only guards the harness's injection mechanism itself.
 */
import { installNativeBoundary } from './nativeBoundary';

describe('nativeBoundary harness — injection mechanism', () => {
  it('injects LiteRTModule so the real liteRTService sees it as available and load resolves', async () => {
    const boundary = installNativeBoundary({ ram: { platform: 'android', totalBytes: 12 * 1024 ** 3, availBytes: 8 * 1024 ** 3 } });

    // Require the REAL service AFTER seeding — its module-scope `const { LiteRTModule } = NativeModules`
    // must capture our fake.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { liteRTService } = require('../../src/services/litert');

    expect(liteRTService.isAvailable()).toBe(true);

    await liteRTService.loadModel('/models/gemma.litertlm', 'gpu', { maxNumTokens: 4096 });
    expect(boundary.litert.module.loadModel).toHaveBeenCalledWith(
      '/models/gemma.litertlm', 'gpu', false, false, 4096,
    );
  });

  it('scripts a tool-call turn: the REAL service dispatches the tool call and respondToToolCall, then completes empty', async () => {
    const boundary = installNativeBoundary();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { liteRTService } = require('../../src/services/litert');
    await liteRTService.loadModel('/m', 'gpu', {});

    // Native "model" emits one calculator tool call, then a completion with NO content.
    boundary.litert.scriptTurn({ toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }], content: '' });

    const seen: Array<{ name: string; args: Record<string, unknown> }> = [];
    const result = await liteRTService.generateRaw('what is 2+2', undefined, {
      onToolCall: async (name: string, args: Record<string, unknown>) => { seen.push({ name, args }); return '4'; },
    });

    expect(seen).toEqual([{ name: 'calculator', args: { expression: '2+2' } }]);
    expect(boundary.litert.module.respondToToolCall).toHaveBeenCalledWith('tc-0', '4');
    expect(result).toBe(''); // empty final turn — the exact Q5 precondition
  });

  it('seeds the RAM leaf so DeviceMemoryModule reports the seeded free bytes', async () => {
    installNativeBoundary({ ram: { platform: 'android', totalBytes: 12 * 1024 ** 3, availBytes: 640 * 1024 * 1024 } });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RN = require('react-native');
    const info = await RN.NativeModules.DeviceMemoryModule.getMemoryInfo();
    expect(info.processAvailableBytes).toBe(640 * 1024 * 1024);
    expect(RN.Platform.OS).toBe('android');
  });
});
