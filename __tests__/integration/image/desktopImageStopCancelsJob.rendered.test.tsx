/**
 * Stop during a Desktop (remote) image job (commits 53596925, 0ce79962).
 *
 * Off Grid AI Desktop runs an image as an async job that the phone polls. While that job is still
 * running, the user presses Stop on the image card in the chat:
 *  - the chat stops showing the image as in progress, and no image appears;
 *  - nothing is saved: no image file on the phone, nothing new in the Gallery;
 *  - Desktop is told to cancel that job (DELETE /v1/requests/{id}), so it stops spending its GPU.
 * When the job completes at the same moment the user presses Stop, the late image is still not saved
 * or shown.
 *
 * Real ChatScreen, real image-mode toggle, real remote-model picker, real imageGenerationService,
 * remote image runner, remoteMediaRuntime and GalleryScreen. Fakes only at the network (fetch: the
 * Desktop gateway, harness/desktopImageJobHold) and the native file system (RNFS).
 * The DELETE Desktop received is a boundary stub record, read alongside the UI assertions.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { chooseDesktopImageModel } from '../../harness/remoteImageServer';
import { holdDesktopImageJob, type HeldDesktopImageJob } from '../../harness/desktopImageJobHold';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

describe('Stop during a Desktop image job', () => {
  let h: Harness;
  let desktop: HeldDesktopImageJob | undefined;
  const imagesDir = () => `${h.boundary.fs!.DocumentDirectoryPath}/generated_images`;

  afterEach(async () => {
    desktop?.finish();
    desktop?.restore();
    desktop = undefined;
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    await remoteServerManager.clearAllServers();
  });

  /** Pick the Desktop image model, send the prompt, and wait until the job is running on Desktop. */
  async function startRunningJob(honorsStop: boolean): Promise<HeldDesktopImageJob> {
    h = await setupChatScreen({ engine: 'llama' });
    const job = holdDesktopImageJob({ honorsStop });
    desktop = job;
    await chooseDesktopImageModel(h);
    expect(h.view!.queryByTestId('generated-image')).toBeNull();

    await h.tapSend('draw a lighthouse at dusk');

    // BEFORE: the job is running on Desktop (its second poll is held open) and the chat shows it in
    // progress at Desktop's reported step, with no image yet.
    await h.rtl.waitFor(() => { expect(job.held()).toBe(true); }, { timeout: 8000 });
    expect(h.view!.getByText('Generating Image')).toBeTruthy();
    expect(h.view!.getByText('1/4')).toBeTruthy();
    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    expect(job.cancels).toEqual([]);
    return job;
  }

  /** What the user finds afterwards: no image in the chat, on disk, or in the Gallery. */
  async function expectNothingSaved(): Promise<void> {
    // Stopped, not failed: the progress card is gone and no failure card stands in for it.
    expect(h.view!.queryByText('Generating Image')).toBeNull();
    expect(h.view!.queryByTestId('model-failure-image')).toBeNull();
    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    expect(h.boundary.fs!.listFiles(imagesDir())).toEqual([]);

    const { GalleryScreen } = require('../../../src/screens/GalleryScreen');
    const gallery = h.rtl.render(h.React.createElement(GalleryScreen));
    expect(await gallery.findByText('No generated images yet')).toBeTruthy();
    expect(gallery.queryAllByTestId(/^gallery-image-/)).toHaveLength(0);
    gallery.unmount();
  }

  it('stops the image in the chat, saves nothing, and cancels the job on Desktop', async () => {
    const job = await startRunningJob(true);

    await h.pressImageCardStop();

    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Generating Image')).toBeNull(); });
    await h.rtl.waitFor(() => { expect(job.cancels).toEqual(['img-1']); });
    await h.settle(200);
    await expectNothingSaved();
    expect(job.requests).toEqual([
      'POST /v1/images/generations',
      'GET /v1/requests/img-1',
      'GET /v1/requests/img-1',
      'DELETE /v1/requests/img-1',
    ]);
  }, 30000);

  it('a job that completes as Stop lands is not saved or shown', async () => {
    const job = await startRunningJob(false);

    await h.pressImageCardStop();
    // Desktop answers the poll that was in flight: the job completed with an image.
    await h.rtl.act(async () => { job.finish(); });
    expect(job.held()).toBe(false);
    await h.settle(300);

    await expectNothingSaved();
    expect(job.cancels).toEqual(['img-1']);
  }, 30000);
});
