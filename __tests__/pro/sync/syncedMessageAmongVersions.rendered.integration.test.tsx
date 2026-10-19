/**
 * A message synced from another device keeps its place among a chat's versions.
 *
 * Pro 4b7c60f8 (mobileStateMaterializer): a message's parent and chosen-version time travel in its
 * synced context. Before, the phone dropped them on receipt, so a Desktop turn that followed the
 * second version of an answer landed with no parent - an orphan that showed on every branch, or on
 * none.
 *
 * SPEC (OGAM user's view): I retried an answer on my phone, so it has two versions and I am reading
 * the second. I carry on from my Desktop. On the phone, the Desktop's turn shows after the version it
 * followed, once. Stepping back to the first version shows the first branch without the Desktop turn;
 * stepping forward brings both back.
 *
 * The real App on the real navigation stack; the versions are made by a real Retry from the action
 * menu over the llama.rn fake. The Desktop is the paired-peer op injector (proHarness): a real shared
 * sync engine on the in-memory TCP boundary that learns the chat from the phone over the wire and
 * appends to it the way a Desktop does - naming, as parent, the message it followed.
 */
import type { LicensedMesh } from '../../harness/licensedMesh';

jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: require('../../utils/nativeSyncBoundaries').createNativeTcpBoundary(),
}));
jest.mock('react-native-zeroconf', () => ({
  __esModule: true,
  default: require('../../utils/nativeSyncBoundaries').createNativeDiscoveryBoundary(),
}));
jest.mock('@op-engineering/op-sqlite', () =>
  require('../../harness/sqliteFake').realSqliteModule({ only: ['offgrid-sync.sqlite'] }),
);

type ProHarness = typeof import('../../harness/proHarness');
type App = Awaited<ReturnType<ProHarness['launchLicensedApp']>>;
type Peer = Awaited<ReturnType<ProHarness['startPairedPeer']>>;

const HONEY = 'Honey never spoils.';
const BANANAS = 'Bananas are berries.';
const OCTOPUS = 'Octopuses have three hearts.';
const DESKTOP_QUESTION = 'And one about whales, from my Mac?';
const DESKTOP_ANSWER = 'Blue whales can hear each other across an ocean.';

describe('a synced message among versions', () => {
  let mesh: LicensedMesh;
  let app: App | undefined;
  let desktop: Peer | undefined;

  beforeEach(() => {
    const { createLicensedMesh } = require('../../harness/licensedMesh');
    mesh = createLicensedMesh();
    mesh.reset();
  });

  afterEach(async () => {
    await desktop?.stop();
    desktop = undefined;
    await app?.close();
    app = undefined;
    mesh.restore();
  });

  async function send(prompt: string, answer: string) {
    const { view, rtl, boundary } = app!;
    boundary.llama!.scriptCompletion({ text: answer });
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), prompt);
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await view.findByText(answer);
    await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull());
  }

  /** Every message bubble on screen, top to bottom, named by the text it shows. */
  function thread(): string[] {
    const { view, rtl } = app!;
    const known = ['tell me a fact', HONEY, 'another one', BANANAS, OCTOPUS, DESKTOP_QUESTION, DESKTOP_ANSWER];
    return view
      .queryAllByTestId(/^(user|assistant)-message$/)
      .map((bubble: Parameters<typeof rtl.within>[0]) => known.find(text => rtl.within(bubble).queryByText(text)) ?? '?');
  }

  it('shows the Desktop turn after the version it followed, and only on that branch', async () => {
    const { launchLicensedApp, startPairedPeer } = require('../../harness/proHarness') as ProHarness;
    app = await launchLicensedApp({ mesh, secrets: new Map() });
    const { view, rtl } = app;

    // Pair the Desktop by the code on the Sync screen.
    desktop = await startPairedPeer({ mesh, device: { id: 'desktop-versions-peer', name: 'Studio Mac' } });
    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(await view.findByTestId('open-sync-settings'));
    await desktop.pairWithPhone(view);
    rtl.fireEvent.press(view.getByLabelText('Back'));

    // A chat on the phone: two turns, then Retry on the first answer.
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    rtl.fireEvent.press(await view.findByTestId('browse-models-button'));
    rtl.fireEvent.press(await view.findByTestId('text-model-row-m'));
    await rtl.waitFor(() => expect(view.queryByTestId('text-model-row-m')).toBeNull());
    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await view.findByTestId('chat-input');
    await send('tell me a fact', HONEY);
    await send('another one', BANANAS);
    app.boundary.llama!.scriptCompletion({ text: OCTOPUS });
    rtl.fireEvent(view.getAllByTestId('user-message')[0]!, 'longPress');
    rtl.fireEvent.press(await view.findByTestId('action-retry'));
    await view.findByText(OCTOPUS);
    await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull());

    // BEFORE: the second version is shown, its later turn is out of the way, nothing from the Desktop.
    expect(view.getByText('2/2')).toBeTruthy();
    expect(thread()).toEqual(['tell me a fact', OCTOPUS]);

    // The Desktop has the chat over sync, and continues it after the answer it shows - the second
    // version. It names that answer as the parent of its question, as a Desktop does.
    let followed: string | undefined;
    await rtl.waitFor(() => {
      followed = desktop!.findRecord('message', fields => fields.content === OCTOPUS);
      expect(followed).toBeDefined();
    }, { timeout: 8000 });
    const conversationId = desktop.records.get(`message:${followed}`)!.conversation_id as string;
    const now = Date.now();
    await rtl.act(async () => {
      desktop!.record('message', 'desktop-whale-question', 'put', {
        conversation_id: conversationId, role: 'user', content: DESKTOP_QUESTION,
        context: JSON.stringify({ parent: followed }), created_at: new Date(now).toISOString(),
      });
      desktop!.record('message', 'desktop-whale-answer', 'put', {
        conversation_id: conversationId, role: 'assistant', content: DESKTOP_ANSWER,
        context: JSON.stringify({ parent: 'desktop-whale-question' }),
        created_at: new Date(now + 1000).toISOString(),
      });
    });

    // AFTER: the Desktop turn follows the version it continued, once each, and the switcher still
    // says the second of two.
    await rtl.waitFor(
      () => expect(thread()).toEqual(['tell me a fact', OCTOPUS, DESKTOP_QUESTION, DESKTOP_ANSWER]),
      { timeout: 8000 },
    );
    expect(view.getByText('2/2')).toBeTruthy();

    // Previous: the first branch, as it was - and the Desktop turn is not on it.
    rtl.fireEvent.press(view.getByLabelText('Previous response'));
    await rtl.waitFor(() =>
      expect(thread()).toEqual(['tell me a fact', HONEY, 'another one', BANANAS]),
    );
    expect(view.getByText('1/2')).toBeTruthy();

    // Next: back to the second branch, with the Desktop turn after it.
    rtl.fireEvent.press(view.getByLabelText('Next response'));
    await rtl.waitFor(() =>
      expect(thread()).toEqual(['tell me a fact', OCTOPUS, DESKTOP_QUESTION, DESKTOP_ANSWER]),
    );
    expect(view.getByText('2/2')).toBeTruthy();
  }, 60_000);
});
