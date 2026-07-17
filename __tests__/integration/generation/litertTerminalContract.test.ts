/** LiteRT sends settle only on terminal native state, including tools, errors, and Stop. */
import { installNativeBoundary } from '../../harness/nativeBoundary';

type LiteRTService =
  typeof import('../../../src/services/litert').liteRTService;

async function setup(): Promise<{
  boundary: ReturnType<typeof installNativeBoundary>;
  service: LiteRTService;
}> {
  const boundary = installNativeBoundary();
  const { liteRTService: service } =
    require('../../../src/services/litert') as {
      liteRTService: LiteRTService;
    };
  await service.loadModel('/docs/models/terminal.litertlm', 'gpu');
  return { boundary, service };
}

const callbacks = () => ({
  onToken: () => {},
  onReasoning: () => {},
  onComplete: () => {},
  onError: () => {},
});

describe('LiteRT terminal send contract', () => {
  it('does not resolve on command acceptance and settles when native completes', async () => {
    const { boundary, service } = await setup();
    boundary.litert.scriptHang();
    let settled = false;
    const send = service.sendMessage('hello', callbacks()).then(() => {
      settled = true;
    });

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    boundary.litertEvents.emit('litert_complete', '{}');
    await send;
    expect(settled).toBe(true);
  });

  it('settles a pending send when Stop supersedes a native turn with no terminal event', async () => {
    const { boundary, service } = await setup();
    boundary.litert.scriptHang();
    const send = service.sendMessage('hello', callbacks());

    await new Promise(resolve => setTimeout(resolve, 20));
    await service.stopGeneration();
    await expect(send).resolves.toBeUndefined();
  });

  it('waits through a native tool call and returns the completed answer', async () => {
    const { boundary, service } = await setup();
    boundary.litert.scriptTurn({
      toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }],
      content: 'The answer is four.',
    });

    await expect(
      service.generateRaw('calculate', undefined, {
        onToolCall: async () => '4',
      }),
    ).resolves.toBe('The answer is four.');
  });

  it('rejects instead of hanging when a terminal callback throws', async () => {
    const { boundary, service } = await setup();
    boundary.litert.scriptTurn({ content: 'done' });

    await expect(
      service.sendMessage('hello', {
        ...callbacks(),
        onComplete: () => {
          throw new Error('callback failed');
        },
      }),
    ).rejects.toThrow('callback failed');
  });
});
