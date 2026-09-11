/**
 * A user can find an existing generated image from Home, inspect it, delete it, and trust that the
 * deletion survives an application restart. The Shared gallery facade is the canonical owner. Only
 * the device filesystem is faked because React Native Jest cannot use the device image directory.
 */
import type React from 'react';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import { doMockRealSqlite } from '../../harness/sqliteFake';
import {
  renderProductionApp,
  seedReturningUserWithTextModel,
} from '../../harness/productionNavigation';

const deviceInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const applicationStartupTimeoutMs = 15_000;

async function waitForHome(
  view: ReturnType<typeof renderProductionApp>,
): Promise<void> {
  await view.findByTestId(
    'home-tab',
    {},
    { timeout: applicationStartupTimeoutMs },
  );
}

async function stopApplication() {
  const { stopMobileApplication } =
    require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
  await stopMobileApplication();
}

jest.mock('react-native-safe-area-context', () => {
  const ReactForMock = require('react');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaInsetsContext: ReactForMock.createContext(deviceInsets),
    SafeAreaFrameContext: ReactForMock.createContext({
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    }),
    useSafeAreaInsets: () => deviceInsets,
    initialWindowMetrics: {
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: deviceInsets,
    },
  };
});

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: { name: string }) => <Text>{name}</Text>;
});

(
  globalThis as { requestAnimationFrame?: (callback: () => void) => unknown }
).requestAnimationFrame = callback => setTimeout(callback, 0);

describe('generated-image Gallery lifecycle', () => {
  beforeEach(stopApplication);
  afterEach(stopApplication);

  it('opens from Home, deletes an image, and keeps it deleted after restart', async () => {
    const boundary = installNativeBoundary({ fs: true });
    doMockRealSqlite();
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await seedReturningUserWithTextModel(boundary);
    const rtl = requireRTL();
    let view = renderProductionApp(rtl);
    await waitForHome(view);

    const { applicationFacade } =
      require('../../../src/services/applicationFacade') as typeof import('../../../src/services/applicationFacade');
    const gallery = applicationFacade().generatedImages;
    if (!gallery)
      throw new Error(
        'The Mobile application did not compose its gallery facade.',
      );

    const imagePath = `${
      boundary.fs!.DocumentDirectoryPath
    }/generated_images/gallery-proof.png`;
    boundary.fs!.seedFile(imagePath, 1024);
    const created = await gallery.create({
      id: 'gallery-proof',
      contentId: 'gallery-proof',
      conversationId: null,
      prompt: 'A green cabin under the stars',
      width: 512,
      height: 512,
      steps: 20,
      seed: 42,
      modelId: 'image-model',
      createdAt: '2026-09-06T00:00:00.000Z',
      local: { path: imagePath, fileName: 'gallery-proof.png' },
    });
    if (!created.ok) throw new Error(created.failure.message);

    await rtl.waitFor(() => expect(view.getByText('1 image')).toBeVisible());
    rtl.fireEvent.press(view.getByText('Image Gallery'));
    await rtl.waitFor(() => expect(view.getByText('Gallery')).toBeVisible());
    expect(view.getByText('1')).toBeVisible();

    rtl.fireEvent.press(view.getByTestId('gallery-image-gallery-proof'));
    await rtl.waitFor(() => expect(view.getByText('Info')).toBeVisible());
    rtl.fireEvent.press(view.getByText('Info'));
    expect(view.getByText('A green cabin under the stars')).toBeVisible();
    rtl.fireEvent.press(view.getByText('Done'));

    rtl.fireEvent.press(view.getByText('Delete'));
    await rtl.waitFor(() =>
      expect(view.getByText('Delete Image')).toBeVisible(),
    );
    const deleteChoices = view.getAllByText('Delete');
    rtl.fireEvent.press(deleteChoices[deleteChoices.length - 1]);
    await rtl.waitFor(() =>
      expect(view.getByText('No generated images yet')).toBeVisible(),
    );

    view.unmount();
    await stopApplication();
    view = renderProductionApp(rtl);
    await rtl.waitFor(() => expect(view.getByText('0 images')).toBeVisible());
    rtl.fireEvent.press(view.getByText('Image Gallery'));
    await rtl.waitFor(() =>
      expect(view.getByText('No generated images yet')).toBeVisible(),
    );

    view.unmount();
  });

  it('keeps a replacement visible when its older delete settles', async () => {
    const boundary = installNativeBoundary({ fs: true });
    doMockRealSqlite();
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await seedReturningUserWithTextModel(boundary);
    const rtl = requireRTL();
    const view = renderProductionApp(rtl);
    await waitForHome(view);

    const { applicationFacade } =
      require('../../../src/services/applicationFacade') as typeof import('../../../src/services/applicationFacade');
    const gallery = applicationFacade().generatedImages;
    if (!gallery)
      throw new Error(
        'The Mobile application did not compose its gallery facade.',
      );
    const imagePath = `${
      boundary.fs!.DocumentDirectoryPath
    }/generated_images/gallery-race.png`;
    const identity = 'gallery-race';
    const original = await gallery.create({
      id: identity,
      contentId: identity,
      conversationId: null,
      prompt: 'The original green cabin',
      width: 512,
      height: 512,
      steps: 20,
      seed: 42,
      modelId: 'image-model',
      createdAt: '2026-09-06T00:00:00.000Z',
      local: { path: imagePath, fileName: 'gallery-race.png' },
    });
    if (!original.ok) throw new Error(original.failure.message);
    boundary.fs!.seedTextFile(imagePath, 'original-image-bytes');

    await rtl.waitFor(() => expect(view.getByText('1 image')).toBeVisible());
    rtl.fireEvent.press(view.getByText('Image Gallery'));
    await rtl.waitFor(() => expect(view.getByText('Gallery')).toBeVisible());
    rtl.fireEvent.press(view.getByTestId(`gallery-image-${identity}`));
    await rtl.waitFor(() => expect(view.getByText('Delete')).toBeVisible());

    boundary.diffusion.holdNextDelete();
    rtl.fireEvent.press(view.getByText('Delete'));
    await rtl.waitFor(() =>
      expect(view.getByText('Delete Image')).toBeVisible(),
    );
    const deleteChoices = view.getAllByText('Delete');
    rtl.fireEvent.press(deleteChoices[deleteChoices.length - 1]);
    await rtl.waitFor(() => expect(boundary.diffusion.deleteHeld()).toBe(true));

    const { materializeSharedFile } =
      require('../../../pro/sync/sharedFileMaterializer') as typeof import('../../../pro/sync/sharedFileMaterializer');
    const replacement = {
      syncId: identity,
      kind: 'generated_media' as const,
      name: 'gallery-race.png',
      mimeType: 'image/png',
      fileSize: 23,
      createdAt: '2026-09-06T00:00:01.000Z',
      width: 512,
      height: 512,
      metadataJson: JSON.stringify({
        prompt: 'The replacement green cabin',
        steps: 20,
        seed: 43,
        modelId: 'image-model',
      }),
      localPath: imagePath,
      provenance: {
        originDeviceId: 'desktop-peer',
        originDeviceName: 'Desktop peer',
      },
    };

    boundary.fs!.seedTextFile(imagePath, 'replacement-image-bytes');
    await expect(materializeSharedFile(replacement)).rejects.toThrow();

    boundary.diffusion.releaseDelete();
    await rtl.waitFor(() =>
      expect(view.getByText('No generated images yet')).toBeVisible(),
    );
    await rtl.waitFor(() =>
      expect(boundary.fs!.exists(imagePath)).resolves.toBe(false),
    );

    boundary.fs!.seedTextFile(imagePath, 'replacement-image-bytes');
    await expect(materializeSharedFile(replacement)).resolves.toEqual({
      createdGalleryImage: true,
    });
    await rtl.waitFor(() =>
      expect(view.queryByText('Deleting Image')).toBeNull(),
    );
    await view.findByTestId(`gallery-image-${identity}`);
    rtl.fireEvent.press(view.getByTestId(`gallery-image-${identity}`));
    rtl.fireEvent.press(await view.findByText('Info'));
    expect(view.getByText('The replacement green cabin')).toBeVisible();
    expect(await boundary.fs!.module.readFile(imagePath)).toBe(
      'replacement-image-bytes',
    );

    view.unmount();
  });
});
