jest.unmock('@react-navigation/native');

import { deleteOpenImage, galleryWithRoutes, pressImageAction } from '../../harness/galleryRoutes';
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('iOS Gallery deletion after an application-container change', () => {
  it('opens and saves an image through its recovered Documents path', async () => {
    const boundary = installNativeBoundary({ fs: true, whisper: true });
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();

    const currentPath = `${boundary.fs!.DocumentDirectoryPath}/recovered_images/saved-image.png`;
    boundary.fs!.seedFile(currentPath, 1024);
    await AsyncStorage.setItem(
      'local-llm-app-storage',
      JSON.stringify({
        state: {
          generatedImages: [
            {
              id: 'saved-image',
              prompt: 'Recovered image',
              imagePath:
                '/var/mobile/Containers/Data/Application/OLD/Documents/recovered_images/saved-image.png',
              width: 512,
              height: 512,
              steps: 20,
              seed: 1,
              modelId: 'image-model',
              createdAt: '2026-09-14T00:00:00.000Z',
            },
          ],
        },
        version: 0,
      }),
    );

    const rtl = requireRTL();
    const { useAppStore } = require('../../../src/stores/appStore');
    await useAppStore.persist.rehydrate();
    const gallery = rtl.render(galleryWithRoutes());
    // The Android storage dialog is the OS's: the person allows it.
    const { PermissionsAndroid } = require('react-native');
    PermissionsAndroid.request = async () => PermissionsAndroid.RESULTS.GRANTED;

    rtl.fireEvent.press(await gallery.findByTestId('gallery-image-saved-image'));
    await pressImageAction(rtl, gallery, 'Save');

    expect(await gallery.findByText('Image Saved')).toBeTruthy();
  });

  it('deletes the owned generated image and keeps a path outside that directory', async () => {
    const boundary = installNativeBoundary({
      fs: true,
      ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 5 * GB },
    });
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();

    const documents = boundary.fs!.DocumentDirectoryPath;
    const ownedPath = `${documents}/generated_images/owned-image.png`;
    const outsidePath = `${documents}/attachments/outside-image.png`;
    boundary.fs!.seedFile(ownedPath, 1024);
    boundary.fs!.seedFile(outsidePath, 1024);
    boundary.diffusion.seedGeneratedImages([
      {
        id: 'owned-image',
        prompt: 'Owned generated image',
        imagePath: ownedPath,
        width: 512,
        height: 512,
        steps: 20,
        seed: 1,
        modelId: 'image-model',
        createdAt: '2026-09-14T00:00:00.000Z',
      },
    ]);

    await AsyncStorage.setItem(
      'local-llm-app-storage',
      JSON.stringify({
        state: {
          generatedImages: [
            {
              id: 'owned-image',
              prompt: 'Owned generated image',
              imagePath:
                '/var/mobile/Containers/Data/Application/OLD/Documents/generated_images/owned-image.png',
              width: 512,
              height: 512,
              steps: 20,
              seed: 1,
              modelId: 'image-model',
              createdAt: '2026-09-14T00:00:00.000Z',
            },
            {
              id: 'outside-image',
              prompt: 'Outside image',
              imagePath:
                '/var/mobile/Containers/Data/Application/OLD/Documents/attachments/outside-image.png',
              width: 512,
              height: 512,
              steps: 20,
              seed: 2,
              modelId: 'image-model',
              createdAt: '2026-09-14T00:00:00.000Z',
            },
          ],
        },
        version: 0,
      }),
    );

    const rtl = requireRTL();
    const { useAppStore } = require('../../../src/stores/appStore');
    await useAppStore.persist.rehydrate();
    const gallery = rtl.render(galleryWithRoutes());

    rtl.fireEvent.press(await gallery.findByTestId('gallery-image-owned-image'));
    await deleteOpenImage(rtl, gallery);

    await rtl.waitFor(async () => {
      expect(await boundary.fs!.exists(ownedPath)).toBe(false);
      expect(gallery.queryByTestId('gallery-image-owned-image')).toBeNull();
    });
    // The deleted image's route closed: the grid is the screen again.
    await rtl.waitFor(() => expect(gallery.queryByTestId('gallery-image-screen')).toBeNull());

    rtl.fireEvent.press(gallery.getByTestId('gallery-image-outside-image'));
    await deleteOpenImage(rtl, gallery);

    // Kept: the image stays open and says so, its file and its Gallery entry still there.
    expect(await gallery.findByText('Image was not deleted')).toBeTruthy();
    expect(await boundary.fs!.exists(outsidePath)).toBe(true);
    rtl.fireEvent.press(gallery.getByText('OK'));
    rtl.fireEvent.press(gallery.getByTestId('gallery-image-back'));
    await rtl.waitFor(() => expect(gallery.getByTestId('gallery-image-outside-image')).toBeTruthy());
  });
});
