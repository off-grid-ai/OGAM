/**
 * Selecting images is an Images-tab action.
 *
 * SPEC (OGAM user's view): with images in the Gallery, the Images tab offers "Select images". The
 * Videos tab does not, because a selection of images cannot be seen or acted on there. Moving to
 * the Videos tab while selecting ends the selection.
 *
 * The real Gallery screen over the real store, rehydrated from device storage. Device boundaries
 * only: the file system and the RAM sensor. No Pro, so the Videos tab stays on this screen.
 */
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

const image = (id: string) => ({
  id,
  prompt: `A lighthouse ${id}`,
  imagePath: `/data/user/0/ai.offgridmobile/files/generated_images/${id}.png`,
  width: 512,
  height: 512,
  steps: 20,
  seed: 1,
  modelId: 'image-model',
  createdAt: '2026-10-27T00:00:00.000Z',
});

it('offers Select images on the Images tab only, and leaving it ends the selection', async () => {
  installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 5 * GB } });
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  await AsyncStorage.setItem(
    'local-llm-app-storage',
    JSON.stringify({ state: { generatedImages: [image('one'), image('two')] }, version: 0 }),
  );
  const React = require('react');
  const rtl = requireRTL();
  const { useAppStore } = require('../../../src/stores/appStore');
  await useAppStore.persist.rehydrate();
  const { GalleryScreen } = require('../../../src/screens/GalleryScreen');
  const gallery = rtl.render(React.createElement(GalleryScreen));

  await gallery.findByTestId('gallery-image-one');
  rtl.fireEvent.press(gallery.getByLabelText('Select images'));
  expect(gallery.getByText('0 selected')).toBeTruthy();

  rtl.fireEvent.press(gallery.getByText('Videos (0)'));
  await rtl.waitFor(() => expect(gallery.queryByText('0 selected')).toBeNull());
  expect(gallery.queryByLabelText('Select images')).toBeNull();

  rtl.fireEvent.press(gallery.getByText('Images (2)'));
  expect(await gallery.findByLabelText('Select images')).toBeTruthy();
  expect(gallery.queryByText('0 selected')).toBeNull();
});
