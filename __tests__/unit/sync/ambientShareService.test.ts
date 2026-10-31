import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AMBIENT_SHARE_ANY_DESTINATION,
  type SharedFileDescriptor,
} from '@offgrid/sync';
import type { SyncPreferences } from '../../../pro/sync/syncPreferences';
import type { ambientShareService as AmbientShareService } from '../../../pro/sync/ambientShareService';

/**
 * Sharing a file to another of the user's devices without being asked every time.
 *
 * The user says, once, "screenshots go to my Mac" - and from then on a screenshot leaves this phone with
 * nothing to tap. That is a standing consent, and standing consent is exactly the thing that has to be
 * conservative: the wrong answer here sends a file the user did not mean to send, to a device they were
 * not thinking about, with no moment at which they could have stopped it.
 *
 * So the decisions this holds are all about DOUBT:
 *  - Told to ask: nothing leaves until a person taps, and cancelling means it never goes.
 *  - Not told anything: nothing leaves, and the file does not sit in a queue implying it will.
 *  - The far device is not there: either it waits or it is dropped, and the user chose which.
 *  - Consent withdrawn: whatever was mid-flight stops mattering, including its outcome.
 *
 * The service runs for real against real storage. What stands in is Sync itself - the peers it can see and
 * the transfers it schedules - because that is the boundary this service is written against.
 */
describe('sharing a file to another device without being asked', () => {
  const PREFERENCES: SyncPreferences = {
    chats: true,
    projects: true,
    settings: true,
    notes: true,
    screenshots: false,
    downloads: false,
    generatedMedia: false,
    attachments: false,
  };

  const THE_MAC = 'the-mac';
  const THE_IPAD = 'the-ipad';

  interface Scheduled {
    deviceId: string;
    file: SharedFileDescriptor;
    completed(): Promise<void>;
    failed(error: Error): Promise<void>;
  }

  interface Harness {
    service: typeof AmbientShareService;
    /** Every transfer Sync was asked to make, in order, still holding its callbacks. */
    scheduled: Scheduled[];
    files: Map<string, SharedFileDescriptor>;
    destinations: Array<{
      deviceId: string;
      deviceName: string;
      connected: boolean;
    }>;
    /** How many times the screen was told to repaint. */
    notifications: () => number;
    settled: () => Promise<void>;
  }

  /**
   * Sync ids are UUIDs, and the activity key is built from them - a non-UUID throws rather than
   * producing a key nothing could ever match. So the ids here are real ones, named readably.
   */
  const SYNC_ID: Record<string, string> = {};
  const idOf = (name: string): string => {
    if (!SYNC_ID[name]) {
      const index = Object.keys(SYNC_ID).length + 1;
      SYNC_ID[name] = `0000${index.toString().padStart(4, '0')}-0000-4000-8000-000000000000`.slice(
        -36,
      );
    }
    return SYNC_ID[name]!;
  };

  const screenshot = (
    name: string,
    overrides: Partial<SharedFileDescriptor> = {},
  ): SharedFileDescriptor => ({
    syncId: idOf(name),
    kind: 'screenshot',
    name: `${name}.png`,
    mimeType: 'image/png',
    fileSize: 4096,
    createdAt: '2026-08-04T09:00:00.000Z',
    ...overrides,
  });

  /**
   * A fresh service, because it is a singleton that loads once per app launch.
   *
   * Reloading the module is how a launch is modelled: state comes back from storage, not from the last
   * test, which is also what makes "this survives a restart" something these tests can actually show.
   */
  async function launch(): Promise<Harness> {
    jest.resetModules();
    const { ambientShareService } = require('../../../pro/sync/ambientShareService');
    const files = new Map<string, SharedFileDescriptor>();
    const scheduled: Scheduled[] = [];
    const destinations: Harness['destinations'] = [
      { deviceId: THE_MAC, deviceName: "Mac's MacBook Pro", connected: true },
    ];
    let notifications = 0;
    ambientShareService.onChanged(() => {
      notifications += 1;
    });
    await ambientShareService.start(PREFERENCES, {
      destinations: () => destinations,
      files: () => [...files.values()],
      getFile: (syncId: string) => files.get(syncId),
      // Made on this device, so there is no origin to keep it away from.
      originOf: () => undefined,
      scheduleDelivery: async (
        deviceId: string,
        file: SharedFileDescriptor,
        lifecycle: { started?(): Promise<void>; completed(): Promise<void>; failed(error: Error): Promise<void> },
      ) => {
        await lifecycle.started?.();
        scheduled.push({ deviceId, file, ...lifecycle });
      },
    });
    return {
      service: ambientShareService,
      scheduled,
      files,
      destinations,
      notifications: () => notifications,
      // The screen is repainted on a timer, because delivery progress arrives per chunk and repainting
      // per chunk is what made one large transfer feel sluggish.
      settled: async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
      },
    };
  }

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe('turning sharing off after a file was already granted', () => {
    it('revokes the grant, so a reconnect sends nothing', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));
      expect(harness.service.allowsState(THE_MAC, idOf('shot-1'))).toBe(true);

      // The user changes their mind while that transfer is still going.
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'off',
      });

      // The grant is gone. It used to survive, because reconciliation skipped anything already granted - and the
      // reconnect path re-announces whatever is still granted WITHOUT consulting the policy again, so bytes left
      // the device after the user withdrew consent. That is the one thing an Off switch has to prevent.
      expect(harness.service.allowsState(THE_MAC, idOf('shot-1'))).toBe(false);
    });

    it('does not bring the grant back after a restart', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));

      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'off',
      });

      // A fresh launch reading what was actually written. The policy and the deliveries are saved by the same
      // call, and the grant is dropped BEFORE that write - so there is no persisted state in which sharing is
      // off and the grant survives. Persisting the policy first and removing the grant in a second write left
      // exactly that window: a process death in between restored the grant, and reconnect sent the bytes.
      const relaunched = await launch();

      expect(relaunched.service.allowsState(THE_MAC, idOf('shot-1'))).toBe(false);
    });

    it('sends nothing new when the device comes back', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));
      const sentBeforeRevoking = harness.scheduled.length;

      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'off',
      });
      await harness.service.connected(THE_MAC);

      // Reconnection is exactly when the old behaviour resurrected a revoked delivery.
      expect(harness.scheduled).toHaveLength(sentBeforeRevoking);
    });

    it('leaves a grant alone when the rule still allows it', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));

      // Re-asserting the same permissive rule must not disturb an in-flight transfer: re-granting would send the
      // same file twice, which is the failure on the other side of this fix.
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });

      expect(harness.service.allowsState(THE_MAC, idOf('shot-1'))).toBe(true);
      expect(harness.scheduled).toHaveLength(1);
    });
  });

  describe('a standing rule to send', () => {
    it('sends a screenshot with nothing to tap', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));

      await harness.service.handleCapture(screenshot('shot-1'));

      expect(harness.scheduled).toHaveLength(1);
      expect(harness.scheduled[0]).toMatchObject({
        deviceId: THE_MAC,
        file: expect.objectContaining({ syncId: idOf('shot-1') }),
      });
      expect(harness.service.allowsState(THE_MAC, idOf('shot-1'))).toBe(true);
    });

    it('does not send the same file twice while it is still going', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));

      await harness.service.handleCapture(screenshot('shot-1'));

      // The same capture can be reported more than once - a folder watcher firing twice for one write.
      // Sending twice would show the user two transfers of one file and cost them the bytes twice.
      expect(harness.scheduled).toHaveLength(1);
    });

    it('sends nothing to a device the rule does not name', async () => {
      const harness = await launch();
      harness.destinations.push({
        deviceId: THE_IPAD,
        deviceName: "Mac's iPad",
        connected: true,
      });
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));

      await harness.service.handleCapture(screenshot('shot-1'));

      expect(harness.scheduled.map(item => item.deviceId)).toEqual([THE_MAC]);
    });

    it('sends nothing at all when no rule covers the file', async () => {
      const harness = await launch();
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));

      await harness.service.handleCapture(screenshot('shot-1'));

      // No rule means no consent. Nothing is sent AND nothing is left in a queue, because a queued row
      // tells the user it is going to go.
      expect(harness.scheduled).toEqual([]);
      expect(harness.service.deliverySnapshot()).toEqual([]);
    });

    it('says which sources have a rule at all, so a watcher is not run for nothing', async () => {
      const harness = await launch();
      expect(harness.service.sourceActive('screenshot')).toBe(false);

      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });

      expect(harness.service.sourceActive('screenshot')).toBe(true);
      expect(harness.service.sourceActive('download')).toBe(false);
    });

    it('stops sending when the rule is turned off', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });

      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'off',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));

      expect(harness.service.sourceActive('screenshot')).toBe(false);
      expect(harness.scheduled).toEqual([]);
    });
  });

  describe('a rule that says ask first', () => {
    async function askingHarness(): Promise<Harness> {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'ask',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));
      return harness;
    }

    it('sends nothing until somebody taps', async () => {
      const harness = await askingHarness();

      expect(harness.scheduled).toEqual([]);
      expect(harness.service.deliverySnapshot()).toEqual([
        expect.objectContaining({ syncId: idOf('shot-1'), status: 'prompt' }),
      ]);
      // The prompt is a question the user can see, named after the file and the device it would go to.
      expect(harness.service.approvals().items).toEqual([
        expect.objectContaining({ syncId: idOf('shot-1'), deviceId: THE_MAC }),
      ]);
    });

    it('sends it once the user says yes, and remembers that they did', async () => {
      const harness = await askingHarness();

      await harness.service.acceptPrompt(idOf('shot-1'), THE_MAC);

      expect(harness.scheduled).toHaveLength(1);
      expect(harness.service.allowsState(THE_MAC, idOf('shot-1'))).toBe(true);
      // Kept so the user can see what they agreed to after the sheet has gone.
      expect(harness.service.approvalResultSnapshot()).toEqual([
        expect.objectContaining({ accepted: true }),
      ]);
      expect(harness.service.approvals().items).toEqual([]);
    });

    it('never sends it when the user says no', async () => {
      const harness = await askingHarness();

      await harness.service.rejectPrompt(idOf('shot-1'), THE_MAC);

      expect(harness.scheduled).toEqual([]);
      // Gone, not remembered as refused-but-pending: a row that stays would ask again, and a question
      // already answered no must not come back on its own.
      expect(harness.service.deliverySnapshot()).toEqual([]);
      expect(harness.service.approvalResultSnapshot()).toEqual([
        expect.objectContaining({ accepted: false }),
      ]);
    });

    it('never sends it when the user cancels instead of answering', async () => {
      const harness = await askingHarness();

      await harness.service.cancelPending(idOf('shot-1'), THE_MAC);

      expect(harness.scheduled).toEqual([]);
      expect(harness.service.deliverySnapshot()).toEqual([]);
      // Cancelling is not the same as refusing: nothing is recorded as a decision, because the user did
      // not make one.
      expect(harness.service.approvalResultSnapshot()).toEqual([]);
    });

    it('will not cancel a file that is already going', async () => {
      const harness = await askingHarness();
      await harness.service.acceptPrompt(idOf('shot-1'), THE_MAC);

      await harness.service.cancelPending(idOf('shot-1'), THE_MAC);

      // Consent has been given and the transfer is running. Cancelling THAT is a transfer action, not a
      // consent one, and quietly dropping the row here would leave a transfer nothing is watching.
      expect(harness.service.allowsState(THE_MAC, idOf('shot-1'))).toBe(true);
    });

    it('drops the question when the file itself has gone', async () => {
      const harness = await askingHarness();
      harness.files.delete(idOf('shot-1'));

      await harness.service.acceptPrompt(idOf('shot-1'), THE_MAC);

      // Said yes to a screenshot that has since been deleted. There is nothing to send, so the question
      // goes rather than becoming a transfer that can only fail.
      expect(harness.scheduled).toEqual([]);
      expect(harness.service.deliverySnapshot()).toEqual([]);
    });

    it('forgets the answers when the user clears them', async () => {
      const harness = await askingHarness();
      await harness.service.acceptPrompt(idOf('shot-1'), THE_MAC);
      expect(harness.service.approvalResultSnapshot()).toHaveLength(1);

      await harness.service.clearApprovalResults();

      expect(harness.service.approvalResultSnapshot()).toEqual([]);
      // Clearing an empty list is not a write. Otherwise every visit to the screen would rewrite storage.
      await harness.settled();
      const before = harness.notifications();
      await harness.service.clearApprovalResults();
      await harness.settled();
      expect(harness.notifications()).toBe(before);
    });
  });

  describe('the other device not being there', () => {
    it('sends older chat files when their first destination pairs later', async () => {
      const harness = await launch();
      harness.destinations.splice(0);
      const generated = screenshot('generated-before-pair', {
        kind: 'generated_media',
      });
      const attachment = screenshot('attachment-before-pair', {
        kind: 'message_attachment',
      });
      harness.files.set(generated.syncId, generated);
      harness.files.set(attachment.syncId, attachment);

      await harness.service.handleCapture(generated);
      await harness.service.handleCapture(attachment);
      expect(harness.scheduled).toEqual([]);

      harness.destinations.push({
        deviceId: THE_MAC,
        deviceName: "Mac's MacBook Pro",
        connected: true,
      });
      await harness.service.connected(THE_MAC);

      expect(harness.scheduled.map(item => item.file.syncId)).toEqual([
        generated.syncId,
        attachment.syncId,
      ]);
      expect(harness.service.allowsState(THE_MAC, generated.syncId)).toBe(
        true,
      );
      expect(harness.service.allowsState(THE_MAC, attachment.syncId)).toBe(
        true,
      );
    });

    it('does not turn a new pairing into screenshot history backfill', async () => {
      const harness = await launch();
      harness.destinations.splice(0);
      const olderScreenshot = screenshot('screenshot-before-pair');
      harness.files.set(olderScreenshot.syncId, olderScreenshot);

      harness.destinations.push({
        deviceId: THE_MAC,
        deviceName: "Mac's MacBook Pro",
        connected: true,
      });
      await harness.service.connected(THE_MAC);

      expect(harness.scheduled).toEqual([]);
      expect(
        harness.service.allowsState(THE_MAC, olderScreenshot.syncId),
      ).toBe(false);
    });

    it('waits for it when the user asked for that', async () => {
      const harness = await launch();
      harness.destinations[0]!.connected = false;
      // What happens when the far device is away is ONE setting for the whole policy, not something a rule
      // can say - so a user who wants screenshots queued and downloads dropped cannot have that.
      await harness.service.setOfflineBehavior('queue');
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));

      await harness.service.handleCapture(screenshot('shot-1'));

      expect(harness.scheduled).toEqual([]);
      expect(harness.service.deliverySnapshot()).toEqual([
        expect.objectContaining({ status: 'queued' }),
      ]);
    });

    it('sends what was waiting the moment it comes back', async () => {
      const harness = await launch();
      harness.destinations[0]!.connected = false;
      // What happens when the far device is away is ONE setting for the whole policy, not something a rule
      // can say - so a user who wants screenshots queued and downloads dropped cannot have that.
      await harness.service.setOfflineBehavior('queue');
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));

      harness.destinations[0]!.connected = true;
      await harness.service.connected(THE_MAC);

      // This is the whole promise of queueing: the user took a screenshot on a train and it is on their
      // Mac when they get home, without them doing anything.
      expect(harness.scheduled).toHaveLength(1);
      expect(harness.service.allowsState(THE_MAC, idOf('shot-1'))).toBe(true);
    });

    it('drops it instead when the user asked for that', async () => {
      const harness = await launch();
      // Stated, not inherited: a new install QUEUES for an absent device, so the drop this test is
      // about is the user's explicit choice and the test has to make it explicitly.
      await harness.service.setOfflineBehavior('skip');
      harness.destinations[0]!.connected = false;
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));

      await harness.service.handleCapture(screenshot('shot-1'));

      // Chosen by the user for a reason: a phone that takes hundreds of screenshots a week should not
      // arrive home and send all of them at once.
      expect(harness.service.deliverySnapshot()).toEqual([]);
    });

    it('does not re-send a file that already got there', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));
      await harness.scheduled[0]!.completed();

      await harness.service.connected(THE_MAC);

      // Reconnecting is not a reason to send everything again. Only what has not finished is retried.
      expect(harness.scheduled).toHaveLength(1);
    });

    it('still sends a second file when neither of them says what it contains', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      // Two different screenshots, neither carrying a content hash - which is what a file admitted by
      // an older build looks like.
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      harness.files.set(idOf('shot-2'), screenshot('shot-2'));
      await harness.service.handleCapture(screenshot('shot-1'));
      await harness.scheduled[0]!.completed();

      await harness.service.handleCapture(screenshot('shot-2'));

      // The duplicate check is keyed on what the bytes ARE. Two files making no claim about their
      // content are not thereby the same file - reading "no hash" as a match would suppress the second
      // screenshot, and the user would watch one photo reach their Mac and never see the next.
      expect(harness.scheduled).toHaveLength(2);
      expect(harness.scheduled[1]!.file.syncId).toBe(idOf('shot-2'));
    });

    it('keeps a failed transfer for manual retry after reconnect', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));
      await harness.scheduled[0]!.failed(new Error('Connection lost'));

      await harness.service.connected(THE_MAC);

      expect(harness.scheduled).toHaveLength(1);
    });

    it('forgets a queued file that has since been deleted', async () => {
      const harness = await launch();
      harness.destinations[0]!.connected = false;
      // What happens when the far device is away is ONE setting for the whole policy, not something a rule
      // can say - so a user who wants screenshots queued and downloads dropped cannot have that.
      await harness.service.setOfflineBehavior('queue');
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));

      harness.files.delete(idOf('shot-1'));
      harness.destinations[0]!.connected = true;
      await harness.service.connected(THE_MAC);

      // The row named a file. Without the file there is nothing the row can ever do, and leaving it would
      // show the user something waiting to be sent that never can be.
      expect(harness.service.deliverySnapshot()).toEqual([]);
      expect(harness.scheduled).toEqual([]);
    });
  });

  describe('a transfer that failed', () => {
    async function failedHarness(): Promise<Harness> {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));
      await harness.scheduled[0]!.failed(new Error('Connection lost'));
      return harness;
    }

    it('says why, in the words the transfer gave', async () => {
      const harness = await failedHarness();

      expect(harness.service.deliverySnapshot()).toEqual([
        expect.objectContaining({
          transferStatus: 'failed',
          error: 'Connection lost',
        }),
      ]);
    });

    it('has a reason even when the failure came with no words', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));

      await harness.scheduled[0]!.failed(new Error(''));

      // A row that says a file failed and cannot say anything else is worse than one that admits it
      // plainly, so there is always something to read.
      expect(harness.service.deliverySnapshot()).toEqual([
        expect.objectContaining({ error: 'Could not share file.' }),
      ]);
    });

    it('can be sent again by hand', async () => {
      const harness = await failedHarness();

      await harness.service.retry(idOf('shot-1'), THE_MAC);

      expect(harness.scheduled).toHaveLength(2);
    });

    it('cannot be sent again when the file has gone', async () => {
      const harness = await failedHarness();
      harness.files.delete(idOf('shot-1'));

      await expect(harness.service.retry(idOf('shot-1'), THE_MAC)).rejects.toThrow(
        'This shared file is no longer available.',
      );
    });

    it('can be dismissed, leaving the consent in place', async () => {
      const harness = await failedHarness();

      await harness.service.dismissFailure(idOf('shot-1'), THE_MAC);

      // Dismissing the failure is not withdrawing consent. The rule still holds, so the next screenshot
      // still goes - and the row stops shouting about a transfer the user has decided not to chase.
      const [delivery] = harness.service.deliverySnapshot();
      expect(delivery).toMatchObject({ status: 'granted' });
      expect(delivery).not.toHaveProperty('transferStatus');
      expect(delivery).not.toHaveProperty('error');
    });

    it('ignores a dismissal for something that did not fail', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));

      await harness.service.dismissFailure(idOf('shot-1'), THE_MAC);
      await harness.service.dismissFailure(idOf('nothing-like-this'), THE_MAC);

      expect(harness.service.deliverySnapshot()).toEqual([
        expect.objectContaining({ transferStatus: 'sending' }),
      ]);
    });

    it('stops caring about the outcome once consent has been withdrawn', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));

      // The device is unpaired while its transfer is in flight, and the transfer then finishes.
      await harness.service.forgetDevice(THE_MAC);
      await harness.scheduled[0]!.completed();

      // Nothing comes back. Recording an outcome against a device the user has removed would put a row
      // back on a screen they had just cleared.
      expect(harness.service.deliverySnapshot()).toEqual([]);
    });
  });

  describe('sharing one file by hand', () => {
    it('sends it to each device the user picked', async () => {
      const harness = await launch();
      harness.destinations.push({
        deviceId: THE_IPAD,
        deviceName: "Mac's iPad",
        connected: true,
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));

      await harness.service.shareExplicit(screenshot('shot-1'), [
        THE_MAC,
        THE_IPAD,
      ]);

      // No rule involved. The user picked these devices for this file, which is consent for exactly this.
      expect(harness.scheduled.map(item => item.deviceId).sort()).toEqual([
        THE_IPAD,
        THE_MAC,
      ]);
    });

    it('says to pair something first when nothing was picked', async () => {
      const harness = await launch();

      // The message is the one thing to get right here: a person with no paired devices needs to be told
      // what to do, not that an operation failed.
      await expect(
        harness.service.shareExplicit(screenshot('shot-1'), ['a-device-that-is-not-paired']),
      ).rejects.toThrow('Pair a device before sharing a file.');
    });
  });

  describe('a rule that applies to every device', () => {
    it('covers a device the user pairs later', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: AMBIENT_SHARE_ANY_DESTINATION,
        mode: 'auto',
      });
      harness.destinations.push({
        deviceId: THE_IPAD,
        deviceName: "Mac's iPad",
        connected: true,
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));

      await harness.service.handleCapture(screenshot('shot-1'));

      expect(harness.scheduled.map(item => item.deviceId).sort()).toEqual([
        THE_IPAD,
        THE_MAC,
      ]);
    });

    it('does not override a rule the user set for one device in particular', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'ask',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));
      expect(harness.scheduled).toEqual([]);

      // The user then says screenshots go everywhere automatically. The Mac keeps its own rule, because a
      // choice made about one device in particular is more specific than a default - and the alternative
      // is a blanket setting silently sending files to a device the user had told it to ask about.
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: AMBIENT_SHARE_ANY_DESTINATION,
        mode: 'auto',
      });

      expect(harness.scheduled).toEqual([]);
      expect(harness.service.approvals().items).toHaveLength(1);
    });

    it('leaves a waiting file of a different kind alone', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'ask',
      });
      harness.files.set(
        'download-1',
        screenshot('download-1', { kind: 'download' }),
      );
      await harness.service.setRule({
        source: 'download',
        destinationId: THE_MAC,
        mode: 'ask',
      });
      await harness.service.handleCapture(
        screenshot('download-1', { kind: 'download' }),
      );

      // Turning screenshots on says nothing about downloads. A rule change must only settle the files it
      // is actually about.
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });

      expect(harness.scheduled).toEqual([]);
      expect(harness.service.deliverySnapshot()).toEqual([
        expect.objectContaining({ syncId: idOf('download-1'), status: 'prompt' }),
      ]);
    });
  });

  describe('what survives the app being closed', () => {
    it('brings back the rules, the queue and the answers', async () => {
      const first = await launch();
      await first.service.setOfflineBehavior('queue');
      await first.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'ask',
      });
      first.files.set(idOf('shot-1'), screenshot('shot-1'));
      first.files.set(idOf('shot-2'), screenshot('shot-2'));
      await first.service.handleCapture(screenshot('shot-1'));
      await first.service.handleCapture(screenshot('shot-2'));
      await first.service.acceptPrompt(idOf('shot-2'), THE_MAC);

      const second = await launch();
      second.files.set(idOf('shot-1'), screenshot('shot-1'));

      // A standing consent that did not survive a restart would be a setting the user has to re-enter,
      // and a pending question that did not would be a file silently forgotten.
      expect(second.service.snapshot().offlineBehavior).toBe('queue');
      // Setting one rule writes an explicit `off` row for every other source at the every-device slot, so
      // the shape of the policy is stable and a source with no rule is a decision rather than an absence.
      expect(
        second.service
          .snapshot()
          .rules.filter(rule => rule.mode !== 'off'),
      ).toEqual([
        expect.objectContaining({
          source: 'screenshot',
          destinationId: THE_MAC,
          mode: 'ask',
        }),
      ]);
      expect(second.service.approvals().items).toEqual([
        expect.objectContaining({ syncId: idOf('shot-1') }),
      ]);
      expect(second.service.allowsState(THE_MAC, idOf('shot-2'))).toBe(true);
      expect(second.service.approvalResultSnapshot()).toHaveLength(1);
    });

    it('answers nothing at all before Sync has handed it its dependencies', () => {
      jest.resetModules();
      const {
        ambientShareService,
      } = require('../../../pro/sync/ambientShareService');

      // The Sync screen can be rendered before Sync has started. Empty is the honest answer, and it is
      // better than a screen that cannot render at all.
      expect(ambientShareService.approvalFacts()).toEqual([]);
      expect(ambientShareService.activitySnapshot()).toEqual([]);
      expect(ambientShareService.approvals().items).toEqual([]);
    });
  });

  describe('the user unpairing a device', () => {
    it('takes its rules and its waiting files with it', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'ask',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));

      await harness.service.forgetDevice(THE_MAC);

      // A rule naming a device that is gone would come back to life if that device were ever paired
      // again - a standing consent the user granted to a relationship that no longer exists. What is left
      // is the every-device defaults, which are off and name nobody.
      expect(harness.service.snapshot().rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            destinationId: AMBIENT_SHARE_ANY_DESTINATION,
            mode: 'off',
          }),
        ]),
      );
      expect(
        harness.service.snapshot().rules.filter(rule => rule.mode !== 'off'),
      ).toEqual([]);
      expect(harness.service.deliverySnapshot()).toEqual([]);
      expect(harness.service.sourceActive('screenshot')).toBe(false);
    });

    it("leaves another device's rules and files alone", async () => {
      const harness = await launch();
      harness.destinations.push({
        deviceId: THE_IPAD,
        deviceName: "Mac's iPad",
        connected: true,
      });
      for (const destinationId of [THE_MAC, THE_IPAD]) {
        await harness.service.setRule({
          source: 'screenshot',
          destinationId,
          mode: 'ask',
        });
      }
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));

      await harness.service.forgetDevice(THE_MAC);

      expect(
        harness.service
          .snapshot()
          .rules.filter(rule => rule.mode !== 'off')
          .map(rule => rule.destinationId),
      ).toEqual([THE_IPAD]);
      expect(harness.service.deliverySnapshot()).toEqual([
        expect.objectContaining({ destinationId: THE_IPAD }),
      ]);
    });
  });

  describe('the edges of the record it keeps', () => {
    it('shows the most recently answered question first', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'ask',
      });
      for (const name of ['shot-a', 'shot-b']) {
        harness.files.set(idOf(name), screenshot(name));
        await harness.service.handleCapture(screenshot(name));
      }
      await harness.service.acceptPrompt(idOf('shot-a'), THE_MAC);
      // Answered a moment later, so "most recent" is a real difference and not two answers in the same
      // millisecond being ordered by chance.
      await new Promise(resolve => setTimeout(resolve, 2));
      await harness.service.rejectPrompt(idOf('shot-b'), THE_MAC);

      // Newest first, because this is a list the user glances at to check what just happened.
      const results = harness.service.approvalResultSnapshot();
      expect(results.map(result => result.approval.syncId)).toEqual([
        idOf('shot-b'),
        idOf('shot-a'),
      ]);
      expect(results[0]!.title).toBe('File kept on this device');
    });

    it('keeps the last hundred answers and lets the rest go', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'ask',
      });
      for (let index = 0; index < 105; index += 1) {
        const name = `bulk-${index}`;
        harness.files.set(idOf(name), screenshot(name));
        await harness.service.handleCapture(screenshot(name));
        await harness.service.rejectPrompt(idOf(name), THE_MAC);
      }

      // This list is written to storage on every answer, so it cannot grow without limit on a phone that
      // shares hundreds of files - and a hundred is already more history than anyone scrolls.
      expect(harness.service.approvalResultSnapshot()).toHaveLength(100);
    });

    it('refuses to share by hand before Sync has started', async () => {
      jest.resetModules();
      const {
        ambientShareService,
      } = require('../../../pro/sync/ambientShareService');

      // Tapping Share in the first second after launch. Told plainly to wait, rather than silently doing
      // nothing and leaving the user to wonder whether the file went.
      await expect(
        ambientShareService.shareExplicit(screenshot('shot-1'), [THE_MAC]),
      ).rejects.toThrow('Sync is not ready yet.');
    });

    it('leaves another device\'s waiting file alone when one device\'s rule changes', async () => {
      const harness = await launch();
      harness.destinations.push({
        deviceId: THE_IPAD,
        deviceName: "Mac's iPad",
        connected: true,
      });
      for (const destinationId of [THE_MAC, THE_IPAD]) {
        await harness.service.setRule({
          source: 'screenshot',
          destinationId,
          mode: 'ask',
        });
      }
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));
      expect(harness.service.deliverySnapshot()).toHaveLength(2);

      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });

      // One file, two devices, two separate questions. Answering the Mac's must not answer the iPad's -
      // they are consents to different devices and the user gave neither on behalf of the other.
      expect(harness.scheduled.map(item => item.deviceId)).toEqual([THE_MAC]);
      expect(harness.service.deliverySnapshot()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ destinationId: THE_IPAD, status: 'prompt' }),
        ]),
      );
    });
  });

  describe('what the screen is told', () => {
    it('is repainted once for a burst, not once per change', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'ask',
      });
      const before = harness.notifications();

      for (let index = 0; index < 20; index += 1) {
        harness.files.set(idOf(`shot-${index}`), screenshot(`shot-${index}`));
        await harness.service.handleCapture(screenshot(`shot-${index}`));
      }
      await harness.settled();

      // Twenty changes, and the screen is rebuilt a handful of times. Repainting per change is what made
      // one large transfer feel sluggish, and the projection is rebuilt on every repaint.
      expect(harness.notifications() - before).toBeLessThan(5);
      expect(harness.service.approvals().items).toHaveLength(20);
    });

    it('lists only what still wants the user, not what is already done', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      harness.files.set(idOf('shot-2'), screenshot('shot-2'));
      await harness.service.handleCapture(screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-2'));

      await harness.scheduled[0]!.completed();
      await harness.scheduled[1]!.failed(new Error('Connection lost'));

      // Activity is what needs a person: something waiting to be approved, something waiting for a device
      // to come back, something that failed. A file that arrived needs nothing, and listing it would bury
      // the rows that do.
      expect(harness.service.activitySnapshot()).toEqual([
        expect.objectContaining({
          syncId: idOf('shot-2'),
          transferStatus: 'failed',
          file: expect.objectContaining({ name: 'shot-2.png' }),
        }),
      ]);
    });

    it('does not list a voice note that is waiting to go', async () => {
      const harness = await launch();
      harness.destinations[0]!.connected = false;
      await harness.service.setOfflineBehavior('queue');
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      // A message attachment goes to every paired device with no rule to set - the catalogue says
      // `send: always` - so recording a voice note queues one delivery per device on its own.
      const note = screenshot('note-1', {
        kind: 'message_attachment',
        name: 'note-1.m4a',
        mimeType: 'audio/mp4',
      });
      harness.files.set(note.syncId, note);
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));

      await harness.service.handleCapture(note);
      await harness.service.handleCapture(screenshot('shot-1'));

      // Both are genuinely waiting for the Mac to come back.
      expect(
        harness.service.deliverySnapshot().map(delivery => delivery.status),
      ).toEqual(['queued', 'queued']);
      // Only one of them is the user's business. A voice note's home is its chat bubble, and the
      // catalogue hides that kind from Activity - so a person who records twenty notes on a train
      // does not come home to twenty "Pending" rows burying the screenshot that actually needs them.
      expect(
        harness.service.activitySnapshot().map(row => row.file.name),
      ).toEqual(['shot-1.png']);
    });
  });

  /**
   * Re-sending bytes to a device whose own copy has gone.
   *
   * A peer that has lost a file asks the devices that might still hold it. Answering is how a mesh
   * heals itself, but "may I send you these bytes again" is a consent question, not a plumbing one -
   * and this phone keeps its answer in two fields (an approval state and a transfer state) where the
   * Mac keeps one. Reading those two fields wrongly has both failure modes:
   *
   *  - too strict, and the phone refuses to heal a file it has already sent. The Mac healed it and the
   *    phone did not, on the same mesh, for the same file - which is the bug this rule was written for.
   *  - too loose, and a peer gets bytes the user never agreed to send by claiming to have lost them.
   *
   * The service runs for real, and every state below is arrived at the way the app arrives at it.
   */
  describe('healing a copy the far device lost', () => {
    async function autoRule(harness: Harness): Promise<void> {
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
    }

    it('refuses a file that was never offered to that device', async () => {
      const harness = await launch();

      // No delivery at all: this phone has no record of agreeing to send that peer anything. A repair
      // request is not a way to ask for a file the user never shared.
      expect(harness.service.allowsRepair(THE_MAC, idOf('shot-1'))).toBe(false);
    });

    it('refuses a file still waiting for the user to say yes', async () => {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'ask',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));
      expect(harness.service.deliverySnapshot()).toEqual([
        expect.objectContaining({ status: 'prompt' }),
      ]);

      // The sheet is still up. Healing here would hand over a file on a peer's word, before the person
      // whose file it is had answered - and they might have been about to say no.
      expect(harness.service.allowsRepair(THE_MAC, idOf('shot-1'))).toBe(false);
    });

    it('refuses a file that is only queued for a device that is away', async () => {
      const harness = await launch();
      harness.destinations[0]!.connected = false;
      await harness.service.setOfflineBehavior('queue');
      await autoRule(harness);
      await harness.service.handleCapture(screenshot('shot-1'));
      expect(harness.service.deliverySnapshot()).toEqual([
        expect.objectContaining({ status: 'queued' }),
      ]);

      // Consent exists, but no bytes have ever left. There is nothing there to have gone missing, so
      // this is a first send pretending to be a repair.
      expect(harness.service.allowsRepair(THE_MAC, idOf('shot-1'))).toBe(false);
    });

    it('allows a file whose transfer is still running', async () => {
      const harness = await launch();
      await autoRule(harness);

      await harness.service.handleCapture(screenshot('shot-1'));

      // Mid-flight, which is exactly when a peer notices a half-written file and asks again. Refusing
      // now leaves the far device holding a partial file with no way to complete it.
      expect(harness.service.deliverySnapshot()).toEqual([
        expect.objectContaining({ transferStatus: 'sending' }),
      ]);
      expect(harness.service.allowsRepair(THE_MAC, idOf('shot-1'))).toBe(true);
    });

    it('allows a file it has already finished sending', async () => {
      const harness = await launch();
      await autoRule(harness);
      await harness.service.handleCapture(screenshot('shot-1'));

      await harness.scheduled[0]!.completed();

      // The one that matters. A finished delivery is precisely what a peer asks to repair when its own
      // copy has gone, and this phone used to refuse while the Mac obliged - so the same file healed on
      // one device and stayed missing on the other.
      expect(harness.service.allowsRepair(THE_MAC, idOf('shot-1'))).toBe(true);
    });

    it('allows a file whose transfer failed', async () => {
      const harness = await launch();
      await autoRule(harness);
      await harness.service.handleCapture(screenshot('shot-1'));

      await harness.scheduled[0]!.failed(new Error('Connection lost'));

      // A failure is a file the far device may be holding half of. Consent was given and the bytes
      // started moving; asking again is the repair working as intended.
      expect(harness.service.allowsRepair(THE_MAC, idOf('shot-1'))).toBe(true);
    });

    it('allows a file it never sent because the device already had those bytes', async () => {
      const harness = await launch();
      const hash =
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'auto',
      });
      const first = screenshot('shot-1', { contentHash: hash });
      // The same picture, re-minted under a second id - the shape that makes the sender skip a send.
      const again = screenshot('shot-2', { contentHash: hash });
      harness.files.set(first.syncId, first);
      harness.files.set(again.syncId, again);
      await harness.service.handleCapture(first);
      await harness.scheduled[0]!.completed();

      await harness.service.handleCapture(again);

      // Nothing was sent for the second record, because those bytes are already there.
      expect(harness.scheduled).toHaveLength(1);
      // And it is still repairable. The peer HAS these bytes on this phone's own reckoning, so when it
      // loses them, "I never sent you that" would be the phone contradicting itself.
      expect(harness.service.allowsRepair(THE_MAC, again.syncId)).toBe(true);
    });
  });

  describe('the question the sheet puts to the user', () => {
    async function pendingQuestion(): Promise<Harness> {
      const harness = await launch();
      await harness.service.setRule({
        source: 'screenshot',
        destinationId: THE_MAC,
        mode: 'ask',
      });
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      await harness.service.handleCapture(screenshot('shot-1'));
      return harness;
    }

    it('still names the device when the roster has not loaded it yet', async () => {
      const harness = await pendingQuestion();

      // Deliveries come back from storage before the mesh roster does, so early in a launch the
      // destination id is all there is to go on.
      harness.destinations.length = 0;

      // The user is being asked to make a decision about a device, so the sentence has to name one.
      // An empty name reads as "Share shot-1.png with ?" - a question nobody can answer.
      expect(harness.service.approvals().items).toEqual([
        expect.objectContaining({
          deviceId: THE_MAC,
          title: 'shot-1.png with Paired device',
        }),
      ]);
    });

    it('drops a question about a file that has since gone, and asks again if it comes back', async () => {
      const harness = await pendingQuestion();

      harness.files.delete(idOf('shot-1'));

      // Approving this would send nothing, so putting it in front of the user is asking them to decide
      // something that has already been decided for them.
      expect(harness.service.approvals().items).toEqual([]);
      // The consent row itself stays: the question is derived from what exists right now, not deleted
      // the first time a file is briefly unreadable. Put the file back and the user is asked again.
      harness.files.set(idOf('shot-1'), screenshot('shot-1'));
      expect(harness.service.approvals().items).toHaveLength(1);
    });
  });
});
