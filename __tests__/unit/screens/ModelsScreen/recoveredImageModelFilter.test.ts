import { isSuspiciousRecoveredImageModel } from '@offgrid/models';
import { ONNXImageModel } from '../../../../src/types';

describe('isSuspiciousRecoveredImageModel', () => {
  it('should filter recovered image models', () => {
    const model: ONNXImageModel = {
      id: 'recovered_image_model_123456',
      name: 'Recovered Image',
      description: 'A recovered image model',
      modelPath: '/models/image',
      size: 100 * 1024 * 1024,
      downloadedAt: new Date().toISOString(),
      backend: 'mnn',
    };
    expect(isSuspiciousRecoveredImageModel(model)).toBe(true);
  });

  it('should not filter non-recovered image models', () => {
    const model: ONNXImageModel = {
      id: 'local_image_model',
      name: 'Local Image',
      description: 'A local image model',
      modelPath: '/models/image',
      size: 500 * 1024 * 1024,
      downloadedAt: new Date().toISOString(),
      backend: 'qnn',
    };
    expect(isSuspiciousRecoveredImageModel(model)).toBe(false);
  });

  it('should filter recovered models regardless of size', () => {
    const model: ONNXImageModel = {
      id: 'recovered_tiny_model_123456',
      name: 'Tiny',
      description: 'A tiny model',
      modelPath: '/models/tiny',
      size: 10 * 1024 * 1024,
      downloadedAt: new Date().toISOString(),
      backend: 'mnn',
    };
    expect(isSuspiciousRecoveredImageModel(model)).toBe(true);
  });

  it('should filter recovered models regardless of backend', () => {
    const backends: Array<'mnn' | 'qnn' | 'coreml'> = ['mnn', 'qnn', 'coreml'];
    backends.forEach(backend => {
      const model: ONNXImageModel = {
        id: `recovered_model_${backend}_123456`,
        name: 'Model',
        description: 'A model',
        modelPath: '/models',
        size: 200 * 1024 * 1024,
        downloadedAt: new Date().toISOString(),
        backend,
      };
      expect(isSuspiciousRecoveredImageModel(model)).toBe(true);
    });
  });
});
