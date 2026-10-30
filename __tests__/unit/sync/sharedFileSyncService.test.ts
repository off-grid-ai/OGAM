import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createSharedFileStateFields,
  createSharedFileTransferMetadata,
  MAX_SHARED_FILE_BYTES,
} from '@offgrid/sync';
import type { SyncMutation } from '@offgrid/core/services/sync/mutation';

// The service reaches Sync, which reaches the sockets and the discovery service. Those are the device,
// so they are stood in for - and nothing is ever started on them here, because a phone with no peers
// connected is the state it is in most of the time.
jest.mock('react-native-tcp-socket', () => {
  const {
    createNativeTcpBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

jest.mock('react-native-fs', () => {
  const {
    modelTransferFsBoundary: boundary,
  } = require('../../utils/modelTransferFsBoundary');
  return { __esModule: true, default: boundary.module, ...boundary.module };
});

/**
 * Which of this phone's files exist to be shared at all.
 *
 * Before anything can be sent to another device it has to be ADMITTED: given a stable identity, written
 * into the shared-file record, and announced to the rest of the mesh as something that exists here. That
 * is a quiet job with loud failure modes.
 *
 * Admitting too eagerly puts a row on the user's other devices for a file this one cannot actually serve.
 * Admitting the same file twice gives one picture two identities and two rows. Failing to notice a file
 * the user DELETED leaves it listed on every other device they own, and a person who deletes a photo
 * means it. And admitting something enormous commits the phone to a transfer that cannot finish.
 *
 * The service, its store, its library projection and the ambient-share policy all run for real. The
 * filesystem stands in, and there are no peers connected - which is not a gap but the state a phone is in
 * most of the time.
 */
describe('the files this phone offers the rest of the mesh', () => {
  const IMAGE_ID = '11111111-1111-4111-8111-111111111111';
  const OTHER_IMAGE_ID = '22222222-2222-4222-8222-222222222222';
  const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
  const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
  const ATTACHMENT_ID = '55555555-5555-4555-8555-555555555555';

  let mutations: SyncMutation[];
  let service: typeof import('../../../pro/sync/sharedFileSyncService').sharedFileSyncService;
  /**
   * The stores as the SERVICE sees them.
   *
   * A launch is modelled by reloading the module graph, and the service subscribes to the stores in its
   * own graph - so a test that seeded the top-level import would be writing to a store nothing reads.
   * These are bound from the same load as the service, every time.
   */
  let useAppStore: typeof import('../../../src/stores/appStore').useAppStore;
  let useChatStore: typeof import('../../../src/stores/chatStore').useChatStore;
  let fs: typeof import('react-native-fs').default;
  let useSyncStore: typeof import('../../../pro/sync/syncStore').useSyncStore;
  /** The phone's disk, which outlives a launch - so it is replayed into each fresh module graph. */
  let disk: Array<{ path: string; bytes: number }>;

  const PREFERENCES = {
    chats: true,
    projects: true,
    settings: true,
    notes: true,
    screenshots: false,
    downloads: false,
    generatedMedia: false,
    attachments: false,
  };

  /**
   * Let a scan finish.
   *
   * Scanning is triggered by the stores themselves - the service subscribes to them - so a test changes
   * the store and waits, exactly as the app does. There is no test-only way in.
   */
  const settle = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 60));
  };

  /** A picture the user generated, on disk where the app put it. */
  async function generatedImageOnDisk(
    id: string,
    bytes = 2048,
    conversationId?: string,
  ): Promise<void> {
    const path = `/docs/generated/${id}.png`;
    await write(path, bytes);
    useAppStore.setState({
      generatedImages: [
        ...useAppStore.getState().generatedImages,
        {
          id,
          imagePath: path,
          prompt: 'a lighthouse',
          negativePrompt: null,
          steps: 20,
          seed: 7,
          modelId: 'off-grid/image',
          width: 512,
          height: 512,
          createdAt: '2026-08-04T09:00:00.000Z',
          ...(conversationId ? { conversationId } : {}),
        },
      ],
    } as never);
  }

  /** A photo the user attached to a message, on disk where the picker put it. */
  async function attachmentOnDisk(): Promise<void> {
    const path = `/docs/attachments/${ATTACHMENT_ID}.jpg`;
    await write(path, 4096);
    useChatStore.setState({
      conversations: [
        {
          id: CONVERSATION_ID,
          title: 'A chat with a photo',
          messages: [
            {
              id: 'local-1',
              uuid: MESSAGE_ID,
              role: 'user',
              content: 'look at this',
              timestamp: 1_700_000_000_000,
              attachments: [
                {
                  id: ATTACHMENT_ID,
                  type: 'image',
                  uri: `file://${path}`,
                  mimeType: 'image/jpeg',
                  fileName: 'lighthouse.jpg',
                },
              ],
            },
          ],
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
      ],
    } as never);
  }

  const putIds = (): string[] =>
    mutations
      .filter(mutation => mutation.kind === 'put')
      .map(mutation => mutation.entityId);

  const deletedIds = (): string[] =>
    mutations
      .filter(mutation => mutation.kind === 'delete')
      .map(mutation => mutation.entityId);

  /**
   * A launch. The service is a singleton that loads its store once, so reloading the module is how a
   * second launch is modelled - which is also what lets a test show what survived one.
   */
  function loadModuleGraph(): void {
    jest.resetModules();
    fs = require('react-native-fs').default;
    useSyncStore = require('../../../pro/sync/syncStore').useSyncStore;
    useAppStore = require('../../../src/stores/appStore').useAppStore;
    useChatStore = require('../../../src/stores/chatStore').useChatStore;
    service =
      require('../../../pro/sync/sharedFileSyncService').sharedFileSyncService;
  }

  async function write(path: string, bytes: number): Promise<void> {
    disk.push({ path, bytes });
    await fs.writeFile(
      path,
      Buffer.alloc(bytes, 0x41).toString('base64'),
      'base64',
    );
  }

  async function launch(): Promise<void> {
    mutations = [];
    // The library list is written from this device's point of view - whose file is whose - so it needs to
    // know which device it is. Sync sets this when it starts; here it is stated directly.
    useSyncStore.setState({
      thisDevice: {
        id: 'fp-this-phone',
        name: "Mac's iPhone",
        platform: 'ios',
        version: '1',
        host: '127.0.0.1',
        port: 7777,
      },
    } as never);
    await service.start({
      stageStateMutation: (mutation: SyncMutation) => {
        mutations.push(mutation);
      },
      recordStateMutation: (mutation: SyncMutation) => {
        mutations.push(mutation);
      },
    });
  }

  /** Close the app and open it again, keeping what the user would still have: their gallery and chats. */
  async function relaunch(): Promise<void> {
    const generatedImages = useAppStore.getState().generatedImages;
    const conversations = useChatStore.getState().conversations;
    const onDisk = [...disk];
    loadModuleGraph();
    disk = [];
    for (const file of onDisk) await write(file.path, file.bytes);
    useAppStore.setState({ generatedImages } as never);
    useChatStore.setState({ conversations } as never);
    await launch();
  }

  beforeEach(async () => {
    await AsyncStorage.clear();
    loadModuleGraph();
    disk = [];
    useAppStore.setState({ generatedImages: [] } as never);
    useChatStore.setState({ conversations: [] } as never);
  });

  describe('a picture the user generated', () => {
    it('is admitted once, and told to the rest of the mesh', async () => {
      await generatedImageOnDisk(IMAGE_ID);

      await launch();

      // One announcement, carrying everything another device needs to decide whether to ask for it: what
      // it is, what it is called, how big it is, and when it was made.
      expect(putIds()).toEqual([IMAGE_ID]);
      expect(
        mutations.find(mutation => mutation.entityId === IMAGE_ID)?.fields,
      ).toEqual({
        kind: 'generated_media',
        name: `${IMAGE_ID}.png`,
        // Snake case on the wire, because the same record is read by the Mac and by Android. And no local
        // path anywhere in it: where the file sits on this phone is meaningless on another device, and
        // sending it would leak this device's directory layout for nothing.
        mime_type: 'image/png',
        file_size: 2048,
        created_at: '2026-08-04T09:00:00.000Z',
        width: 512,
        height: 512,
        metadata_json: expect.stringContaining('lighthouse'),
        // What the bytes ARE, which the record id cannot say: a re-mint gives the same picture a new
        // id, so a peer keyed only on the id cannot see an echo of a file it already holds. Matched as
        // a sha256 rather than a literal, because pinning the fixture's digest would make an unrelated
        // change to the sample bytes look like a wire-format regression.
        content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    });

    it('is not put in the transferred-files list just for existing', async () => {
      await generatedImageOnDisk(IMAGE_ID);

      await launch();

      // That list is about files that MOVED - received from another device, or sent from this one. A local
      // picture that has never gone anywhere belongs to the gallery, and showing it here would turn a
      // transfer list into a second copy of the photo library.
      expect(service.files()).toEqual([]);
    });

    it('waits for its durable message identity before it enters the mesh', async () => {
      await generatedImageOnDisk(IMAGE_ID, 2048, CONVERSATION_ID);
      await launch();
      await service.stateReady(PREFERENCES);

      // The gallery store is written before the chat message at image completion. Publishing in this
      // gap produces a gallery-only control that cannot put the received bytes back into the bubble.
      expect(putIds()).toEqual([]);

      useChatStore.setState({
        conversations: [
          {
            id: CONVERSATION_ID,
            title: 'A generated picture',
            messages: [
              {
                id: 'local-generated',
                uuid: MESSAGE_ID,
                role: 'assistant',
                content: 'Generated image for: "a lighthouse"',
                timestamp: 1_700_000_000_000,
                attachments: [
                  {
                    id: IMAGE_ID,
                    type: 'image',
                    uri: `file:///docs/generated/${IMAGE_ID}.png`,
                  },
                ],
              },
            ],
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
          },
        ],
      } as never);
      await settle();

      expect(putIds()).toEqual([IMAGE_ID]);
      expect(
        mutations.find(mutation => mutation.entityId === IMAGE_ID)?.fields,
      ).toMatchObject({
        kind: 'generated_media',
        conversation_id: CONVERSATION_ID,
        message_id: MESSAGE_ID,
      });
    });

    it('is not admitted twice when the app is opened again', async () => {
      await generatedImageOnDisk(IMAGE_ID);
      await launch();

      await relaunch();

      // The store survives the launch, so the second one has nothing to admit. Announcing again would put
      // a second row on every other device for one picture.
      expect(putIds()).toEqual([]);
    });

    it('is ignored when its file is not there', async () => {
      useAppStore.setState({
        generatedImages: [
          {
            id: IMAGE_ID,
            imagePath: '/docs/generated/gone.png',
            prompt: 'a lighthouse',
            steps: 20,
            seed: 7,
            modelId: 'off-grid/image',
            createdAt: '2026-08-04T09:00:00.000Z',
          },
        ],
      } as never);

      await launch();

      // The record exists in the gallery and the bytes do not. Announcing it would offer the user's other
      // devices a file this one cannot serve, and the transfer could only ever fail.
      expect(putIds()).toEqual([]);
    });

    it('is ignored when it is too big to move', async () => {
      const path = `/docs/generated/${IMAGE_ID}.png`;
      await write(path, 0);
      // Reported by the platform as larger than the transfer limit, without allocating it here.
      const stat = fs.stat as unknown as jest.Mock;
      const real = stat.getMockImplementation()!;
      stat.mockImplementation(async (target: string) => {
        const value = await real(target);
        return target === path
          ? { ...value, size: MAX_SHARED_FILE_BYTES + 1 }
          : value;
      });
      await generatedImageOnDisk(IMAGE_ID, 0);

      try {
        await launch();
      } finally {
        stat.mockImplementation(real);
      }

      // The cap is the protocol's, so refusing here is the same answer the receiving side would give -
      // and refusing before announcing means the user is never shown a file that cannot arrive.
      expect(putIds()).toEqual([]);
    });

    it('is ignored when the platform reports it as empty', async () => {
      await generatedImageOnDisk(IMAGE_ID, 0);

      await launch();

      // A zero-byte file is a write that has not finished, or one that failed. Sending it would replace a
      // real picture on the far device with nothing.
      expect(putIds()).toEqual([]);
    });
  });

  describe('a photo attached to a message', () => {
    it('is admitted with the message it belongs to', async () => {
      await attachmentOnDisk();

      await launch();

      // The conversation and message are carried with it: on the far device the photo has to land back in
      // the message it was attached to, not in a pile of loose files. And the name is the one the user
      // sees, not the identifier the picker gave the file on disk.
      expect(putIds()).toEqual([ATTACHMENT_ID]);
      expect(
        mutations.find(mutation => mutation.entityId === ATTACHMENT_ID)?.fields,
      ).toMatchObject({
        kind: 'message_attachment',
        name: 'lighthouse.jpg',
        conversation_id: CONVERSATION_ID,
        message_id: MESSAGE_ID,
        mime_type: 'image/jpeg',
      });
    });

    it('is skipped while its message has no durable identity yet', async () => {
      await attachmentOnDisk();
      useChatStore.setState({
        conversations: useChatStore
          .getState()
          .conversations.map(conversation => ({
            ...conversation,
            messages: conversation.messages.map(message => ({
              ...message,
              uuid: undefined,
            })),
          })),
      } as never);

      await launch();

      // A message with no shared identity cannot be named on another device, so an attachment announced
      // now would arrive with nowhere to go. It is admitted on a later scan, once the message has one.
      expect(putIds()).toEqual([]);
    });
  });

  describe('a file the user deletes', () => {
    it('is withdrawn from the mesh, once', async () => {
      await generatedImageOnDisk(IMAGE_ID);
      await generatedImageOnDisk(OTHER_IMAGE_ID);
      await launch();
      // Only once state has replayed does an absence mean a deletion rather than "not loaded yet", and
      // stateReady is what says so.
      await service.stateReady(PREFERENCES);
      await settle();
      mutations = [];

      useAppStore.setState({
        generatedImages: useAppStore
          .getState()
          .generatedImages.filter(image => image.id !== IMAGE_ID),
      } as never);
      await settle();

      expect(deletedIds()).toEqual([IMAGE_ID]);

      // Asked again, and it is not withdrawn twice: the withdrawal is already travelling, and a second
      // one would be a delete for a record the far device has already dropped.
      mutations = [];
      useAppStore.setState({
        generatedImages: [...useAppStore.getState().generatedImages],
      } as never);
      await settle();
      expect(deletedIds()).toEqual([]);
    });

    it('is left alone before state has replayed', async () => {
      await generatedImageOnDisk(IMAGE_ID);
      await launch();
      mutations = [];

      useAppStore.setState({ generatedImages: [] } as never);
      await settle();

      // This is the dangerous case: the stores rehydrate asynchronously, so early in a launch EVERY file
      // looks deleted. Withdrawing on that would wipe the user's shared files off all their devices.
      expect(deletedIds()).toEqual([]);
    });

    it('is withdrawn when the user asks for it directly', async () => {
      await generatedImageOnDisk(IMAGE_ID);
      await launch();
      mutations = [];

      service.delete(IMAGE_ID);

      expect(deletedIds()).toEqual([IMAGE_ID]);
    });

    it('is not withdrawn when there was nothing to withdraw', async () => {
      await launch();

      service.delete('66666666-6666-4666-8666-666666666666');

      // A delete for a file this device never had would tell the other devices to drop a record on this
      // device's authority - authority it does not have, having never held the file.
      expect(deletedIds()).toEqual([]);
    });
  });

  describe('what the screen is told', () => {
    it('is told when the list changes, and unsubscribes cleanly', async () => {
      await launch();
      let changes = 0;
      const stop = service.onFilesChanged(() => {
        changes += 1;
      });

      await generatedImageOnDisk(IMAGE_ID);
      await settle();
      expect(changes).toBeGreaterThan(0);

      stop();
      const after = changes;
      await generatedImageOnDisk(OTHER_IMAGE_ID);
      await settle();

      expect(changes).toBe(after);
    });
  });

  describe('a file arriving from another device', () => {
    const ARRIVING_ID = '77777777-7777-4777-8777-777777777777';

    it('waits for the bytes when only the record has arrived', async () => {
      await launch();

      service.applyControlPut(ARRIVING_ID, ARRIVING_RECORD, FROM_THE_MAC);
      await settle();

      // A received record is not one of this phone's active outgoing controls.
      expect(service.files()).toEqual([]);
      expect(service.canPublishControl('the-ipad', ARRIVING_ID)).toBe(false);
    });

    /**
     * The bytes, staged exactly where the transfer sink leaves them.
     *
     * Not a shortcut past the transfer: this IS the boundary a completed transfer hands over - a metadata
     * file and the payload beside it, under the staging root. Everything after it (does the description
     * match, where does the file belong, what is it hashed as) is the real code under test.
     */
    async function bytesStagedFor(control: {
      syncId: string;
      kind: string;
      name: string;
      mimeType: string;
      fileSize: number;
      createdAt: string;
    }): Promise<void> {
      const directory = `/caches/sync-shared-files/${encodeURIComponent(
        control.syncId,
      )}`;
      await fs.mkdir(directory);
      // Built by the SENDER's own builder, not hand-rolled here: the envelope carries a type and a
      // version the receiver checks, and a literal in a test would drift from them silently.
      await fs.writeFile(
        `${directory}/metadata.json`,
        JSON.stringify(createSharedFileTransferMetadata(control as never)),
        'utf8',
      );
      await write(`${directory}/${control.name}`, control.fileSize);
    }

    /**
     * The file as the far device describes it.
     *
     * Turned into BOTH shapes by the producers the app uses - `createSharedFileStateFields` for the
     * record on the wire (snake_case) and `createSharedFileTransferMetadata` for the envelope beside the
     * bytes (camelCase). Written by hand, the two drift, and the control parser rejects an unknown key
     * outright: a camelCase `mimeType` makes the whole control parse as null, so nothing happens at all
     * and a test asserting "no file yet" passes for the wrong reason.
     */
    const ARRIVING = {
      syncId: ARRIVING_ID,
      kind: 'generated_media' as const,
      name: 'from-the-mac.png',
      mimeType: 'image/png',
      fileSize: 1024,
      createdAt: '2026-08-04T09:00:00.000Z',
    };
    const ARRIVING_RECORD = createSharedFileStateFields(ARRIVING as never);

    /** Where an imported shared file lands. Composed the way the importer composes it. */
    const IMPORTED_PATH = `/docs/shared_files/${ARRIVING.kind}/${ARRIVING_ID}-${ARRIVING.name}`;

    const FROM_THE_MAC = {
      originDeviceId: 'fp-the-mac',
      originDeviceName: 'Off Grid AI Desktop',
    };

    it('is imported, and becomes a file this phone actually holds', async () => {
      await launch();
      await bytesStagedFor(ARRIVING);

      service.applyControlPut(ARRIVING_ID, ARRIVING_RECORD, FROM_THE_MAC);
      await settle();

      // The record is the phone's now: listed as a transferred file, owned by the device that sent it,
      // and sitting under this app's own storage rather than in the staging area it arrived in.
      const [file] = service.files();
      expect(file?.syncId).toBe(ARRIVING_ID);
      expect(file?.name).toBe(ARRIVING.name);
      expect(file?.localPath).toBe(IMPORTED_PATH);
      expect(file?.provenance?.originDeviceId).toBe(
        FROM_THE_MAC.originDeviceId,
      );
      // AVAILABLE, which is a different claim from "a record exists": the bytes are here, so this phone
      // can serve them back to a peer whose copy went missing.
      expect(file?.available).toBe(true);
      expect(await fs.exists(IMPORTED_PATH)).toBe(true);
      // Stamped with what the bytes ARE. The record id is re-minted on identity churn; this is not.
      expect(file?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('re-homes a peer image when the durable winner corrects attachment to generated media', async () => {
      const name = 'corrected-image.png';
      const attachment = {
        syncId: ARRIVING_ID,
        kind: 'message_attachment' as const,
        name,
        mimeType: 'image/jpeg',
        fileSize: 1024,
        createdAt: '2026-08-04T09:00:00.000Z',
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
      };
      const generated = {
        ...attachment,
        kind: 'generated_media' as const,
        mimeType: 'image/png',
        metadataJson: JSON.stringify({ prompt: 'a corrected image' }),
      };
      const oldPath = `/docs/shared_files/message_attachment/${ARRIVING_ID}-${name}`;
      const newPath = `/docs/shared_files/generated_media/${ARRIVING_ID}-${name}`;
      useChatStore.setState({
        conversations: [
          {
            id: CONVERSATION_ID,
            title: 'Image from the Mac',
            messages: [
              {
                id: 'local-message',
                uuid: MESSAGE_ID,
                role: 'assistant',
                content: 'Generated image',
                timestamp: 1_700_000_000_000,
                attachments: [],
              },
            ],
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
          },
        ],
      } as never);
      await launch();
      await bytesStagedFor(attachment);
      service.applyControlPut(
        ARRIVING_ID,
        createSharedFileStateFields(attachment),
        FROM_THE_MAC,
      );
      await settle();
      expect(await fs.exists(oldPath)).toBe(true);

      const durableFields = createSharedFileStateFields(generated);
      service.setDurableControlLog({
        fields: syncId => (syncId === ARRIVING_ID ? durableFields : undefined),
        entityIds: () => [ARRIVING_ID],
      });
      await settle();

      expect(service.files()[0]).toMatchObject({
        syncId: ARRIVING_ID,
        kind: 'generated_media',
        localPath: newPath,
        provenance: FROM_THE_MAC,
      });
      expect(await fs.exists(newPath)).toBe(true);
      expect(await fs.exists(oldPath)).toBe(false);

      mutations = [];
      await service.stateReady(PREFERENCES);
      await settle();
      expect(putIds()).not.toContain(ARRIVING_ID);
    });

    it('is deleted from this phone, bytes included, when the far device withdraws it', async () => {
      await launch();
      await bytesStagedFor(ARRIVING);
      service.applyControlPut(ARRIVING_ID, ARRIVING_RECORD, FROM_THE_MAC);
      await settle();
      // Precondition, so the removal below is an observed transition rather than an always-true.
      expect(service.files()).toHaveLength(1);
      expect(await fs.exists(IMPORTED_PATH)).toBe(true);

      service.applyControlDelete(ARRIVING_ID);
      await settle();

      // A person who deletes a file means it, on every device. The row goes AND the bytes go - leaving
      // the file behind would keep the storage this phone is holding for a record nobody can see.
      expect(service.files()).toEqual([]);
      expect(await fs.exists(IMPORTED_PATH)).toBe(false);
    });

    it('is not imported at all when the bytes are described differently', async () => {
      await launch();
      // Same file, but the staged envelope says it is bigger than the record claims.
      await bytesStagedFor({ ...ARRIVING, fileSize: 2048 });

      service.applyControlPut(ARRIVING_ID, ARRIVING_RECORD, FROM_THE_MAC);
      await settle();

      // Identity has to agree before anything is written into the library. These are the last bytes that
      // can be checked against the description, so a disagreement discards them rather than importing a
      // file under a record that does not describe it.
      expect(service.files()).toEqual([]);
      expect(await fs.exists(IMPORTED_PATH)).toBe(false);
    });

    /**
     * The same picture, offered again under a fresh record id.
     *
     * Identities are re-minted - a device repairs its install, a record is re-admitted - and the file
     * itself does not change when that happens. So an arriving record has to be recognised by what its
     * bytes ARE, not by the id it wears, or one download becomes a pile of identical files each
     * re-offered to every other device.
     */
    it('is not imported again when the same bytes arrive under a new id', async () => {
      const REMINTED_ID = '88888888-8888-4888-8888-888888888888';
      await launch();
      await bytesStagedFor(ARRIVING);
      service.applyControlPut(ARRIVING_ID, ARRIVING_RECORD, FROM_THE_MAC);
      await settle();
      const contentHash = service.files()[0]?.contentHash;
      expect(contentHash).toMatch(/^[0-9a-f]{64}$/);

      // The far device now describes the same file under a new id, and sends the bytes again.
      const REMINTED = { ...ARRIVING, syncId: REMINTED_ID, contentHash };
      await bytesStagedFor(REMINTED);
      service.applyControlPut(
        REMINTED_ID,
        createSharedFileStateFields(REMINTED as never),
        FROM_THE_MAC,
      );
      await settle();

      // One file, still the one already here. A second row would show the user the same picture twice,
      // and this phone would then offer both of them on to every other device it is paired with.
      expect(service.files().map(file => file.syncId)).toEqual([ARRIVING_ID]);
      expect(
        await fs.exists(
          `/docs/shared_files/${ARRIVING.kind}/${REMINTED_ID}-${ARRIVING.name}`,
        ),
      ).toBe(false);
      // And the bytes that came with it are dropped rather than left in the staging area, which would
      // hold storage for a copy nothing will ever read.
      expect(
        await fs.exists(
          `/caches/sync-shared-files/${REMINTED_ID}/${ARRIVING.name}`,
        ),
      ).toBe(false);
    });

    /** Make the platform refuse to hash one path, without touching any other file. */
    function hashingFailsFor(path: string): () => void {
      const hash = fs.hash as unknown as jest.Mock;
      const real = hash.getMockImplementation()!;
      hash.mockImplementation(async (target: string, algorithm: string) => {
        if (target === path) throw new Error('Could not read the file');
        return real(target, algorithm);
      });
      return () => hash.mockImplementation(real);
    }

    it('still arrives when the phone cannot hash it', async () => {
      await launch();
      await bytesStagedFor(ARRIVING);
      const restore = hashingFailsFor(IMPORTED_PATH);

      try {
        service.applyControlPut(ARRIVING_ID, ARRIVING_RECORD, FROM_THE_MAC);
        await settle();
      } finally {
        restore();
      }

      // The hash is how duplicates are spotted later; it is not what makes the file usable now. A file
      // the user can open, with no content claim on it, is the right outcome - refusing the import over
      // a failed digest would lose a file that arrived perfectly well.
      const [file] = service.files();
      expect(file?.localPath).toBe(IMPORTED_PATH);
      expect(await fs.exists(IMPORTED_PATH)).toBe(true);
      expect(file?.contentHash).toBeUndefined();
    });

    it('is hashed on the next launch, and then recognises its own bytes coming back', async () => {
      const REMINTED_ID = '99999999-9999-4999-8999-999999999999';
      await launch();
      await bytesStagedFor(ARRIVING);
      const restore = hashingFailsFor(IMPORTED_PATH);
      try {
        service.applyControlPut(ARRIVING_ID, ARRIVING_RECORD, FROM_THE_MAC);
        await settle();
      } finally {
        restore();
      }
      expect(service.files()[0]?.contentHash).toBeUndefined();

      // The imported file is on the phone's disk now, and disk outlives a launch.
      disk.push({ path: IMPORTED_PATH, bytes: ARRIVING.fileSize });
      await relaunch();
      // Only once state has replayed does the library mean anything, so that is when it is repaired.
      await service.stateReady(PREFERENCES);
      await settle();

      // Stamped from the bytes this device actually holds. This is what repairs a library admitted
      // before the field existed, or by a launch where hashing failed.
      const contentHash = service.files()[0]?.contentHash;
      expect(contentHash).toMatch(/^[0-9a-f]{64}$/);

      // And the point of stamping it: the guard now works for the file that was already here. Without
      // the backfill a record making no content claim cannot recognise an echo of itself, so the same
      // download lands again on every identity change.
      const REMINTED = { ...ARRIVING, syncId: REMINTED_ID, contentHash };
      await bytesStagedFor(REMINTED);
      service.applyControlPut(
        REMINTED_ID,
        createSharedFileStateFields(REMINTED as never),
        FROM_THE_MAC,
      );
      await settle();

      expect(service.files().map(file => file.syncId)).toEqual([ARRIVING_ID]);
    });

    it('is left unhashed when its bytes are no longer on the phone', async () => {
      await launch();
      await bytesStagedFor(ARRIVING);
      const restore = hashingFailsFor(IMPORTED_PATH);
      try {
        service.applyControlPut(ARRIVING_ID, ARRIVING_RECORD, FROM_THE_MAC);
        await settle();
      } finally {
        restore();
      }

      // Relaunched without replaying the imported file: the bytes are gone, the record is not.
      await relaunch();
      await service.stateReady(PREFERENCES);
      await settle();

      // Nothing to hash, so nothing is claimed. Stamping a record whose file has gone would give the
      // duplicate guard a content claim this device cannot serve, and the phone would then refuse the
      // very copy a peer could have used to heal it.
      const [file] = service.files();
      expect(file?.syncId).toBe(ARRIVING_ID);
      expect(file?.contentHash).toBeUndefined();
      expect(file?.available).toBe(false);
    });

    it('stops waiting when the record is withdrawn again', async () => {
      await launch();
      service.applyControlPut(ARRIVING_ID, ARRIVING_RECORD, FROM_THE_MAC);
      await settle();

      service.applyControlDelete(ARRIVING_ID);
      await settle();

      // Deleted on the far device before its bytes ever got here. Nothing is left waiting for a transfer
      // that will never be asked for.
      expect(service.files()).toEqual([]);
    });
  });
});
