/**
 * GalleryScreen Tests
 *
 * The real Gallery over the real app and chat stores, the real image-generation service and the real
 * on-device image store (localDreamGenerator), inside a real React Navigation stack opened from Home.
 *
 * Faked: only the device boundary (harness/nativeBoundary): the diffusion native module (the native
 * image store, generation and cancel), react-native-fs over an in-memory disk, the OS share sheet, RAM.
 * Images enter the way the app adds them (the store's addGeneratedImage, or the native gallery scan),
 * with their PNG on the disk where the native module saves it.
 */
import type { NativeBoundary } from '../../harness/nativeBoundary';
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { withNavigatorRoutes } from '../../harness/realNavigation';

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
    withNavigatorRoutes(React.createElement(GalleryScreen), { params, openedFrom: 'Home' }),
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

  it('tapping an image opens the viewer modal', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent.press(view.getByTestId('gallery-image-img-1'));
    expect(view.getByText('Info')).toBeTruthy();
    expect(view.getByText('Save')).toBeTruthy();
    expect(view.getByText('Delete')).toBeTruthy();
    expect(view.getByText('Close')).toBeTruthy();
  });

  it('pressing delete in viewer asks for confirmation and deletes nothing yet', async () => {
    const g = await openGallery({ images: sampleImages });
    g.rtl.fireEvent.press(g.view.getByTestId('gallery-image-img-1'));
    g.rtl.fireEvent.press(g.view.getByText('Delete'));

    expect(await g.view.findByText('Delete Image')).toBeTruthy();
    expect(g.view.getByText('Are you sure you want to delete this image?')).toBeTruthy();
    expect(await g.boundary.fs!.exists(g.imagePath('img-1'))).toBe(true);
    expect(g.useAppStore.getState().generatedImages).toHaveLength(3);
  });

  it('pressing close in viewer closes the modal', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent.press(view.getByTestId('gallery-image-img-1'));
    rtl.fireEvent.press(view.getByText('Close'));
    expect(view.queryByText('Save')).toBeNull();
  });

  it('pressing Info toggles details view', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent.press(view.getByTestId('gallery-image-img-1'));
    rtl.fireEvent.press(view.getByText('Info'));
    expect(view.getByText('Image details')).toBeTruthy();
    expect(view.getByText('PROMPT')).toBeTruthy();
    // The prompt shows in the grid item's label and in the details sheet.
    expect(view.getByText('A sunset over mountains')).toBeTruthy();
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

  it('confirming delete removes the image from the Gallery, the store and the disk', async () => {
    const g = await openGallery({ images: sampleImages });
    g.rtl.fireEvent.press(g.view.getByTestId('gallery-image-img-1'));
    g.rtl.fireEvent.press(g.view.getByText('Delete'));
    await g.view.findByText('Delete Image');
    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.rtl.within(g.view.getByTestId('app-alert')).getByLabelText('Delete'));
    });

    await g.rtl.waitFor(() => expect(g.view.queryByTestId('gallery-image-img-1')).toBeNull());
    expect(g.useAppStore.getState().generatedImages.map((i: { id: string }) => i.id)).toEqual(['img-3', 'img-2']);
    expect(await g.boundary.fs!.exists(g.imagePath('img-1'))).toBe(false);
    expect(await g.boundary.fs!.exists(g.imagePath('img-2'))).toBe(true);
    // The viewer closed with it.
    expect(g.view.queryByText('Save')).toBeNull();
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

  it('on iOS, Save hands the image file to the share sheet', async () => {
    const g = await openGallery({ images: sampleImages, platform: 'ios' });
    const { Share } = require('react-native');
    // The OS share sheet is the device boundary: record what reached it.
    const shared: unknown[] = [];
    Share.share = async (content: unknown) => {
      shared.push(content);
      return { action: 'sharedAction' };
    };

    g.rtl.fireEvent.press(g.view.getByTestId('gallery-image-img-1'));
    await g.rtl.act(async () => {
      g.rtl.fireEvent.press(g.view.getByText('Save'));
    });

    expect(shared).toEqual([{ url: `file://${g.imagePath('img-1')}` }]);
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

  it('the system back gesture closes the viewer', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    const { Modal } = require('react-native');
    rtl.fireEvent.press(view.getByTestId('gallery-image-img-1'));
    expect(view.getByText('Info')).toBeTruthy();

    const viewer = view.UNSAFE_getAllByType(Modal).find((m: any) => m.props.visible && m.props.transparent);
    rtl.fireEvent(viewer!, 'requestClose');
    expect(view.queryByText('Save')).toBeNull();
  });

  it('details sheet shows negative prompt when present', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent.press(view.getByTestId('gallery-image-img-2'));
    rtl.fireEvent.press(view.getByText('Info'));
    expect(view.getByText('NEGATIVE')).toBeTruthy();
    expect(view.getByText('ugly, blurry')).toBeTruthy();
  });

  it('details sheet Done button closes details', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent.press(view.getByTestId('gallery-image-img-1'));
    rtl.fireEvent.press(view.getByText('Info'));
    expect(view.getByText('Image details')).toBeTruthy();
    rtl.fireEvent.press(view.getByText('Done'));
    expect(view.queryByText('Image details')).toBeNull();
  });

  it('cancelling the delete alert closes it and keeps the image', async () => {
    const g = await openGallery({ images: sampleImages });
    g.rtl.fireEvent.press(g.view.getByTestId('gallery-image-img-1'));
    g.rtl.fireEvent.press(g.view.getByText('Delete'));
    await g.view.findByText('Delete Image');

    g.rtl.fireEvent.press(g.view.getByLabelText('Cancel'));
    await g.rtl.waitFor(() => expect(g.view.queryByText('Delete Image')).toBeNull());
    expect(g.useAppStore.getState().generatedImages).toHaveLength(3);
    expect(await g.boundary.fs!.exists(g.imagePath('img-1'))).toBe(true);
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

  it('shows the date of an image saved with a numeric timestamp', async () => {
    const createdAt = String(Date.UTC(2026, 0, 15, 10));
    const { view, rtl } = await openGallery({ images: [{ ...sampleImages[0], createdAt }] });
    const { formatDate } = require('../../../src/screens/GalleryScreen/useGalleryActions');
    rtl.fireEvent.press(view.getByTestId('gallery-image-img-1'));
    rtl.fireEvent.press(view.getByText('Info'));
    expect(view.getByText(formatDate(createdAt))).toBeTruthy();
    expect(formatDate(createdAt)).toContain('2026');
  });

  it('long press does not re-enter select mode if already in select mode', async () => {
    const { view, rtl } = await openGallery({ images: sampleImages });
    rtl.fireEvent(view.getByTestId('gallery-image-img-1'), 'onLongPress');
    expect(view.getByText('1 selected')).toBeTruthy();
    rtl.fireEvent(view.getByTestId('gallery-image-img-2'), 'onLongPress');
    expect(view.getByText('1 selected')).toBeTruthy();
  });
});
