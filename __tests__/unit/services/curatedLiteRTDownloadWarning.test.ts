/**
 * curatedLiteRTDownloadWarning — the SINGLE device-aware decision for "should downloading
 * this curated LiteRT model warn on THIS device?" Both the Models tab and the onboarding
 * screen call it, so it must never be a device-blind static flag (the bug: the warning fired
 * on a 12GB device that easily fits the ~3.4GB Gemma 4 E4B model).
 *
 * Pure/zero-IO: RAM is passed in (the caller reads it from hardwareService at the boundary),
 * so the decision is unit-testable without mounting a screen.
 */
import {
  curatedLiteRTDownloadWarning,
  CURATED_LITERT_ENTRIES,
} from '../../../src/services/curatedLiteRTRegistry';

// Ground the fixture in the REAL registry entry that carries a confirmDownload warning
// (Gemma 4 E4B), not a hand-authored guess — so the test can't encode a wrong assumption.
const warnedEntry = CURATED_LITERT_ENTRIES.find(e => e.confirmDownload);

describe('curatedLiteRTDownloadWarning (single device-aware decision)', () => {
  it('has a real curated entry that carries a confirmDownload warning (fixture ground-truth)', () => {
    expect(warnedEntry).toBeDefined();
  });

  it('returns NO warning on a high-RAM device where the model fits (the reported false-alarm)', () => {
    // 12GB device: budget = 12 * 0.70 (Android) = ~8.4GB; the ~3.4GB model fits → no warning.
    const result = curatedLiteRTDownloadWarning(warnedEntry!.fileName, warnedEntry!.sizeBytes, 12);
    expect(result).toBeNull();
  });

  it('returns the warning copy on a low-RAM device where the model does NOT fit', () => {
    // 4GB device: budget = 4 * 0.50 = 2GB; the ~3.4GB model exceeds it → warn, with the copy.
    const result = curatedLiteRTDownloadWarning(warnedEntry!.fileName, warnedEntry!.sizeBytes, 4);
    expect(result).toEqual(warnedEntry!.confirmDownload);
  });

  it('returns NO warning for a file with no curated entry (unknown model)', () => {
    expect(curatedLiteRTDownloadWarning('not-a-real-model.litertlm', 3_600_000_000, 4)).toBeNull();
  });

  it('returns NO warning for an entry that carries no confirmDownload copy, even if over budget', () => {
    const noWarnEntry = CURATED_LITERT_ENTRIES.find(e => !e.confirmDownload);
    // Only assert if such an entry exists; otherwise the branch is covered by the unknown-file case.
    if (noWarnEntry) {
      expect(curatedLiteRTDownloadWarning(noWarnEntry.fileName, noWarnEntry.sizeBytes, 1)).toBeNull();
    }
  });
});
