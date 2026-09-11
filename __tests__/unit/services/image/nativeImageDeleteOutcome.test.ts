jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath:
    '/var/mobile/Containers/Data/Application/CURRENT/Documents',
  CachesDirectoryPath:
    '/var/mobile/Containers/Data/Application/CURRENT/Library/Caches',
  TemporaryDirectoryPath: '/var/mobile/Containers/Data/Application/CURRENT/tmp',
}));

import {projectStoredNativeImageDeletePath} from '../../../../src/services/image/nativeImageDeleteOutcome';

const DIRECTORY =
  '/var/mobile/Containers/Data/Application/CURRENT/Documents/generated_images';

describe('stored native image delete path', () => {
  it('admits an owned generated image after an iOS container UUID change', () => {
    const stale =
      '/var/mobile/Containers/Data/Application/OLD/Documents/generated_images/image.png';

    expect(projectStoredNativeImageDeletePath(stale, DIRECTORY)).toEqual({
      ok: true,
      path: `${DIRECTORY}/image.png`,
    });
  });

  it('still rejects a stale iOS path outside the generated-image directory', () => {
    const stale =
      '/var/mobile/Containers/Data/Application/OLD/Documents/attachments/image.png';

    expect(projectStoredNativeImageDeletePath(stale, DIRECTORY)).toMatchObject({
      ok: false,
      outcome: {status: 'failure', code: 'UNSAFE_DELETE_PATH'},
    });
  });
});
