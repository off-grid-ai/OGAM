import {
  mobileImageDownloadMetadata,
} from '../../../src/services/modelServices/modelDownloadRequests';
import { publicImageDownloadRequest } from '../../../src/services/adapters/models/downloads/publicImageDownloadRequest';

describe('Mobile image download request boundary', () => {
  const model = {
    id: 'owner/model',
    name: 'Image model',
    description: 'A local image model',
    downloadUrl: 'https://example.test/model.zip',
    size: 100,
    backend: 'mnn' as const,
  };

  it('round-trips a valid public archive request', () => {
    const request = publicImageDownloadRequest(model);

    expect(mobileImageDownloadMetadata(request.metadataJson)).toMatchObject({
      imageDownloadType: 'zip',
      imageModelName: 'Image model',
      imageModelDownloadUrl: 'https://example.test/model.zip',
    });
  });

  it.each([
    ['non-network archive URL', { imageModelDownloadUrl: 'file:///private/model.zip' }],
    ['traversal artifact', {
      imageDownloadType: 'multifile',
      imageModelDownloadUrl: undefined,
      imageModelCoremlFiles: [{ path: '../escape', size: 1, downloadUrl: 'https://example.test/a' }],
    }],
    ['absolute artifact', {
      imageDownloadType: 'multifile',
      imageModelDownloadUrl: undefined,
      imageModelCoremlFiles: [{ path: '/private/escape', size: 1, downloadUrl: 'https://example.test/a' }],
    }],
    ['duplicate artifact paths', {
      imageDownloadType: 'multifile',
      imageModelDownloadUrl: undefined,
      imageModelCoremlFiles: [
        { path: 'model/a', size: 1, downloadUrl: 'https://example.test/a' },
        { path: 'model/a', size: 2, downloadUrl: 'https://example.test/b' },
      ],
    }],
    ['invalid artifact size', {
      imageDownloadType: 'multifile',
      imageModelDownloadUrl: undefined,
      imageModelCoremlFiles: [{ path: 'model/a', size: -1, downloadUrl: 'https://example.test/a' }],
    }],
  ])('rejects %s before it becomes I/O', (_name, mutation) => {
    const request = publicImageDownloadRequest(model);
    const metadata = { ...JSON.parse(request.metadataJson!), ...mutation };

    expect(mobileImageDownloadMetadata(JSON.stringify(metadata))).toBeUndefined();
  });
});
