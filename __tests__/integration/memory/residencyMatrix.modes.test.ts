/**
 * RESIDENCY MATRIX (integration, scenario-as-DATA) — model co-residency & eviction across ALL 3
 * loading modes (conservative / balanced / aggressive).
 *
 * ONE data table × ONE runner, parameterized over the 3 policies via describe.each. Each row seeds a
 * `residentsBefore` set into the REAL modelResidencyManager, sets the policy, sets the device RAM via the
 * deviceMemory harness (the ONLY faked leaf — the native RAM sensor), then makes an `incoming` model
 * resident via the REAL `ensureResident` and asserts the OBSERVABLE resident set (`getResidents()` /
 * `isResident()`) plus the fit verdict. The whole real stack decides — manager + memoryBudget + policy —
 * so a red row is a real defect, not a programmed mock. No `jest.mock` of any of our own modules.
 *
 * This is the sanctioned service-layer memory-invariant altitude (same as loadingModes.redflow.test.ts /
 * budgetRedflow.test.ts): the resident set is a gesture-less RAM invariant with no single rendered surface;
 * the UI that SELECTS the mode + shows "In Memory" is covered separately (ModelSettingsScreen model-loading-
 * mode; aggressiveDirtyOverCommit.rendered.redflow; modelSelectorShowsLoadedRam).
 *
 * ── Mode semantics (the FINALIZED spec — expected outcomes are DERIVED from these, NOT read off the code) ─
 *  Model types & how they behave in the budget:
 *   - HEAVIES: `text` and `image`. In CONSERVATIVE only ONE heavy is resident at a time (loading one evicts
 *     the other). In BALANCED/AGGRESSIVE they co-reside when they fit, else the lower-priority heavy swaps.
 *   - STT (`whisper`): a FULL budget participant SIDECAR. It co-resides with a heavy when it fits, but it
 *     NEVER evicts a heavy, and it does NOT trigger conservative's single-model rule (loading STT does not
 *     evict the resident text heavy). If STT genuinely doesn't fit, it is REFUSED (never evicts a heavy).
 *   - TTS (`tts`) and embedding (`embedding`): EXEMPT / tiny. They always co-reside, never get evicted,
 *     never cause an eviction — treat them as free.
 *  Modes (a data axis):
 *   - conservative: ONE heavy at a time (loading a heavy evicts the other heavy); sidecars still co-reside.
 *   - balanced: co-reside heavies within the ~70% RAM budget; evict lowest-priority/LRU when they don't fit.
 *   - aggressive: co-reside within the ~88% budget (bigger models/co-residence load automatically).
 *
 * ── Budget physics used to size rows (12GB Android; see memoryBudget.ts) ─────────────────────────────────
 *  - balanced/conservative physical cap ≈ 8602MB; aggressive ≈ 10813MB.
 *  - Android credits real-free RAM up to the physical cap (effectiveAvailableMB reclaim credit), so pure
 *    co-residency rows use a generous device (12GB, availGB high) → budget is NOT the variable; only sizes
 *    that EXCEED the cap force a genuine eviction.
 *  - Clean (text/GGUF, dirtyMemory:false) vs dirty (image/LiteRT, dirtyMemory:true); sidecars whisper/tts/
 *    embedding are small clean models that never evict a heavy.
 *
 * ── ONLY refusal in the finalized model ─────────────────────────────────────────────────────────────────
 *  A single model too big to fit even ALONE on the device is refused (the UI offers "Load Anyway"). There is
 *  NO "pinned model blocks a 2nd heavy" case — that scenario is dropped (the UI can't start a 2nd heavy load
 *  while one streams), so those rows are removed from this matrix.
 *
 * ── ORACLE / KNOWN PRE-EXISTING BUG (M6, being fixed separately) ─────────────────────────────────────────
 * Each row asserts the CORRECT expected behavior. The M6 row is RED on HEAD because of the live budget bug:
 *  - M6 (aggressive over-commits a single dirty model): a genuinely-oversized 9GB dirty model in aggressive
 *    is ADMITTED though zram/dirty pages can't back it (should REFUSE, as balanced/conservative already do).
 * That row is tagged `oracle: 'M6'` and is EXPECTED-to-fail-on-HEAD only in aggressive; do NOT weaken it and
 * do NOT fix source here. The row×mode PASS/FAIL red list is the deliverable that drives the fix.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import type { LoadPolicy } from '../../../src/services/memoryBudget';
import type { ResidentType } from '../../../src/services/modelResidency/policy';
import { setDeviceMemory, resetDeviceMemory, makeResident } from '../../harness/deviceMemory';

/** A seeded resident model (already loaded), as the row describes it. */
interface ResidentSpecRow {
  key: string;
  type: ResidentType;
  sizeMB: number;
  dirtyMemory: boolean;
}

/** The model being loaded in this row. */
interface IncomingRow {
  key: string;
  type: ResidentType;
  sizeMB: number;
  dirtyMemory: boolean;
}

interface DeviceRAM {
  platform: 'ios' | 'android';
  totalGB: number;
  /** real free RAM right now, in GB. */
  availGB: number;
}

/** Per-policy expected terminal state. */
interface Expected {
  /** whether the incoming model was admitted (ends up resident). */
  fits: boolean;
  /** the FULL resident-set keys after the load, sorted (incoming included iff it fit). */
  residentKeysAfter: string[];
}

interface Row {
  name: string;
  residentsBefore: ResidentSpecRow[];
  incoming: IncomingRow;
  deviceRAM: DeviceRAM;
  /** expected terminal state per policy. */
  expected: Record<LoadPolicy, Expected>;
  /** tag a row known-RED-on-HEAD due to a pre-existing budget bug (oracle rows). */
  oracle?: 'M6';
}

// Generous device: 12GB total, plenty of real free RAM → the physical cap is the only ceiling, so pure
// co-residency rows aren't gated by instantaneous free RAM. Balanced cap ≈8602MB, aggressive ≈10813MB.
const ROOMY: DeviceRAM = { platform: 'android', totalGB: 12, availGB: 8 };
// Tight device: 12GB total but only ~4GB truly free. On Android the reclaim credit floors avail to the
// physical cap, so eviction is forced by making the co-resident TOTAL exceed the cap (not by low avail).
const TIGHT: DeviceRAM = { platform: 'android', totalGB: 12, availGB: 4 };

const sorted = (keys: string[]): string[] => [...keys].sort();

/**
 * The scenario table. Sizes are chosen against the 12GB budget physics above so each row's verdict is
 * deterministic and derived from the SPEC (co-reside if it fits the mode's budget; conservative always
 * single-model; sidecars never evict a heavy).
 */
const ROWS: Row[] = [
  {
    // (1) co-residency of text + image, both fit the budget.
    // balanced/aggressive co-reside; conservative evicts the text (single-model) even though both fit.
    name: 'text + image co-reside (both fit)',
    residentsBefore: [{ key: 'text', type: 'text', sizeMB: 2000, dirtyMemory: false }],
    incoming: { key: 'image', type: 'image', sizeMB: 2000, dirtyMemory: true },
    deviceRAM: ROOMY,
    expected: {
      conservative: { fits: true, residentKeysAfter: ['image'] }, // text evicted → only the incoming
      balanced: { fits: true, residentKeysAfter: ['image', 'text'] },
      aggressive: { fits: true, residentKeysAfter: ['image', 'text'] },
    },
  },
  {
    // (2) eviction of text when loading a LARGE image that can't co-reside.
    // text 5000 (clean) + image 6500 (dirty) = 11500 > BOTH caps → every mode evicts the text.
    name: 'large image evicts resident text (cannot co-reside)',
    residentsBefore: [{ key: 'text', type: 'text', sizeMB: 5000, dirtyMemory: false }],
    incoming: { key: 'image', type: 'image', sizeMB: 6500, dirtyMemory: true },
    deviceRAM: TIGHT,
    expected: {
      conservative: { fits: true, residentKeysAfter: ['image'] },
      balanced: { fits: true, residentKeysAfter: ['image'] },
      aggressive: { fits: true, residentKeysAfter: ['image'] },
    },
  },
  {
    // (2b) a LARGE image that fits the AGGRESSIVE cap but not the balanced one — the mode is the variable.
    // text 4000 (clean) + image 5000 (dirty) = 9000: > balanced 8602 (evict text) but ≤ aggressive 10813
    // (co-reside). Conservative is single-model regardless.
    name: 'medium-large image: balanced evicts text, aggressive co-resides',
    residentsBefore: [{ key: 'text', type: 'text', sizeMB: 4000, dirtyMemory: false }],
    incoming: { key: 'image', type: 'image', sizeMB: 5000, dirtyMemory: true },
    deviceRAM: TIGHT,
    expected: {
      conservative: { fits: true, residentKeysAfter: ['image'] },
      balanced: { fits: true, residentKeysAfter: ['image'] }, // 9000 > 8602 → text evicted
      aggressive: { fits: true, residentKeysAfter: ['image', 'text'] }, // 9000 ≤ 10813 → co-reside
    },
  },
  {
    // (3) eviction of image when loading a LARGE text that can't co-reside.
    // image 5000 (dirty) + text 6500 (clean) = 11500 > BOTH caps → every mode evicts the image.
    name: 'large text evicts resident image (cannot co-reside)',
    residentsBefore: [{ key: 'image', type: 'image', sizeMB: 5000, dirtyMemory: true }],
    incoming: { key: 'text', type: 'text', sizeMB: 6500, dirtyMemory: false },
    deviceRAM: TIGHT,
    expected: {
      conservative: { fits: true, residentKeysAfter: ['text'] },
      balanced: { fits: true, residentKeysAfter: ['text'] },
      aggressive: { fits: true, residentKeysAfter: ['text'] },
    },
  },
  {
    // (4) co-residency of text + STT (whisper). Sidecar is small + clean; it never evicts the text.
    // Per the residency spec (policy.ts docstring): "loading [a sidecar] never evicts anything; they're
    // evicted only as a last resort when a heavy generation model can't otherwise fit." So even in
    // conservative single-model mode a whisper load does NOT evict the text heavy — single-model is about
    // the mutually-exclusive HEAVY generation models, not the warm sidecars. The text survives in all modes.
    name: 'text + STT (whisper) co-reside',
    residentsBefore: [{ key: 'text', type: 'text', sizeMB: 2000, dirtyMemory: false }],
    incoming: { key: 'whisper', type: 'whisper', sizeMB: 200, dirtyMemory: false },
    deviceRAM: ROOMY,
    expected: {
      conservative: { fits: true, residentKeysAfter: ['text', 'whisper'] },
      balanced: { fits: true, residentKeysAfter: ['text', 'whisper'] },
      aggressive: { fits: true, residentKeysAfter: ['text', 'whisper'] },
    },
  },
  {
    // (5) co-residency of text + STT + TTS. Two small sidecars warm beside the text model.
    name: 'text + STT + TTS co-reside',
    residentsBefore: [
      { key: 'text', type: 'text', sizeMB: 2000, dirtyMemory: false },
      { key: 'whisper', type: 'whisper', sizeMB: 200, dirtyMemory: false },
    ],
    incoming: { key: 'tts', type: 'tts', sizeMB: 150, dirtyMemory: false },
    deviceRAM: ROOMY,
    expected: {
      // conservative: incoming is a SIDECAR (tts) → it may only reclaim PEER sidecars, so it evicts the
      // resident whisper (peer) but NOT the text heavy — a sidecar never evicts a generation model, even
      // in single-model mode (planEviction's selectEvictionVictim restricts a sidecar incoming to peers).
      conservative: { fits: true, residentKeysAfter: ['text', 'tts'] },
      balanced: { fits: true, residentKeysAfter: ['text', 'tts', 'whisper'] },
      aggressive: { fits: true, residentKeysAfter: ['text', 'tts', 'whisper'] },
    },
  },
  {
    // (6) co-residency of text + image + STT + TTS.
    name: 'text + image + STT + TTS co-reside',
    residentsBefore: [
      { key: 'text', type: 'text', sizeMB: 2000, dirtyMemory: false },
      { key: 'image', type: 'image', sizeMB: 2000, dirtyMemory: true },
      { key: 'whisper', type: 'whisper', sizeMB: 200, dirtyMemory: false },
    ],
    incoming: { key: 'tts', type: 'tts', sizeMB: 150, dirtyMemory: false },
    deviceRAM: ROOMY,
    expected: {
      // conservative: tts (sidecar) evicts only the peer sidecar whisper; the text + image heavies stay.
      conservative: { fits: true, residentKeysAfter: ['image', 'text', 'tts'] },
      balanced: { fits: true, residentKeysAfter: ['image', 'text', 'tts', 'whisper'] },
      aggressive: { fits: true, residentKeysAfter: ['image', 'text', 'tts', 'whisper'] },
    },
  },
  {
    // (7) co-residency of text + image + STT + TTS + embedding — the full house.
    name: 'text + image + STT + TTS + embedding co-reside',
    residentsBefore: [
      { key: 'text', type: 'text', sizeMB: 2000, dirtyMemory: false },
      { key: 'image', type: 'image', sizeMB: 2000, dirtyMemory: true },
      { key: 'whisper', type: 'whisper', sizeMB: 200, dirtyMemory: false },
      { key: 'tts', type: 'tts', sizeMB: 150, dirtyMemory: false },
    ],
    incoming: { key: 'embedding', type: 'embedding', sizeMB: 120, dirtyMemory: false },
    deviceRAM: ROOMY,
    expected: {
      // conservative: embedding (sidecar) evicts only peer sidecars (whisper + tts); both heavies stay.
      conservative: { fits: true, residentKeysAfter: ['embedding', 'image', 'text'] },
      balanced: { fits: true, residentKeysAfter: ['embedding', 'image', 'text', 'tts', 'whisper'] },
      aggressive: { fits: true, residentKeysAfter: ['embedding', 'image', 'text', 'tts', 'whisper'] },
    },
  },
  {
    // (extra A) a SIDECAR never evicts a heavy: incoming whisper cannot fit beside a text model that nearly
    // fills the budget, and a sidecar may only reclaim peer sidecars — so the load is REFUSED (fits=false)
    // and the text heavy stays. Holds in EVERY mode (conservative's single-model still restricts a sidecar
    // incoming to peers). text 8500 clean + whisper 200 = 8700 > 8602 balanced cap; no peer sidecar to free.
    name: 'sidecar (STT) refused rather than evict a heavy that fills the budget',
    residentsBefore: [{ key: 'text', type: 'text', sizeMB: 8500, dirtyMemory: false }],
    incoming: { key: 'whisper', type: 'whisper', sizeMB: 200, dirtyMemory: false },
    deviceRAM: ROOMY,
    expected: {
      conservative: { fits: false, residentKeysAfter: ['text'] },
      balanced: { fits: false, residentKeysAfter: ['text'] },
      // aggressive cap 10813 > 8700 → the sidecar DOES fit beside the heavy → co-reside.
      aggressive: { fits: true, residentKeysAfter: ['text', 'whisper'] },
    },
  },
  {
    // (ORACLE M6) aggressive over-commits a single OVERSIZED dirty model. 9GB dirty image on 12GB @3GB-free:
    // zram/dirty pages can't back it → must be REFUSED (as balanced/conservative already do). HEAD: the
    // aggressive 0.88 cap + reclaim credit ADMITS it (M6 bug). Balanced/conservative correctly refuse
    // (9216 > 8602 cap AND the dirty real-free gate bites). This row is EXPECTED-RED on HEAD only in
    // aggressive; balanced/conservative should PASS (they already refuse).
    name: '[oracle M6] oversized 9GB dirty image @3GB-free: refused in every mode (aggressive over-commits)',
    residentsBefore: [],
    incoming: { key: 'image', type: 'image', sizeMB: 9216, dirtyMemory: true },
    deviceRAM: { platform: 'android', totalGB: 12, availGB: 3 },
    oracle: 'M6',
    expected: {
      conservative: { fits: false, residentKeysAfter: [] },
      balanced: { fits: false, residentKeysAfter: [] },
      aggressive: { fits: false, residentKeysAfter: [] }, // RED on HEAD: aggressive admits it
    },
  },
];

const POLICIES: LoadPolicy[] = ['conservative', 'balanced', 'aggressive'];

describe.each(POLICIES)('model residency matrix — %s policy', policy => {
  afterEach(() => resetDeviceMemory());

  it.each(ROWS.map(r => [r.name, r] as const))('%s', async (_name, row) => {
    // Seed the device RAM + policy and reset the REAL manager to empty.
    setDeviceMemory({ ...row.deviceRAM, policy });

    // Seed residentsBefore into the REAL manager (as if already loaded). No row pins a resident:
    // the "pinned model blocks a 2nd heavy" case is dropped from the finalized model (the UI can't
    // start a 2nd heavy load while one streams), so every seeded resident is normally evictable.
    for (const r of row.residentsBefore) {
      makeResident({
        key: r.key,
        type: r.type,
        modelId: r.key,
        sizeMB: r.sizeMB,
        dirtyMemory: r.dirtyMemory,
      });
    }

    // Load the incoming model through the REAL ensureResident: it runs makeRoomFor (evict-to-fit under the
    // active policy), HONORS the fit verdict, and only then registers the model. So the resident set after
    // reflects exactly what the user would end up with in RAM.
    const load = jest.fn().mockResolvedValue(undefined);
    const unload = jest.fn().mockResolvedValue(undefined);
    const { loaded } = await modelResidencyManager.ensureResident(
      {
        key: row.incoming.key,
        type: row.incoming.type,
        modelId: row.incoming.key,
        sizeMB: row.incoming.sizeMB,
        dirtyMemory: row.incoming.dirtyMemory,
      },
      { load, unload },
    );

    const exp = row.expected[policy];

    // Observable outcome #1: the fit verdict — did the incoming model become resident?
    expect(loaded).toBe(exp.fits);
    expect(modelResidencyManager.isResident(row.incoming.key)).toBe(exp.fits);

    // Observable outcome #2: the WHOLE resident set (the RAM the user ends up holding).
    const actual = sorted(modelResidencyManager.getResidents().map(r => r.key));
    expect(actual).toEqual(sorted(exp.residentKeysAfter));
  });
});
