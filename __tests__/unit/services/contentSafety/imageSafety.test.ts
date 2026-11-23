/**
 * The image safety check runs the bundled classifier on each generated image and fails closed: a
 * score at or over the line, a classifier that will not load, or one that returns nothing all block
 * the image. Only the executorch native boundary is faked (jest.setup: ClassificationModule).
 */
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';

type Fake = {
  nsfw?: number | unknown;
  loadError?: Error;
  forwardError?: Error;
  loadedFrom: string[];
  classified: string[];
  deleted?: number;
};

let legacy: any;
function freshModule() {
  let mod!: typeof import('../../../../src/services/contentSafety') &
    typeof import('../../../../src/services/contentSafety/imageSafety');
  jest.isolateModules(() => {
    mod = {
      ...require('../../../../src/services/contentSafety'),
      ...require('../../../../src/services/contentSafety/imageSafety'),
    };
    legacy = require('react-native-executorch/legacy');
  });
  return mod;
}

function setFake(partial: Partial<Fake> = {}): Fake {
  const fake: Fake = { loadedFrom: [], classified: [], ...partial };
  (globalThis as any).__nsfwClassifier = fake;
  return fake;
}

const originalOS = Platform.OS;

afterEach(() => {
  delete (globalThis as any).__nsfwClassifier;
  (Platform as any).OS = originalOS;
  jest.clearAllMocks();
});

describe('checkGeneratedImage', () => {
  it('allows an image under the line and frees the program', async () => {
    const fake = setFake({ nsfw: 0.2 });
    const { checkGeneratedImage } = freshModule();
    await expect(checkGeneratedImage('/docs/generated_images/a.png')).resolves.toEqual({ allowed: true, nsfw: 0.2 });
    expect(fake.classified).toEqual(['file:///docs/generated_images/a.png']);
    expect(fake.deleted).toBe(1);
  });

  it('keeps a file:// uri as it is', async () => {
    const fake = setFake();
    const { checkGeneratedImage } = freshModule();
    await checkGeneratedImage('file:///x.png');
    expect(fake.classified).toEqual(['file:///x.png']);
  });

  it('blocks at the line', async () => {
    setFake({ nsfw: 0.5 });
    const { checkGeneratedImage } = freshModule();
    await expect(checkGeneratedImage('/a.png')).resolves.toEqual({ allowed: false, nsfw: 0.5, reason: 'nsfw' });
  });

  it('blocks when the classifier will not load', async () => {
    setFake({ loadError: new Error('bad program') });
    const { checkGeneratedImage } = freshModule();
    await expect(checkGeneratedImage('/a.png')).resolves.toEqual({ allowed: false, nsfw: null, reason: 'check-failed' });
  });

  it('blocks and still frees the program when the run fails', async () => {
    const fake = setFake({ forwardError: new Error('decode failed') });
    const { checkGeneratedImage } = freshModule();
    await expect(checkGeneratedImage('/a.png')).resolves.toMatchObject({ allowed: false, reason: 'check-failed' });
    expect(fake.deleted).toBe(1);
  });

  it('blocks when the classifier returns no score', async () => {
    setFake({ nsfw: Number.NaN });
    const { checkGeneratedImage } = freshModule();
    await expect(checkGeneratedImage('/a.png')).resolves.toMatchObject({ allowed: false, reason: 'check-failed' });
  });

  it('on iOS reads the classifier from the app bundle', async () => {
    (Platform as any).OS = 'ios';
    const fake = setFake();
    const { checkGeneratedImage } = freshModule();
    await checkGeneratedImage('/a.png');
    expect(fake.loadedFrom).toEqual([`file://${RNFS.MainBundlePath}/nsfw_384_xnnpack_fp32.pte`]);
    expect(RNFS.copyFileAssets).not.toHaveBeenCalled();
  });

  it('on Android copies the classifier out of the APK once', async () => {
    (Platform as any).OS = 'android';
    const exists = RNFS.exists as jest.Mock;
    exists.mockResolvedValueOnce(false).mockResolvedValue(true);
    const fake = setFake();
    const { checkGeneratedImage } = freshModule();
    await checkGeneratedImage('/a.png');
    await checkGeneratedImage('/b.png');
    const dest = `${RNFS.DocumentDirectoryPath}/nsfw_384_xnnpack_fp32.pte`;
    expect(RNFS.copyFileAssets).toHaveBeenCalledTimes(1);
    expect(RNFS.copyFileAssets).toHaveBeenCalledWith('models/nsfw_384_xnnpack_fp32.pte', `${dest}.part`);
    expect(RNFS.moveFile).toHaveBeenCalledWith(`${dest}.part`, dest);
    expect(fake.loadedFrom).toEqual([`file://${dest}`, `file://${dest}`]);
  });

  it('on Android uses a classifier copied on an earlier run', async () => {
    (Platform as any).OS = 'android';
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    setFake();
    const { checkGeneratedImage } = freshModule();
    await expect(checkGeneratedImage('/a.png')).resolves.toMatchObject({ allowed: true });
    expect(RNFS.copyFileAssets).not.toHaveBeenCalled();
  });

  it('on Android tries the copy again after a failed copy', async () => {
    (Platform as any).OS = 'android';
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
    (RNFS.copyFileAssets as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    setFake();
    const { checkGeneratedImage } = freshModule();
    await expect(checkGeneratedImage('/a.png')).resolves.toMatchObject({ allowed: false, reason: 'check-failed' });
    await expect(checkGeneratedImage('/a.png')).resolves.toMatchObject({ allowed: true });
    expect(RNFS.copyFileAssets).toHaveBeenCalledTimes(2);
  });

  it('runs one check at a time', async () => {
    setFake();
    const { checkGeneratedImage } = freshModule();
    let live = 0;
    let peak = 0;
    const slow = async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise(resolve => setTimeout(resolve, 5));
      return {
        forward: async () => ({ NSFW: 0, SFW: 1 }),
        delete: () => { live -= 1; },
      };
    };
    const load = legacy.ClassificationModule.fromCustomModel;
    load.mockImplementationOnce(slow).mockImplementationOnce(slow).mockImplementationOnce(slow);
    await Promise.all([checkGeneratedImage('/a.png'), checkGeneratedImage('/b.png'), checkGeneratedImage('/c.png')]);
    expect(load).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });
});

describe('screenGeneratedImage', () => {
  it('keeps a safe image', async () => {
    setFake({ nsfw: 0 });
    const { screenGeneratedImage } = freshModule();
    const remove = jest.fn(async () => true);
    await expect(screenGeneratedImage('/a.png', remove)).resolves.toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes a blocked image', async () => {
    setFake({ nsfw: 0.97 });
    const { screenGeneratedImage } = freshModule();
    const remove = jest.fn(async () => true);
    await expect(screenGeneratedImage('/a.png', remove)).resolves.toBe(false);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('deletes the image when the check itself failed', async () => {
    setFake({ loadError: new Error('bad program') });
    const { screenGeneratedImage } = freshModule();
    const remove = jest.fn(async () => true);
    await expect(screenGeneratedImage('/a.png', remove)).resolves.toBe(false);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('still reports blocked when the delete fails', async () => {
    setFake({ nsfw: 0.97 });
    const { screenGeneratedImage } = freshModule();
    await expect(screenGeneratedImage('/a.png', async () => { throw new Error('busy'); })).resolves.toBe(false);
  });
});
