/**
 * Which video models this phone makes videos with itself, and when it needs a computer.
 *
 * SPEC (OGAM): one rule, from the phone's memory, decides whether video is made "on this phone" or the
 * app offers "Find my computer". A pack is offered when the phone has the memory the pack asks for; the
 * Light builds and Wan 2.2 Turbo are offered from 11 GB, below that minimum. A phone with none is sent to a
 * computer. A pack is never offered on an OS its weights do not run on, nor one that cannot be
 * downloaded whole (every file sized).
 *
 * A pure rule over the shipped catalog: nothing to fake.
 */
import { CATALOG, isVideoWeightAvailableOn, type ModelEntry } from '@offgrid/models';
import { completeVideoPacks, videoPacksForPhone } from '../../../../src/services/phoneVideoPacks';

const ids = (packs: ModelEntry[]) => packs.map(pack => pack.id);
const primary = (pack: ModelEntry) => pack.files.find(file => file.role === 'primary')?.name ?? '';
const LIGHT = ['off-grid-ai/Wan2.1-T2V-1.3B-GGUF-Q4', 'hum-ma/Wan2.2-TI2V-5B-Turbo-GGUF'];

describe.each(['ios', 'android'])('on %s', os => {
  it('a phone with 8 GB has no pack of its own: video goes to a computer', () => {
    expect(videoPacksForPhone(8, os)).toEqual([]);
  });

  it('a 10 GB phone has none either: 11 GB is the Light builds\' floor', () => {
    expect(videoPacksForPhone(10, os)).toEqual([]);
  });

  it('a 12 GB phone is offered only the Light and Turbo builds', () => {
    const offered = ids(videoPacksForPhone(12, os));
    expect(offered.length).toBeGreaterThan(0);
    for (const id of offered) expect(LIGHT).toContain(id);
  });

  it('every pack offered fits the phone\'s memory (or is a Light build from 11 GB), and more memory never offers fewer', () => {
    let previous: string[] = [];
    for (const ram of [8, 11, 12, 16, 24, 32, 64]) {
      const offered = videoPacksForPhone(ram, os);
      for (const pack of offered) expect(pack.minRamGb! <= ram || (ram >= 11 && LIGHT.includes(pack.id))).toBe(true);
      for (const id of previous) expect(ids(offered)).toContain(id);
      previous = ids(offered);
    }
    // A 16 GB phone gets Wan 2.1 at its own minimum.
    expect(ids(videoPacksForPhone(16, os))).toContain('off-grid-ai/Wan2.1-T2V-1.3B-GGUF');
  });

  it('never offers a pack whose weights this OS cannot run, or one with an unsized file', () => {
    for (const pack of completeVideoPacks(os)) {
      expect(isVideoWeightAvailableOn(primary(pack), os)).toBe(true);
      expect(pack.files.every(file => !!file.sizeBytes)).toBe(true);
    }
    const offeredToBiggestPhone = ids(videoPacksForPhone(128, os));
    for (const pack of CATALOG.filter(entry => entry.kind === 'video' && !isVideoWeightAvailableOn(primary(entry), os)))
      expect(offeredToBiggestPhone).not.toContain(pack.id);
  });
});

it('Wan 2.2 Turbo is offered on 12 GB phones on both OSes, and the 20-step builds it replaced on neither', () => {
  for (const os of ['ios', 'android']) {
    expect(ids(videoPacksForPhone(12, os))).toContain('hum-ma/Wan2.2-TI2V-5B-Turbo-GGUF');
    expect(ids(videoPacksForPhone(128, os)).filter(id => id.startsWith('off-grid-ai/Wan2.2'))).toEqual([]);
  }
});
