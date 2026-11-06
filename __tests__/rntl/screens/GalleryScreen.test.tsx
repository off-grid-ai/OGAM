/**
 * GalleryScreen Tests
 *
 * The real Gallery over the real app and chat stores, the real image-generation service and the real
 * on-device image store (localDreamGenerator), inside a real React Navigation stack opened from Home.
 *
 * Faked: only the device boundary (harness/nativeBoundary): the diffusion native module (the native
 * image store, generation and cancel), react-native-fs over an in-memory disk, the OS share sheet, RAM.
 * Images enter the way the app adds them (the store's addGeneratedImage, or the native gallery scan),
 * with their PNG on the disk where the native module saves it. An image or a video opens on its own
 * real route (GalleryImage, GalleryVideo) in the same stack.
 */
import type { NativeBoundary } from '../../harness/nativeBoundary';
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { withNavigatorRoutes } from '../../harness/realNavigation';
import { galleryScreens } from '../../harness/galleryRoutes';

jest.unmock('@react-navigation/native');

interface SeedImage {
  id: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  createdAt: string;
  conversationId?: string;
}

const sampleImages: SeedImage[] = [
  { id: 'img-1', prompt: 'A sunset over mountains', width: 512, height: 512, steps: 20, seed: 12345, createdAt: '2026-01-15T10:00:00.000Z' },
  { id: 'img-2', prompt: 'A cat sitting on a chair', negativePrompt: 'ugly, blurry', width: 512, height: 512, steps: 25, seed: 67890, createdAt: '2026-01-16T10:00:00.000Z' },
  { id: 'img-3', prompt: 'A futuristic city', width: 768, height: 768, steps: 30, seed: 11111, createdAt: '2026-01-17T10:00:00.000Z' },
];

interface Gallery {
  boundary: NativeBoundary;
  rtl: ReturnType<typeof requireRTL>;
  view: ReturnType<ReturnType<typeof requireRTL>['render']>;
  useAppStore: any;
  imagePath(id: string): string;
}

/** Where the native module saves a generated image: <documents>/generated_images/<id>.png. */
const imagePathFor = (boundary: NativeBoundary, id: string) =>
  `${boundary.fs!.DocumentDirectoryPath}/generated_images/${id}.png`;

/**
 * The phone, the images it already holds (added through the store's own action, the PNG on disk),
 * and the Gallery opened from Home. `before` runs after the services load and before the mount.
 */
async function openGallery(opts: {
  images?: SeedImage[];
  params?: Record<string, unknown>;
  platform?: 'ios' | 'android';
  /** May return the route params, when they name something it created (a chat). */
  before?: (ctx: { boundary: NativeBoundary; useAppStore: any; imagePath(id: string): string }) =>
    void | Record<string, unknown> | Promise<void | Record<string, unknown>>;
} = {}): Promise<Gallery> {
  const boundary = installNativeBoundary({
    fs: true,
    ram: { platform: opts.platform ?? 'android', totalBytes: 8 * GB, availBytes: 5 * GB },
  });
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const React = require('react');
  const rtl = requireRTL();
  const { useAppStore } = require('../../../src/stores/appStore');
  const { GalleryScreen } = require('../../../src/screens/GalleryScreen');
  const imagePath = (id: string) => imagePathFor(boundary, id);
  // Oldest first: the store puts a new image at the top, as the Gallery shows them.
  for (const image of opts.images ?? []) {
    boundary.fs!.seedFile(imagePath(image.id), 1024);
    useAppStore.getState().addGeneratedImage({ ...image, imagePath: imagePath(image.id), modelId: 'sd-model' });
  }
  const params = (await opts.before?.({ boundary, useAppStore, imagePath })) ?? opts.params;
  const view = rtl.render(
    withNavigatorRoutes(React.createElement(GalleryScreen), { params, openedFrom: 'Home', screens: galleryScreens() }),
  );
  await view.findByTestId('gallery-screen');
  // The mount's scan of the native image store settles before the test acts.
  await rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return { boundary, rtl, view, useAppStore, imagePath };
}

/** On iOS: a downloaded, selected Core ML image model, and a generation held inside native generateImage. */
async function startHeldGeneration(g: Gallery, prompt: string) {
  const { createONNXImageModel } = require('../../utils/factories');
  const modelPath = `${g.boundary.fs!.DocumentDirectoryPath}/image_models/sd`;
  g.boundary.fs!.seedFile(`${modelPath}/model.mlmodelc`, 8 * 1024 * 1024);
  const store = g.useAppStore.getState();
  store.addDownloadedImageModel(createONNXImageModel({ id: 'sd', name: 'SD', modelPath, backend: 'coreml' }));
  store.setActiveImageModelId('sd');
  store.updateSettings({ imageSteps: 20 });
  const { imageGenerationService } = require('../../../src/services');
  g.boundary.diffusion.holdNextGeneration();
  const run = imageGenerationService.generateImage({ prompt });
  await g.rtl.waitFor(() => expect(g.boundary.diffusion.generationHeld()).toBe(true));
  // Wrapped: an async function returning the bare promise would wait for the generation to end.
  return { run };
}

/** The Android storage dialog is the OS's: the person allows it. */
function allowStorage() {
  const { PermissionsAndroid } = require('react-native');
  PermissionsAndroid.request = async () => PermissionsAndroid.RESULTS.GRANTED;
}

/** Taps an image in the grid: it opens full screen on its own route. */
async function openImage(g: Gallery, id: string) {
  g.rtl.fireEvent.press(g.view.getByTestId(`gallery-image-${id}`));
  await g.view.findByTestId('gallery-image-screen');
}

/** More, over the open image: the sheet with its actions and details. */
async function openSheet(g: Gallery) {
  g.rtl.fireEvent.press(g.view.getByTestId('gallery-image-more'));
  await g.view.findByText('PROMPT');
}

/** The open image screen is gone and the grid is the screen again. */
async function backOnGrid(g: Gallery) {
  await g.rtl.waitFor(() => expect(g.view.queryByTestId('gallery-image-screen')).toBeNull());
  expect(g.view.getByTestId('gallery-screen')).toBeTruthy();
}

describe('GalleryScreen', () => {
  it('renders "Gallery" title', async () => {
    const { view } = await openGallery();
    expect(view.getByText('Gallery')).toBeTruthy();
  });

  it('shows empty state when no images', async () => {
    const { view } = await openGallery();
    expect(view.getByText('No generated images yet')).toBeTruthy();
    expect(view.getByText('Generate images from any chat conversation.')).toBeTruthy();
  });

  it('Back returns to the screen the Gallery was opened from', async () => {
    const { view, rtl } = await openGallery();
    rtl.fireEvent.press(view.getByTestId('gallery-back'));
    expect(await view.findByTestId('route-Home')).toBeTruthy();
  });

  it('renders image grid when images exist', async () => {
    const { view } = await openGallery({ images: sampleImages });
    expect(view.queryByText('No generated images yet')).toBeNull();
    for (const image of sampleImages) expect(view.getByTestId(`gallery-image-${image.id}`)).toBeTruthy();
  });

  it('counts the images once, on the tab, with no bare count in the header', async () => {
    const { view } = await openGallery({ images: sampleImages });
    expect(view.getByText('Images (3)')).toBeTruthy();
    expect(view.queryByText('3')).toBeNull();
  });

  it('shows "Chat Media" title when conversationId is provided', async () => {
    const { view } = await openGallery({
      images: [{ ...sampleImages[0], conversationId: 'conv-123' }],
      params: { conversationId: 'conv-123' },
    });
    expect(view.getByText('Chat Media')).toBeTruthy();
  });

  it('shows chat-specific empty state when no images match conversation', async () => {
    const { view } = await openGallery({ params: { conversationId: 'conv-456' } });
    expect(view.getByText('No images in this chat')).toBeTruthy();
  });

  it('long press on image enters select mode', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent(view.getByTestId('gallery-image-img-1'), 'onLongPress');
    expect(view.getByText('1 selected')).toBeTruthy();
    expect(view.getByText('All')).toBeTruthy();
  });

  it('select all selects all images', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent(view.getByTestId('gallery-image-img-1'), 'onLongPress');
    expect(view.getByText('1 selected')).toBeTruthy();
    rtl.fireEvent.press(view.getByText('All'));
    expect(view.getByText('3 selected')).toBeTruthy();
  });

  it('does not offer select mode when gallery is empty', async () => {
    const { view } = await openGallery();
    expect(view.queryByLabelText('Select images')).toBeNull();
    expect(view.queryByText('0 selected')).toBeNull();
  });

  it('filters images by conversationId', async () => {
    const { view } = await openGallery({
      images: [
        { ...sampleImages[0], conversationId: 'conv-123' },
        { ...sampleImages[1], conversationId: 'conv-999' },
      ],
      params: { conversationId: 'conv-123' },
    });
    expect(view.getByText('Images (1)')).toBeTruthy();
    expect(view.getByTestId('gallery-image-img-1')).toBeTruthy();
    expect(view.queryByTestId('gallery-image-img-2')).toBeNull();
  });

  it('toggling select mode off clears the selection', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent(view.getByTestId('gallery-image-img-1'), 'onLongPress');
    expect(view.getByText('1 selected')).toBeTruthy();

    rtl.fireEvent.press(view.getByLabelText('Exit selection'));
    expect(view.getByText('Gallery')).toBeTruthy();
    expect(view.queryByText('1 selected')).toBeNull();

    // Selecting again starts from nothing.
    rtl.fireEvent.press(view.getByLabelText('Select images'));
    expect(view.getByText('0 selected')).toBeTruthy();
  });

  it('tapping image in select mode toggles selection', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent(view.getByTestId('gallery-image-img-1'), 'onLongPress');
    expect(view.getByText('1 selected')).toBeTruthy();

    rtl.fireEvent.press(view.getByTestId('gallery-image-img-2'));
    expect(view.getByText('2 selected')).toBeTruthy();

    rtl.fireEvent.press(view.getByTestId('gallery-image-img-2'));
    expect(view.getByText('1 selected')).toBeTruthy();
  });

  it('deleting every selected image removes them all from the Gallery, the store and the disk', async () => {
    const g = await openGallery({ images: sampleImages });
    g.rtl.fireEvent(g.view.getByTestId('gallery-image-img-1'), 'onLongPress');
    g.rtl.fireEvent.press(g.view.getByText('All'));
    expect(g.view.getByText('3 selected')).toBeTruthy();

    g.rtl.fireEvent.press(g.view.getByLabelText('Delete selected images'));
    expect(await g.view.findByText('Delete Images')).toBeTruthy();
    expect(g.view.getByText('Are you sure you want to delete 3 images?')).toBeTruthy();

    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.rtl.within(g.view.getByTestId('app-alert')).getByLabelText('Delete'));
    });

    await g.rtl.waitFor(() => expect(g.view.getByText('No generated images yet')).toBeTruthy());
    expect(g.useAppStore.getState().generatedImages).toEqual([]);
    for (const image of sampleImages) expect(await g.boundary.fs!.exists(g.imagePath(image.id))).toBe(false);
    expect(g.view.queryByText('0 selected')).toBeNull();
  });

  it('the delete-selected button is disabled when nothing is selected', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent(view.getByTestId('gallery-image-img-1'), 'onLongPress');
    rtl.fireEvent.press(view.getByTestId('gallery-image-img-1'));
    expect(view.getByText('0 selected')).toBeTruthy();

    const trash = view.getByLabelText('Delete selected images');
    expect(trash.props.accessibilityState?.disabled).toBe(true);
    rtl.fireEvent.press(trash);
    expect(view.queryByText('Delete Images')).toBeNull();
  });

  it('adds the images the native store holds to the Gallery on mount', async () => {
    const g = await openGallery({
      images: [sampleImages[0]],
      before: ({ boundary, imagePath }) => {
        boundary.fs!.seedFile(imagePath('disk-img-1'), 1024);
        boundary.diffusion.seedGeneratedImages([
          // Already in the Gallery: not added twice.
          { id: 'img-1', prompt: 'A sunset over mountains', imagePath: imagePath('img-1'), createdAt: '2026-01-15T10:00:00.000Z' },
          { id: 'disk-img-1', prompt: 'From disk', imagePath: imagePath('disk-img-1'), width: 512, height: 512, steps: 10, seed: 999, modelId: 'test', createdAt: '2026-01-01T00:00:00.000Z' },
        ]);
      },
    });

    expect(await g.view.findByTestId('gallery-image-disk-img-1')).toBeTruthy();
    expect(g.useAppStore.getState().generatedImages.map((i: { id: string }) => i.id).sort()).toEqual(['disk-img-1', 'img-1']);
    expect(g.view.getByText('Images (2)')).toBeTruthy();
  });

  it('shows the generating banner with the prompt and the native progress', async () => {
    const g = await openGallery({ platform: 'ios' });
    const { run } = await startHeldGeneration(g, 'A beautiful landscape');

    expect(await g.view.findByText('Generating...')).toBeTruthy();
    expect(g.view.getByText('A beautiful landscape')).toBeTruthy();

    await g.rtl.act(async () => {
      g.boundary.litertEvents.emit('LocalDreamProgress', { step: 5, totalSteps: 20, progress: 0.25 });
    });
    expect(await g.view.findByText('5/20')).toBeTruthy();

    g.boundary.diffusion.releaseGeneration();
    await g.rtl.act(async () => { await run; });
  });

  it('shows "Refining..." once native sends a preview', async () => {
    const g = await openGallery({ platform: 'ios' });
    const { run } = await startHeldGeneration(g, 'A landscape');

    await g.rtl.act(async () => {
      g.boundary.litertEvents.emit('LocalDreamProgress', {
        step: 15, totalSteps: 20, progress: 0.75, previewPath: '/tmp/preview.png',
      });
    });
    expect(await g.view.findByText('Refining...')).toBeTruthy();

    g.boundary.diffusion.releaseGeneration();
    await g.rtl.act(async () => { await run; });
  });

  it('the banner cancel stops the native generation, and no image is added', async () => {
    const g = await openGallery({ platform: 'ios' });
    const { run } = await startHeldGeneration(g, 'A landscape');
    await g.view.findByText('Generating...');

    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.view.getByLabelText('Stop image generation'));
    });
    await g.rtl.act(async () => { await run; });

    expect(g.boundary.diffusion.cancelCount()).toBe(1);
    await g.rtl.waitFor(() => expect(g.view.queryByText('Generating...')).toBeNull());
    expect(g.useAppStore.getState().generatedImages).toEqual([]);
    expect(g.view.getByText('No generated images yet')).toBeTruthy();
  });

  it('in a chat, includes images attached to its messages', async () => {
    const { view } = await openGallery({
      images: sampleImages,
      before: () => {
        // The chat as the app writes it: a conversation, and a message carrying img-1 as an attachment.
        const { useChatStore } = require('../../../src/stores');
        const conversationId = useChatStore.getState().createConversation('model-1', 'Chat');
        useChatStore.getState().addMessage(conversationId, {
          role: 'user',
          content: 'look',
          attachments: [{ id: 'img-1', type: 'image', uri: 'file:///x.png' }],
        });
        return { conversationId };
      },
    });
    expect(view.getByText('Images (1)')).toBeTruthy();
    expect(view.getByTestId('gallery-image-img-1')).toBeTruthy();
    expect(view.queryByTestId('gallery-image-img-2')).toBeNull();
  });

  it('long press does not re-enter select mode if already in select mode', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent(view.getByTestId('gallery-image-img-1'), 'onLongPress');
    expect(view.getByText('1 selected')).toBeTruthy();
    rtl.fireEvent(view.getByTestId('gallery-image-img-2'), 'onLongPress');
    expect(view.getByText('1 selected')).toBeTruthy();
  });
});

describe('Gallery image, full screen on its own route', () => {
  it('a tapped image opens full screen, with no row of buttons until the sheet opens', async () => {
    const g = await openGallery({ images: sampleImages });
    await openImage(g, 'img-1');
    expect(g.view.getByTestId('gallery-image-picture')).toBeTruthy();
    expect(g.view.queryByLabelText('Save')).toBeNull();
    expect(g.view.queryByLabelText('Delete')).toBeNull();
  });

  it('More opens one sheet with the actions and the details', async () => {
    const g = await openGallery({ images: sampleImages });
    await openImage(g, 'img-2');
    await openSheet(g);
    expect(g.view.getByLabelText('Save')).toBeTruthy();
    expect(g.view.getByLabelText('Delete')).toBeTruthy();
    expect(g.view.getByText('A cat sitting on a chair')).toBeTruthy();
    expect(g.view.getByText('NEGATIVE')).toBeTruthy();
    expect(g.view.getByText('ugly, blurry')).toBeTruthy();
    expect(g.view.getByText('25 steps')).toBeTruthy();
    expect(g.view.getByText('512x512')).toBeTruthy();
    expect(g.view.getByText('Seed: 67890')).toBeTruthy();
  });

  it('a tap on the picture opens the same sheet; an image with no negative prompt shows none', async () => {
    const g = await openGallery({ images: sampleImages });
    await openImage(g, 'img-1');
    g.rtl.fireEvent.press(g.view.getByTestId('gallery-image-picture'));
    expect(await g.view.findByText('PROMPT')).toBeTruthy();
    expect(g.view.queryByText('NEGATIVE')).toBeNull();
  });

  it('Done closes the sheet and leaves the image open', async () => {
    const g = await openGallery({ images: sampleImages });
    await openImage(g, 'img-1');
    await openSheet(g);
    g.rtl.fireEvent.press(g.view.getByTestId('app-sheet-close'));
    await g.rtl.waitFor(() => expect(g.view.queryByText('PROMPT')).toBeNull());
    expect(g.view.getByTestId('gallery-image-screen')).toBeTruthy();
  });

  it('shows the date of an image saved with a numeric timestamp', async () => {
    const createdAt = String(Date.UTC(2026, 0, 15, 10));
    const g = await openGallery({ images: [{ ...sampleImages[0], createdAt }] });
    const { formatDate } = require('../../../src/screens/GalleryScreen/useGalleryActions');
    await openImage(g, 'img-1');
    await openSheet(g);
    expect(g.view.getByText(formatDate(createdAt))).toBeTruthy();
    expect(formatDate(createdAt)).toContain('2026');
  });

  it('Back returns to the grid', async () => {
    const g = await openGallery({ images: sampleImages });
    await openImage(g, 'img-1');
    g.rtl.fireEvent.press(g.view.getByTestId('gallery-image-back'));
    await backOnGrid(g);
  });

  it('Delete closes the sheet and asks first; nothing is deleted yet', async () => {
    const g = await openGallery({ images: sampleImages });
    await openImage(g, 'img-1');
    await openSheet(g);
    g.rtl.fireEvent.press(g.view.getByLabelText('Delete'));

    expect(await g.view.findByText('Delete Image')).toBeTruthy();
    expect(g.view.getByText('Are you sure you want to delete this image?')).toBeTruthy();
    expect(g.view.queryByText('PROMPT')).toBeNull();
    expect(await g.boundary.fs!.exists(g.imagePath('img-1'))).toBe(true);
    expect(g.useAppStore.getState().generatedImages).toHaveLength(3);
  });

  it('cancelling the delete keeps the image, open', async () => {
    const g = await openGallery({ images: sampleImages });
    await openImage(g, 'img-1');
    await openSheet(g);
    g.rtl.fireEvent.press(g.view.getByLabelText('Delete'));
    await g.view.findByText('Delete Image');

    g.rtl.fireEvent.press(g.view.getByLabelText('Cancel'));
    await g.rtl.waitFor(() => expect(g.view.queryByText('Delete Image')).toBeNull());
    expect(g.useAppStore.getState().generatedImages).toHaveLength(3);
    expect(await g.boundary.fs!.exists(g.imagePath('img-1'))).toBe(true);
    expect(g.view.getByTestId('gallery-image-screen')).toBeTruthy();
  });

  it('confirming delete removes the image from the store and the disk, and returns to the grid without it', async () => {
    const g = await openGallery({ images: sampleImages });
    await openImage(g, 'img-1');
    await openSheet(g);
    g.rtl.fireEvent.press(g.view.getByLabelText('Delete'));
    await g.view.findByText('Delete Image');
    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.rtl.within(g.view.getByTestId('app-alert')).getByLabelText('Delete'));
    });

    await backOnGrid(g);
    expect(g.view.queryByTestId('gallery-image-img-1')).toBeNull();
    expect(g.useAppStore.getState().generatedImages.map((i: { id: string }) => i.id)).toEqual(['img-3', 'img-2']);
    expect(await g.boundary.fs!.exists(g.imagePath('img-1'))).toBe(false);
    expect(await g.boundary.fs!.exists(g.imagePath('img-2'))).toBe(true);
  });

  it('an image whose file cannot be removed stays, open, and says so', async () => {
    const g = await openGallery({
      images: sampleImages,
      before: ({ boundary, imagePath }) => {
        // The disk refuses this one file, as a locked file does.
        const unlink = boundary.fs!.module.unlink.getMockImplementation()!;
        boundary.fs!.module.unlink.mockImplementation(async (path: string) => {
          if (path === imagePath('img-1')) throw new Error('EACCES: permission denied');
          return unlink(path);
        });
      },
    });
    await openImage(g, 'img-1');
    await openSheet(g);
    g.rtl.fireEvent.press(g.view.getByLabelText('Delete'));
    await g.view.findByText('Delete Image');
    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.rtl.within(g.view.getByTestId('app-alert')).getByLabelText('Delete'));
    });

    expect(await g.view.findByText('Image was not deleted')).toBeTruthy();
    expect(g.view.getByTestId('gallery-image-screen')).toBeTruthy();
    expect(g.useAppStore.getState().generatedImages).toHaveLength(3);
    expect(await g.boundary.fs!.exists(g.imagePath('img-1'))).toBe(true);
  });

  it('on iOS, Save hands the image file to the share sheet, over the open sheet', async () => {
    const g = await openGallery({ images: sampleImages, platform: 'ios' });
    const { Share } = require('react-native');
    // The OS share sheet is the device boundary: record what reached it.
    const shared: unknown[] = [];
    Share.share = async (content: unknown) => {
      shared.push(content);
      return { action: 'sharedAction' };
    };

    await openImage(g, 'img-1');
    await openSheet(g);
    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.view.getByLabelText('Save'));
    });

    expect(shared).toEqual([{ url: `file://${g.imagePath('img-1')}` }]);
    // The share sheet presents from the open sheet, which stays.
    expect(g.view.getByText('PROMPT')).toBeTruthy();
  });

  it('on Android, Save copies the image to Pictures/OffgridMobile and says where', async () => {
    const g = await openGallery({ images: sampleImages });
    allowStorage();
    await openImage(g, 'img-1');
    await openSheet(g);
    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.view.getByLabelText('Save'));
    });

    expect(await g.view.findByText('Image Saved')).toBeTruthy();
    // Shared storage, where the app's file system puts it on this phone.
    const external = require('react-native-fs').ExternalStorageDirectoryPath;
    const pictures = `${external}/Pictures/OffgridMobile`;
    const saved = g.boundary.fs!.listFiles(pictures);
    expect(saved).toHaveLength(1);
    expect(g.view.getByText(`Saved to Pictures/OffgridMobile/${saved[0].split('/').pop()}`)).toBeTruthy();

    // A second Save goes into the same folder, beside the first.
    g.rtl.fireEvent.press(g.view.getByText('OK'));
    await g.rtl.waitFor(() => expect(g.view.queryByText('Image Saved')).toBeNull());
    await new Promise(resolve => setTimeout(resolve, 5));
    await openSheet(g);
    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.view.getByLabelText('Save'));
    });
    expect(await g.view.findByText('Image Saved')).toBeTruthy();
    expect(g.boundary.fs!.listFiles(pictures)).toHaveLength(2);
  });

  it('a Save that fails says why', async () => {
    const g = await openGallery({
      images: sampleImages,
      before: ({ boundary }) => {
        boundary.fs!.module.copyFile.mockImplementation(async () => { throw new Error('No space left'); });
      },
    });
    allowStorage();
    await openImage(g, 'img-1');
    await openSheet(g);
    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.view.getByLabelText('Save'));
    });

    expect(await g.view.findByText('Failed to save image: No space left')).toBeTruthy();
  });

  it('a Save that fails with no reason says the error is unknown', async () => {
    const g = await openGallery({
      images: sampleImages,
      before: ({ boundary }) => {
        boundary.fs!.module.copyFile.mockImplementation(async () => { throw undefined; });
      },
    });
    allowStorage();
    await openImage(g, 'img-1');
    await openSheet(g);
    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.view.getByLabelText('Save'));
    });

    expect(await g.view.findByText('Failed to save image: Unknown error')).toBeTruthy();
  });

  it('an image no longer in the Gallery says so, and Back still leaves', async () => {
    const g = await openGallery({ images: sampleImages });
    await openImage(g, 'img-1');
    // Removed elsewhere (a chat delete, a sync) while it is open.
    await g.rtl.act(async () => { g.useAppStore.getState().removeGeneratedImage('img-1'); });

    expect(g.view.getByText('This image is no longer in your Gallery.')).toBeTruthy();
    expect(g.view.queryByTestId('gallery-image-more')).toBeNull();
    g.rtl.fireEvent.press(g.view.getByTestId('gallery-image-back'));
    await backOnGrid(g);
  });
});

describe('Gallery video, played on its own route', () => {
  /** A saved video, its file on the disk where the app writes it. */
  const seedVideo = (boundary: NativeBoundary, useAppStore: any, id = 'vid-1') => {
    const videoPath = `${boundary.fs!.DocumentDirectoryPath}/generated-videos/${id}.mp4`;
    boundary.fs!.seedFile(videoPath, 4096);
    useAppStore.getState().addGeneratedVideo({
      id, prompt: 'a fox in snow', videoPath, width: 480, height: 832, fps: 16, frames: 33, durationSeconds: 2,
      steps: 20, guidance: 5, seed: 1, modelId: 'wan', createdAt: '2026-01-15T10:00:00.000Z',
    });
    return videoPath;
  };

  async function openVideo(platform: 'ios' | 'android' = 'android') {
    let videoPath = '';
    const g = await openGallery({
      platform,
      before: ({ boundary, useAppStore }) => { videoPath = seedVideo(boundary, useAppStore); },
    });
    g.rtl.fireEvent.press(g.view.getByTestId('gallery-tab-videos'));
    g.rtl.fireEvent.press(await g.view.findByText('a fox in snow'));
    await g.view.findByTestId('gallery-video-screen');
    return { ...g, videoPath };
  }

  it('a tapped video opens its player on its own route; Back returns to the list', async () => {
    const g = await openVideo();
    expect(g.view.getAllByText('a fox in snow').length).toBeGreaterThan(0);
    g.rtl.fireEvent.press(g.view.getByTestId('gallery-video-back'));
    await g.rtl.waitFor(() => expect(g.view.queryByTestId('gallery-video-screen')).toBeNull());
    expect(g.view.getByText('Videos (1)')).toBeTruthy();
  });

  it('on iOS, Share hands the video file to the share sheet', async () => {
    const g = await openVideo('ios');
    const { Share } = require('react-native');
    const shared: unknown[] = [];
    Share.share = async (content: unknown) => {
      shared.push(content);
      return { action: 'sharedAction' };
    };
    await g.rtl.act(async () => { g.rtl.fireEvent.press(g.view.getByText('Share')); });
    expect(shared).toEqual([{ url: `file://${g.videoPath}` }]);
  });

  it('on Android, Save puts the video in Downloads and says so; a failed save says why', async () => {
    const g = await openVideo();
    const { NativeModules } = require('react-native');
    const downloads = `${require('react-native-fs').ExternalStorageDirectoryPath}/Download`;
    // The Downloads writer is the device boundary: it copies the file, or the OS refuses it.
    let refuse = false;
    NativeModules.SyncDownloadsModule = {
      saveFileToDownloads: async (source: string, fileName: string) => {
        if (refuse) throw new Error('Storage full');
        await g.boundary.fs!.module.copyFile(source, `${downloads}/${fileName}`);
      },
    };

    await g.rtl.act(async () => { g.rtl.fireEvent.press(g.view.getByText('Save')); });
    expect(await g.view.findByText('Saved to Downloads')).toBeTruthy();
    expect(await g.boundary.fs!.exists(`${downloads}/vid-1.mp4`)).toBe(true);
    g.rtl.fireEvent.press(g.view.getByText('OK'));
    await g.rtl.waitFor(() => expect(g.view.queryByText('Saved to Downloads')).toBeNull());

    refuse = true;
    await g.rtl.act(async () => { g.rtl.fireEvent.press(g.view.getByText('Save')); });
    expect(await g.view.findByText('Save failed')).toBeTruthy();
    expect(g.view.getByText('Storage full')).toBeTruthy();
  });

  it('Delete asks first; Delete removes the file and the record and returns to the list', async () => {
    const g = await openVideo();
    g.rtl.fireEvent.press(g.view.getByText('Delete video'));
    expect(await g.view.findByText('Delete this video?')).toBeTruthy();
    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.rtl.within(g.view.getByTestId('app-alert')).getByLabelText('Delete'));
    });

    await g.rtl.waitFor(() => expect(g.view.queryByTestId('gallery-video-screen')).toBeNull());
    expect(g.useAppStore.getState().generatedVideos).toEqual([]);
    expect(await g.boundary.fs!.exists(g.videoPath)).toBe(false);
    expect(g.view.getByText('No videos in this gallery')).toBeTruthy();
  });

  it('a video whose file cannot be removed stays, and says so', async () => {
    const g = await openVideo();
    g.boundary.fs!.module.unlink.mockImplementation(async () => { throw new Error('EACCES: permission denied'); });
    g.rtl.fireEvent.press(g.view.getByText('Delete video'));
    await g.view.findByText('Delete this video?');
    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.rtl.within(g.view.getByTestId('app-alert')).getByLabelText('Delete'));
    });

    expect(await g.view.findByText('Could not delete video')).toBeTruthy();
    expect(g.view.getByTestId('gallery-video-screen')).toBeTruthy();
    expect(g.useAppStore.getState().generatedVideos).toHaveLength(1);
    expect(await g.boundary.fs!.exists(g.videoPath)).toBe(true);
  });

  it('a video no longer in the Gallery says so', async () => {
    const g = await openVideo();
    await g.rtl.act(async () => { g.useAppStore.getState().removeGeneratedVideo('vid-1'); });
    expect(g.view.getByText('This video is no longer in your Gallery.')).toBeTruthy();
    expect(g.view.queryByText('Delete video')).toBeNull();
  });
});
