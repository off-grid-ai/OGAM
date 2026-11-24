/**
 * The way forward when memory refuses a chat model: the biggest smaller chat model on the phone, else
 * the starter pick when it is smaller and not here yet. Runs over the bundled catalog and the shared
 * picking rule; the rendered journey is in
 * __tests__/integration/memory/refusalOffersSmallerModel.rendered.test.tsx.
 */
import { smallerChatModel, starterPick } from '../../../src/services/devicePicks';
import { createDownloadedModel } from '../../utils/factories';

const GB = 1e9;
const model = (id: string, fileSize: number, over: Record<string, unknown> = {}) =>
  createDownloadedModel({ id, name: id, fileName: `${id}.gguf`, fileSize, ...over });

describe('smallerChatModel', () => {
  const refused = model('refused', 4 * GB);

  it('offers the biggest chat model on the phone that is smaller than the refused one', () => {
    const choice = smallerChatModel(refused, [refused, model('tiny', 0.5 * GB), model('mid', 2 * GB), model('huge', 6 * GB)], 8);
    expect(choice).toMatchObject({ kind: 'use', model: { id: 'mid' } });
  });

  it('never offers the intent classifier, a broken recovered file, or a file of unknown size', () => {
    const choice = smallerChatModel(refused, [
      refused,
      model('bartowski/SmolLM2-135M-Instruct-GGUF/smol', 0.1 * GB),
      model('own-classifier', 0.2 * GB),
      model('recovered_x', 50 * 1024 * 1024, { author: 'unknown' }),
      model('sizeless', 0),
    ], 8, { classifierModelId: 'own-classifier' });
    // None of them is a chat model to offer: the starter is.
    expect(choice?.kind).toBe('download');
  });

  it('offers the starter to download when nothing smaller is on the phone', () => {
    const starter = starterPick(8)!;
    expect(starter.sizeBytes).toBeLessThan(1e9);
    expect(smallerChatModel(refused, [refused], 8)).toEqual({ kind: 'download', pick: starter });
  });

  it('offers nothing when the starter is not smaller, or is already here', () => {
    const starter = starterPick(8)!;
    const small = model('small', starter.sizeBytes);
    expect(smallerChatModel(small, [small], 8)).toBeNull();
    // The starter's file is on the phone (its size unread, so it is not offered as a model to use):
    // downloading it again would be no way forward.
    const starterHere = model('starter', 0, { fileName: starter.file.name });
    expect(smallerChatModel(refused, [refused, starterHere], 8)).toBeNull();
  });

  it('offers nothing when no catalog model under 1 GB runs on the phone', () => {
    expect(smallerChatModel(refused, [refused], 8, { catalog: [] })).toBeNull();
  });
});
