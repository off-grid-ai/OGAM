/** Integration: real Shared admission and residency through Mobile, with native boundaries only. */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

type Alert = {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: Array<{ text: string; onPress?: () => void }>;
};

function driveLoad(activeModelService: any, modelId = 'm') {
  const alerts: Alert[] = [];
  let lastLoad: Promise<void> | undefined;
  const attempt = (options?: { override?: boolean }) => {
    lastLoad = activeModelService.loadTextModel(modelId, undefined, options);
    return lastLoad;
  };
  const {
    loadModelWithOverride,
  } = require('../../../src/services/loadModelWithOverride');
  const start = () =>
    loadModelWithOverride(attempt, {
      setAlertState: (alert: Alert) => alerts.push(alert),
    });
  const visible = () => [...alerts].reverse().find(alert => alert.visible);
  const tapLoadAnyway = async () => {
    const button = visible()?.buttons?.find(
      candidate => candidate.text === 'Load Anyway',
    );
    if (!button?.onPress)
      throw new Error('The memory refusal did not offer Load Anyway.');
    button.onPress();
    await Promise.resolve();
    await lastLoad;
  };
  return { alerts, start, visible, tapLoadAnyway };
}

function hasResidentTextModel(
  modelResidencyManager: {
    getResidents(): readonly { type: string; modelId?: string }[];
  },
  modelId = 'm',
) {
  return modelResidencyManager
    .getResidents()
    .some(resident => resident.type === 'text' && resident.modelId === modelId);
}

async function setup() {
  const h = await setupChatScreen({
    engine: 'llama',
    deferInitialLoad: true,
    modelFileSizeBytes: 10 * GB,
    platform: 'ios',
    ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  const { modelResidencyManager } =
    require('../../harness/activeModelLifecycle') as typeof import('../../harness/activeModelLifecycle');
  const lifecycle =
    require('../../../src/services/modelServices/modelLifecycleBootstrap') as typeof import('../../../src/services/modelServices/modelLifecycleBootstrap');
  const activeModelService = {
    loadTextModel: lifecycle.loadTextModel,
    unloadTextModel: lifecycle.unloadTextModel,
  };
  const unloadVictim = jest.fn(async () => ({ reclaimed: true as const }));
  const lease = await modelResidencyManager.acquire(
    {
      key: 'transcription',
      type: 'transcription',
      modelId: 'stt-1',
      sizeMB: 1000,
      dirtyMemory: false,
    },
    { load: async () => undefined, unload: unloadVictim },
  );
  await lease.release();
  h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', 10 * GB);
  h.boundary.setRam({
    platform: 'ios',
    totalBytes: 12 * GB,
    availBytes: 5 * GB,
  });
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.refreshMemoryInfo();
  expect(modelResidencyManager.hasSessionOverride('m')).toBe(false);
  expect(modelResidencyManager.getLoadPolicy()).toBe('balanced');
  return { h, activeModelService, modelResidencyManager, unloadVictim };
}

describe('Load Anyway override chain (Mobile alert -> Shared lifecycle -> native boundary)', () => {
  it('offers an overridable refusal without loading or evicting', async () => {
    const s = await setup();
    const ui = driveLoad(s.activeModelService);
    await ui.start();

    expect(ui.visible()?.title).toBe('Insufficient Memory');
    expect(ui.visible()?.buttons?.map(button => button.text)).toEqual([
      'Cancel',
      'Load Anyway',
    ]);
    expect(s.h.boundary.llama!.module.initLlama).not.toHaveBeenCalled();
    expect(s.unloadVictim).not.toHaveBeenCalled();
    expect(s.modelResidencyManager.isResident('transcription')).toBe(true);
  });

  it('evicts the clean resident and loads after Load Anyway', async () => {
    const s = await setup();
    const ui = driveLoad(s.activeModelService);
    await ui.start();
    await ui.tapLoadAnyway();

    expect(s.unloadVictim).toHaveBeenCalledTimes(1);
    expect(s.modelResidencyManager.isResident('transcription')).toBe(false);
    expect(s.h.boundary.llama!.module.initLlama).toHaveBeenCalledTimes(1);
    expect(hasResidentTextModel(s.modelResidencyManager)).toBe(true);
    expect(ui.alerts.map(alert => alert.title)).not.toContain('Error');
  });

  it('keeps Load Anyway unconditional when free RAM remains low', async () => {
    const s = await setup();
    const ui = driveLoad(s.activeModelService);
    await ui.start();
    expect(ui.visible()?.title).toBe('Insufficient Memory');
    await ui.tapLoadAnyway();

    expect(s.h.boundary.llama!.module.initLlama).toHaveBeenCalledTimes(1);
    expect(hasResidentTextModel(s.modelResidencyManager)).toBe(true);
    expect(
      ui.alerts.filter(alert => alert.title === 'Insufficient Memory'),
    ).toHaveLength(1);
    expect(ui.alerts.map(alert => alert.title)).not.toContain('Error');
  });

  it('remembers the approved override for the session', async () => {
    const s = await setup();
    const first = driveLoad(s.activeModelService);
    await first.start();
    await first.tapLoadAnyway();
    expect(s.modelResidencyManager.hasSessionOverride('m')).toBe(true);

    await s.activeModelService.unloadTextModel(true);
    s.h.boundary.llama!.module.initLlama.mockClear();
    const second = driveLoad(s.activeModelService);
    await second.start();

    expect(
      second.alerts.some(alert => alert.title === 'Insufficient Memory'),
    ).toBe(false);
    expect(s.h.boundary.llama!.module.initLlama).toHaveBeenCalledTimes(1);
    expect(hasResidentTextModel(s.modelResidencyManager)).toBe(true);
  });
});
