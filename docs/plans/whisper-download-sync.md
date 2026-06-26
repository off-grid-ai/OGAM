# Plan: Sync Whisper download state across Home banner, Models screen, Download Manager

## Problem
Whisper (STT) download state is inconsistent across the three places it appears.
Downloading from one surface isn't reliably reflected in the others, and deleting
in the Download Manager leaves the others showing the model as present.

## Root cause — two sources of truth
- **`whisperStore`** (persisted Zustand): `downloadedModelId` (active),
  `presentModelIds` (on disk), `isDownloading` / `downloadingId` /
  `downloadProgress`, plus `refreshPresentModels()` to reconcile with disk.
  Used by **Home banner** (`HomeScreen` → `ModelsSummaryRow` "speech" row +
  `WhisperPickerSheet`) and **Models screen** (`TranscriptionModelsTab`).
- **`whisperService.listDownloadedModels()`** (disk scan, completed-only):
  used by the **Download Manager** (`useVoiceDownloadItems`) directly.

So Home ↔ Models are already in sync (same store). The **Download Manager** is the
outlier:
1. It only lists **completed** models from disk — an **in-progress** Whisper
   download started from Home/Models never appears there.
2. Its **delete bypasses `whisperStore`** (`deleteItem` → `whisperService.deleteModel`
   with no `refreshPresentModels()` / `deleteModelById`), so Home + Models keep
   showing the deleted model as present/active.
3. `whisperStore.presentModelIds` is persisted and can drift from disk unless
   `refreshPresentModels()` is called.

(Home banner note: "speech" is already just one row in the unified
`ModelsSummaryRow` alongside text/image — it shows the active model's name and
opens `WhisperPickerSheet`. It is not a whisper-only screen.)

---

## Option A (recommended): make `whisperStore` the single source of truth

Everything that shows or mutates Whisper download state goes through `whisperStore`;
the Download Manager observes it instead of reading disk independently.

1. **Download Manager reads `whisperStore`, not disk.**
   - In `useVoiceDownloadItems`, source completed STT items from
     `whisperStore.presentModelIds` (resolved to names via `WHISPER_MODELS`)
     instead of `whisperService.listDownloadedModels()` — or keep the disk read
     but only as the input to `refreshPresentModels()` (single reconcile path).
   - Add an **in-progress** STT item when `whisperStore.isDownloading` (use
     `downloadingId` + `downloadProgress`) so a Whisper download started anywhere
     shows live in the Download Manager, matching how text/image in-progress items
     work.
2. **Delete goes through `whisperStore`.**
   - `useVoiceDownloadItems.deleteItem` for `modelType === 'stt'` calls
     `whisperStore.getState().deleteModelById(modelId)` (which already updates
     `presentModelIds`/`downloadedModelId`) instead of `whisperService.deleteModel`.
   - Result: deleting in the Download Manager immediately updates Home + Models.
3. **Reconcile with disk on the right moments.**
   - Call `whisperStore.refreshPresentModels()` on app boot and on Download Manager
     focus so the persisted list can't drift from disk.

Result: download or delete from **any** surface flows through one store; Home,
Models, and Download Manager all reflect it, including in-progress.

Files: `src/screens/DownloadManagerScreen/useVoiceDownloadItems.ts` (main),
`src/stores/whisperStore.ts` (ensure `deleteModelById` + `refreshPresentModels`
cover all cases), boot wiring (call `refreshPresentModels` once at startup).

---

## Option B (simpler fallback, per request): shrink the surface + fix delete sync

If routing in-progress into the Download Manager is more than wanted now:

1. **Home banner: stop being a Whisper download entry point.** Keep the "speech"
   row as a **status/label only** (show active model / "—"); move actual Whisper
   download+management to the Models screen + Download Manager. This removes one
   surface that has to stay in sync.
2. **Fix the one real desync** regardless: make the Download Manager's STT delete
   go through `whisperStore.deleteModelById` and call `refreshPresentModels()`
   after, so deletes converge across surfaces.
3. Accept that **in-progress** Whisper downloads show only where they start
   (Models screen), not live in the Download Manager — the Download Manager keeps
   listing completed ones, just kept correct on delete + focus refresh.

This is less code and still removes the confusing "downloaded here, still shows
there" behavior, at the cost of not showing in-progress Whisper in the Download
Manager.

---

## Recommendation
Option A is the clean fix and not large — the Download Manager already has an
in-progress concept for text/image; we're feeding Whisper's existing
`whisperStore` progress into it and routing delete through the store. Do A unless
we want the smallest possible change, in which case B step 2 (delete sync) is the
must-fix.

## Tests
- Unit: `useVoiceDownloadItems` lists present models from `whisperStore`; shows an
  in-progress item when `isDownloading`; delete calls `deleteModelById`.
- Unit: `whisperStore.deleteModelById` clears `presentModelIds`/`downloadedModelId`.
- Integration: download from Home → appears in Models + Download Manager; delete in
  Download Manager → gone from Home + Models (no stale label).
