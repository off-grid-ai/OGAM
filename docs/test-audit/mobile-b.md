# Mobile tests without mocks of our code: half B

Ali: "i want proper non mockist tests", "Every test, all repos".

The rule, the guard and the split are in [mobile-a.md](mobile-a.md). Half B is `__tests__/unit/` and
`__tests__/rntl/` (`docs/test-audit/mobile-b-files.txt`, 126 files and 439 mocks at the split). This
lane also converted the 17 release files from the iOS lane's audit list.

## How a test fakes the phone

The device fakes live in `__tests__/harness/`:

- **`nativeBoundary.ts`**: native modules (llama.rn, LiteRT, whisper, diffusion, the background
  downloader with its rows and events), the RAM sensor, and `requireRTL()`. `requireRTL()` renders
  with the same React as a fresh module graph.
- **`nativeFileSystem.ts`**: the disk, held in memory. A served remote file can report its full
  size, so a multi-GB model never has to be held in memory.
- **`modelManagerDevice.ts`, `imageDownloadDevice.ts`**: the phone under the download paths. A
  download starts the way the app starts one, and the test finishes, fails or reports bytes for it
  through the native downloader.
- **`generationDevice.ts`, `embeddingDevice.ts`**: the phone under a reply or an embedding. Models
  load through `activeModelService`, under the residency lock.
- **`hfModelApiServer.ts`, `hfImageCatalogServer.ts`, `remoteMediaServer.ts`, `keyedRemoteServer.ts`**:
  the network, answered at `fetch` or XHR in the real services' wire shapes.
- **`navigatorHook.ts`**: a hook or screen on a real stack navigator. Tests read where the app went
  from the navigation ref.
- **OS edges, spied or faked directly in the test:** `Alert.alert`, the keychain, the haptic engine,
  and the console. The real logger writes to the console.

Seeding uses the app's own write paths:

- store actions, such as `incrementTextGenerationCount` or `addDownloadedImageModel`
- `textProvider.start` for a download
- `beginPairing`/`commitPairing` for a trusted device
- what a previous launch saved

## Progress

**Done: none of half B is left in `mockBaseline.json`.** All 126 files of half B and the 17 release
files run our code for real, with fakes only at the device boundary. The guard passes, and so do
`knip` and `tsc`.

### Release files (iOS lane audit list): 17 of 17

| File | Removed | Now |
|---|---|---|
| `unit/services/modelManager.test.ts` | 3 mocks, 6 spies | Split into 4 files under `unit/services/modelManager/` (86 tests). Coverage of `src/services/modelManager/**` went up. Three dead private wrappers were removed. |
| `unit/services/generationService.test.ts` | 7 | Streaming, Stop, queue, server path and tools on the real stack. |
| `unit/services/generationServiceHelpers.branches.test.ts` | 6 | The LiteRT path. This found the LiteRT stuck-reply bug, see Findings. |
| `unit/screens/modelReadiness.test.ts` | 2 | The real Load Anyway flow on llama and LiteRT. |
| `unit/services/toolEmbeddingRouter.test.ts` | 2 | The real embedding service; vectors survive a relaunch. |
| `unit/services/modelResidency.test.ts` | 35 spies | The RAM sensor and the OS memory warning. |
| `unit/services/remoteServerManager.test.ts` | 3 | A keyed fake server and a Keychain fake that really stores. |
| `unit/services/remoteMediaRuntime.test.ts` | 1 spy | A fake media server; speech is written to the in-memory disk. |
| `unit/services/imageGenerationHelpers.test.ts` | 1 | A real chat built through the chat store. |
| `unit/utils/imageModelIntegrity.io.test.ts` | 1 | A real unzip fake on the in-memory disk. |
| `unit/screens/ModelsScreen/imageDownloadActions.test.ts` | 5 | The image download device. |
| `unit/screens/ModelsScreen/imageDownloadResume.test.ts` | 4 | A finished zip recovered after a restart. |
| `unit/screens/ModelsScreen/useImageModels.*.test.ts` (2) | 14 | The Image tab on the real stack. This found the cleared-filter bug, see Findings. |
| `unit/screens/ModelsScreen/trendingSelection.test.ts` | 4 | The real RAM budget on a real stack. |
| `unit/screens/ModelsScreen/useModelsScreen.test.ts` | 10 | The real stack, the disk, the downloader and the catalog. |
| `unit/screens/DownloadManagerScreen/useDownloadManager.branches.test.ts` | 10 | The Hugging Face API at fetch; Pro through `installPro`. |

### Half B (`unit/`, `rntl/`)

These are done in batches; see the git log for each commit. Batches so far:

- **Logger, 12 files:** the real logger runs. Tests that check a log line read it from the console.
- **`messageContent`, 5 files:** the real control-token stripping runs.
- **Sheet, alert and theme, 8 files:** the real `AppSheet`, `CustomAlert` and theme render. The
  alert tests read the rendered alert and close it with the sheet's own Done.
- **Haptics, 2 files:** the device's haptic engine is the fake.
- **Downloads, 7 files:**
  - OuteTTS downloads, relaunch hydration (2 files), Repair Vision progress, `useModelDownloads`
    and `useDownloads` run on the native downloader fake.
  - Clear GPU Cache runs on the Android diffusion module.
- **Navigation, 2 files:** `useFocusTrigger` and `useOpenProTools` run on a real stack.
- **Other files:**
  - `ModelCard`: real size format, "4.00 GB".
  - `recommendedModels`: the catalog is passed in.
  - `proPrompt`: the real store and its increment actions.
  - `forgetUnregisteredDevice`: a pairing committed to the keychain fake.
  - `useEjectAllModels`: a model really loaded, then ejected.

## Findings

1. **LiteRT: a model error mid-reply left the chat stuck "generating".** Fixed in `3c2ea7ce2`. On LiteRT,
   an error such as B23 "Status 13 Failed to invoke the compiled model" came after the send had
   returned, so it had nowhere to go, and the fallback never ran. The send now waits for the whole
   reply, and Stop ends the reply in progress. This is Android-only and needs a check on the Nord.
2. **Image tab: a filter cleared before the phone's recommendation arrived came back.** Fixed in
   `25d6d565e`. The recommendation read a stale flag from when the tab mounted.
3. **Eject All stayed offered after everything was ejected.** Fixed in `8ff32ee33`. Eject keeps
   the selection by design, but the hook offered Eject from the selection, so a second tap
   ejected nothing.
   - The fix: `activeModelService` now publishes `loadedImageModelId` as it does the text one, and
     the control reads what is loaded.
   - The test: load, eject, Eject is no longer offered, the selection is kept, load again, Eject
     is back.
4. **A transcription download that failed mid-session dropped its row.** Fixed in `058c01bec`. Its
   cleanup removed the row whatever the outcome, so the Download Manager could not offer Retry.
   - The fix: a failure now keeps the row as failed, with its reason; a cancel still removes it.
   - The test, on the native downloader: fail, the row stays, Retry, the download completes.
7. **A stale transcription download deleted a finished model.** Fixed in `058c01bec`. When a
   replacement download had already finished, the older download's later failure removed the
   model file, because no download was active to stop it.
8. **Dead code found by the hook's `knip` step.** Fixed in `ee995871d` and `865de788c`.
   - Five helpers were exported only for the old tests; they are now private.
   - The `useDownloads` hook had no user; it is removed.
5. **A text row stays "running" at 100%** when `modelManager.downloadModelBackground` is called
   directly. Open; the app's real path does not do this. It blocks a later vision repair with
   "already running".
6. **The guard has a gap.** `__tests__/harness/deviceMemory.ts` spies on `hardwareService`, and the
   guard scans only test files. Reported to the Android lane, which owns the guard.

## Branches no test can reach without mocking our code

These tests were dropped. No mock was left in their place.

- **Download hydration, the per-row try/catch.** The native bridge hands over plain JSON, so a row
  cannot throw while it is read.
- **Readiness, "Remote provider not found".** The real registry routes only to registered providers.
- **LiteRT, a late token after Stop.** Stop removes the listeners first.
- **`remoteServerManagerUtils`, "Could not create provider", and "throws when server creation
  fails".** The real registry and store always succeed.
- **`useDownloadManager`, the image-delete error branch.** `imageProvider.remove` catches every
  error.

## Fixed after the first report

Each fix has a test at the device boundary that fails on the code before the fix.

- **`22070762c` A Cancel on a "Queued" row always wins.** A Cancel that came before the start reached
  the download queue was missed, so the model downloaded once a slot freed. The queue now
  remembers that Cancel briefly and refuses the start.
- **`2b1a7080c` Switching image models stops when the first will not unload.** The model in use
  stays loaded and selected, the second is not loaded on top of it, and the error is shown so a
  retry can switch.
- **`543c3eb87` A Stop pressed before the reply starts stops it.** llama.rn clears a stop when a
  completion begins, so the reply used to run to the end. The turn now records the Stop and does
  not start the completion; a Stop that lands as it starts is sent again.
- **`2aa829da2` A model that will not load says why.**
  - A real allocation failure reads "Not enough memory".
  - A damaged or unsupported file reads "This model file can't be loaded (damaged or
    unsupported)", with Delete and Re-download as the next step.
  - Before, every such failure read as out of memory. The step is named in the text; a one-tap
    Re-download button on the card is a follow-up.
- **`29b6c2f76` Vision repair works again.** A model loaded without its projector now really
  reloads with it.

More bugs the converted tests found, each fixed with a test that fails before the fix:

- **`1457ebd1b` A dictation went to the wrong chat.** If the person switched chats while
  recording, the transcript was put into the new chat.
- **`8456334f4` Generated images were not spoken in voice mode.** The image service reported done
  before the result was in the chat, so turn speech found nothing to say.
- **`28dae3467`, `63699b824` The Queued-cancel fix corrected twice.**
  - First, deleting a running download also cancels its queued placeholder, and remembering that
    cancel refused the replacement download.
  - Then, a cancel kept in memory for a fixed time refused a re-download right after the cancel.
  - Now only a start that `startModelDownload` announced, and that was cancelled before it reached
    the queue, is refused.

## Open

- None. The LockScreen keychain lockout is fixed in `b7a95bd66`: a keychain that can't be read
  now says "Couldn't check your passphrase" with Try again, and no attempt counts.

## After release

- **The residency lock in `localProvider`:** `unloadModel` and `dispose` call
  `llmService.unloadModel` without the residency lock. Nothing in the app calls them today. Route
  them through the lock before anything does.

## Not changed (observations)

- **`detectServerType` misreads Ollama.** It reports a real Ollama server as `openai-compatible`
  unless the server sends a `Server: ollama` header.
- **A dead branch in `checkMmProjExists`.** Its `statFile` catch can never run, because `statFile`
  never throws.
