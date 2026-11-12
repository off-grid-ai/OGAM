/**
 * What Scribe learned, across devices, below the screen.
 *
 * SPEC: a word I add on the phone reaches the paired device as one learned record, and the phone stops
 * flagging it. A word learned on the paired device stops being flagged on the phone; when that device
 * forgets it, the phone flags it again. The same word learned on both at once is one record. A rule
 * muted on the paired device is not flagged on the phone.
 *
 * Real writingEngine, MobileStateMaterializer, core's mutation sink and @offgrid/sync's OpLog on both
 * sides, trading ops the way StateSync does (ingest). Device boundaries only: AsyncStorage
 * (installNativeBoundary) and the paired device, which is its own OpLog with a minimal store.
 */
import { randomUUID } from 'node:crypto';
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type EngineModule = typeof import('../../../pro/scribe/writingEngine');
type MaterializerModule = typeof import('../../../pro/sync/mobileStateMaterializer');
type SyncModule = typeof import('@offgrid/sync');

const describePro = proIsPresent() ? describe : describe.skip;

const TEXT = 'I will recieve the parcel tomorrow.';
const WORD = 'recieve';

/** A fresh install with Scribe and a paired device, ops flowing both ways as StateSync carries them. */
async function pairedPhone() {
  installNativeBoundary();
  const storage = require('@react-native-async-storage/async-storage');
  await (storage.default ?? storage).clear();
  const sync = require('@offgrid/sync') as SyncModule;
  const { HOOKS, registerHook } = require('../../../src/bootstrap/hookRegistry');
  const { writingEngine } = requirePro<EngineModule>('@offgrid/pro/scribe/writingEngine')!;
  const { MobileStateMaterializer } = requirePro<MaterializerModule>(
    '@offgrid/pro/sync/mobileStateMaterializer',
  )!;
  await writingEngine.start();

  const desktopRecords = new Map<string, Record<string, unknown>>();
  const options = { uuid: randomUUID, now: Date.now };
  const phone = new sync.OpLog({ ...options, deviceId: 'phone', materializer: new MobileStateMaterializer() });
  const desktop = new sync.OpLog({
    ...options,
    deviceId: 'desktop',
    materializer: {
      put: (_entity, entityId, fields) => {
        desktopRecords.set(entityId, fields);
      },
      remove: (_entity, entityId) => {
        desktopRecords.delete(entityId);
      },
    },
  });
  // The phone's sink: what the app records goes into its op-log and out to the paired device.
  registerHook(HOOKS.syncRecordLocalMutation, (mutation: import('../../../src/services/sync/mutation').SyncMutation) => {
    desktop.ingest([phone.record(mutation.entity, mutation.entityId, mutation.kind, mutation.fields)]);
  });
  const fromDesktop = (item: import('@offgrid/sync').WritingLearned, kind: 'put' | 'delete') =>
    phone.ingest([
      desktop.record(
        sync.WRITING_LEARNED_ENTITY,
        sync.writingLearnedEntityId(item),
        kind,
        kind === 'put' ? sync.createWritingLearnedFields(item, Date.now()) : undefined,
      ),
    ]);
  const flagged = (text: string, word: string) =>
    writingEngine.check(text).some(issue => text.slice(issue.span[0], issue.span[1]) === word);
  return { sync, writingEngine, phone, desktop, desktopRecords, fromDesktop, flagged };
}

describePro('Scribe learned words across devices', () => {
  it('a word added on the phone reaches the paired device as one record and is not flagged here', async () => {
    const { sync, writingEngine, desktopRecords, flagged } = await pairedPhone();
    expect(flagged(TEXT, WORD)).toBe(true);

    writingEngine.addWord(WORD);

    expect(flagged(TEXT, WORD)).toBe(false);
    const id = sync.writingLearnedEntityId({ kind: 'term', term: WORD });
    expect(sync.parseWritingLearned(id, desktopRecords.get(id) ?? {})).toEqual({ kind: 'term', term: WORD });
    expect(desktopRecords.size).toBe(1);
  });

  it('a word learned on the paired device is not flagged here; forgotten there, it is flagged again', async () => {
    const { writingEngine, fromDesktop, flagged } = await pairedPhone();
    const { waitFor } = requireRTL();

    fromDesktop({ kind: 'term', term: WORD }, 'put');
    await waitFor(() => expect(flagged(TEXT, WORD)).toBe(false));

    fromDesktop({ kind: 'term', term: WORD }, 'delete');
    await waitFor(() => expect(flagged(TEXT, WORD)).toBe(true));
    expect(writingEngine.learned()).toEqual([]);
  });

  it('the same word learned on both devices at once is one record', async () => {
    const { sync, writingEngine, phone, desktop, fromDesktop } = await pairedPhone();

    writingEngine.addWord(WORD);
    fromDesktop({ kind: 'term', term: WORD.toLowerCase() }, 'put');

    const id = sync.writingLearnedEntityId({ kind: 'term', term: WORD });
    expect(phone.winningOp(sync.WRITING_LEARNED_ENTITY, id)?.kind).toBe('put');
    expect(desktop.winningOp(sync.WRITING_LEARNED_ENTITY, id)?.opId).toBe(
      phone.winningOp(sync.WRITING_LEARNED_ENTITY, id)?.opId,
    );
  });

  it('a rule muted on the paired device is not flagged here', async () => {
    const { writingEngine, fromDesktop } = await pairedPhone();
    const { waitFor } = requireRTL();
    const text = 'Their is a plan for tomorrow.';
    const [issue] = writingEngine.check(text).filter(i => i.ruleId);
    expect(issue?.ruleId).toBeTruthy();

    fromDesktop({ kind: 'rule-muted', ruleId: issue!.ruleId! }, 'put');

    await waitFor(() => expect(writingEngine.check(text).some(i => i.ruleId === issue!.ruleId)).toBe(false));
  });
});
