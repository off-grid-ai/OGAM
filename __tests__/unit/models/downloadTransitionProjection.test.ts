import { isDownloadTransitionPending } from '../../../src/hooks/usePendingModelCommand';

const operation = (controlOperation: 'queue-download' | 'pause-download' | 'resume-download') => ({
  operationId: `operation:${controlOperation}`,
  kind: 'control' as const,
  state: 'active' as const,
  controlOperation,
  modelId: 'image:model',
});

describe('download card transition projection', () => {
  it('restores Pause when an iPhone image transfer reaches downloading', () => {
    expect(isDownloadTransitionPending({
      operations: [operation('queue-download')], modelId: 'image:model', status: 'downloading',
    })).toBe(false);
  });

  it('uses the loader only while download controls move between stable states', () => {
    expect(isDownloadTransitionPending({
      operations: [operation('queue-download')], modelId: 'image:model',
    })).toBe(true);
    expect(isDownloadTransitionPending({
      operations: [operation('pause-download')], modelId: 'image:model', status: 'downloading',
    })).toBe(true);
    expect(isDownloadTransitionPending({
      operations: [operation('resume-download')], modelId: 'image:model', status: 'paused',
    })).toBe(true);
    expect(isDownloadTransitionPending({
      operations: [], modelId: 'image:model', status: 'processing',
    })).toBe(true);
  });
});
