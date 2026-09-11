/**
 * Integration: Shared residency keeps a persistent Whisper sidecar from
 * competing with a heavier generation model on a memory-constrained device.
 * Only native RAM, filesystem, and Whisper runtime boundaries are faked.
 */
import type {OffGridApplication} from '@offgrid/application';
import {createTranscriptionModelsSelector} from '@offgrid/application';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {
  GB,
  MB,
  installNativeBoundary,
  type NativeBoundary,
} from '../../harness/nativeBoundary';

const WHISPER_ID = 'base';
const WHISPER_PATH = '/docs/whisper-models/ggml-base.bin';
const TEXT_KEY = 'text';

let fixture: MobileApplicationFixture | null = null;
let boundary: NativeBoundary;
let loadTranscriptionModel: typeof import('../../../src/services/modelServices/modelLifecycleBootstrap').loadTranscriptionModel;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

async function start(): Promise<OffGridApplication> {
  boundary = installNativeBoundary({
    fs: true,
    whisper: true,
    ram: {
      platform: 'android',
      totalBytes: 11.03 * GB,
      availBytes: 4.5 * GB,
    },
  });
  boundary.fs!.seedFile(WHISPER_PATH, 142 * MB);
  const {startMobileApplicationFixture} =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  fixture = await startMobileApplicationFixture();
  fixture.application.models.setLoadPolicy('balanced');
  ({loadTranscriptionModel} =
    require('../../../src/services/modelServices/modelLifecycleBootstrap') as typeof import('../../../src/services/modelServices/modelLifecycleBootstrap'));
  return fixture.application;
}

function whisperResident(application: OffGridApplication): boolean {
  return application.models.snapshot().residents.some(
    resident => resident.type === 'transcription' && resident.modelId === WHISPER_ID,
  );
}

function whisperResidentKey(application: OffGridApplication): string | undefined {
  return application.models.snapshot().residents.find(
    resident => resident.type === 'transcription' && resident.modelId === WHISPER_ID,
  )?.key;
}

async function registerTextModel(application: OffGridApplication, sizeMB: number): Promise<void> {
  const lease = await application.models.residency.acquire(
    {key: TEXT_KEY, type: 'text', sizeMB},
    {
      load: async () => undefined,
      unload: async () => ({reclaimed: true as const}),
    },
    {override: true},
  );
  await lease.release();
}

describe('STT residency — single-model invariant', () => {
  it('loads Whisper when nothing else is resident', async () => {
    const application = await start();

    await expect(loadTranscriptionModel(WHISPER_ID)).resolves.toBe('loaded');

    expect(boundary.whisper!.module.initWhisper).toHaveBeenCalledTimes(1);
    expect(whisperResident(application)).toBe(true);
  });

  it('publishes Whisper loading through the Shared transcription projection', async () => {
    const application = await start();
    let releaseLoad!: () => void;
    let observeLoadStarted!: () => void;
    const loadStarted = new Promise<void>(resolve => {
      observeLoadStarted = resolve;
    });
    boundary.whisper!.module.initWhisper.mockImplementationOnce(
      () => new Promise<void>(resolve => {
        releaseLoad = resolve;
        observeLoadStarted();
      }),
    );

    const pending = loadTranscriptionModel(WHISPER_ID);
    await loadStarted;

    const select = createTranscriptionModelsSelector();
    const loading = select(application.models.snapshot());
    try {
      expect(loading.models.find(row => row.catalog.id === WHISPER_ID)?.loading).toBe(true);
    } finally {
      releaseLoad();
    }
    await expect(pending).resolves.toBe('loaded');
    expect(select(application.models.snapshot()).models.find(
      row => row.catalog.id === WHISPER_ID,
    )?.loading).toBe(false);
  });

  it('does not load Whisper beside a heavier resident text model', async () => {
    const application = await start();
    await registerTextModel(application, 8537);

    await expect(loadTranscriptionModel(WHISPER_ID)).resolves.toBe('blocked');

    expect(boundary.whisper!.module.initWhisper).not.toHaveBeenCalled();
    expect(whisperResident(application)).toBe(false);
    expect(application.models.residency.isResident(TEXT_KEY)).toBe(true);
    expect(application.models.snapshot().residents).toHaveLength(1);
  });

  it('a text load evicts resident Whisper and Whisper cannot fight back', async () => {
    const application = await start();
    await loadTranscriptionModel(WHISPER_ID);
    const residentKey = whisperResidentKey(application);
    expect(residentKey).toBeTruthy();

    const textLease = await application.models.residency.acquire(
      {key: TEXT_KEY, type: 'text', modelId: 'gemma-e4b', sizeMB: 8537},
      {
        load: async () => undefined,
        unload: async () => ({reclaimed: true as const}),
      },
      {override: true},
    );
    await textLease.release();

    expect(textLease.evicted).toContain(residentKey);
    expect(whisperResident(application)).toBe(false);
    await expect(loadTranscriptionModel(WHISPER_ID)).resolves.toBe('blocked');
    expect(application.models.residency.isResident(TEXT_KEY)).toBe(true);
    expect(application.models.snapshot().residents).toHaveLength(1);
  });

  it('loads Whisper again after the text model unloads', async () => {
    const application = await start();
    await registerTextModel(application, 8537);
    await expect(loadTranscriptionModel(WHISPER_ID)).resolves.toBe('blocked');

    await application.models.residency.unload(
      TEXT_KEY,
      async () => ({reclaimed: true}),
    );

    await expect(loadTranscriptionModel(WHISPER_ID)).resolves.toBe('loaded');
    expect(whisperResident(application)).toBe(true);
  });
});
