jest.unmock('@react-navigation/native');

import { deleteOpenImage, galleryWithRoutes } from '../../harness/galleryRoutes';
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('iOS Gallery with an already-missing generated image', () => {
  it('removes the orphaned Gallery record through Delete', async () => {
    installNativeBoundary({
      fs: true,
      ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 5 * GB },
    });
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem(
      'local-llm-app-storage',
      JSON.stringify({
        state: {
          generatedImages: [
            {
              id: 'missing-image',
              prompt: 'Missing generated image',
              imagePath:
                '/var/mobile/Containers/Data/Application/OLD/Documents/generated_images/missing-image.png',
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

    rtl.fireEvent.press(await gallery.findByTestId('gallery-image-missing-image'));
    await deleteOpenImage(rtl, gallery);

    await rtl.waitFor(() => {
      expect(gallery.queryByTestId('gallery-image-missing-image')).toBeNull();
      expect(gallery.getByText('No generated images yet')).toBeTruthy();
    });
  });
});
