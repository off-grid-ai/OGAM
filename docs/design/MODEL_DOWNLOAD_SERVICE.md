# Model Download Service — reference architecture

Status: PROPOSED. Branch: TBD.

## Why (the problem)

Model downloads "get stuck for days" because **there is no single owner of downloading**. Four model types download four different ways, and only one is robust. The Download Manager then stitches the four together with per-type branching (`if modelType === 'tts' … else …`) — the missing-abstraction anti-pattern (`CLAUDE.md` → "never branch on a concrete type"). Each new type adds bespoke wiring and breaks differently.

### What already works (the reference path)

`backgroundDownloadService.startDownload()` → native OS downloader (Android WorkManager / iOS NSURLSession), **persisted** (Room / UserDefaults), **resumable across app kill**, emits `DownloadProgress`/`DownloadComplete`/`DownloadError`. **TEXT (gguf)** is the reference implementation: `modelManager` orchestrates start → main+mmproj sidecar → finalize (move + register + persist) → restore-on-boot → retry. `downloadStore` is its state machine.

### What's fragile (the stuck-for-days sources)

| Type | Mechanism | Resumable on kill? | Cancellable? |
|---|---|---|---|
| Text (gguf) | `startDownload()` (native) + mmproj sidecar | ✅ | ✅ |
| Image — zip | `startDownload()` (native) | ✅ | ✅ |
| Image — multi-file (HF/CoreML) | in-process loop of `downloadFileTo()`, synthetic `image-multi:` id, in-memory progress | ❌ (only if dir already exists) | partial |
| STT (whisper) primary | `downloadFileTo()` (native file, in-process promise) | ⚠️ file yes, orchestration no | ✅ |
| STT `downloadFromUrl` | raw `RNFS.downloadFile()` | ❌ | ❌ |
| TTS (Kokoro) | executorch `BareResourceFetcher` (outside the app stack) | implicit (skip cached) | ❌ |

### Native failure modes that strand downloads (must fix)

- **iOS marks orphans "failed" not "paused"** on relaunch (`DownloadManagerModule.swift:555-574`) → no auto-resume; needs a manual retry tap.
- **Progress polling is tied to screen visibility** (`stopProgressPolling` on nav away) → a background download silently stalls in the UI; observer not re-registered (Android `:471-475`).
- **Event dropped if no JS listener yet** (iOS `hasListeners` gate `:1199…`) → completion fired before listeners attach on startup is lost → stuck at 100%/"running".
- **Multi-file error doesn't cascade to parent** (iOS `:1103-1174`) → one failed file leaves the parent "running" forever.
- **Partial files orphaned on cancel** (iOS never unlinks) → temp bloat.

## Target architecture

One owning service; every type plugs in through a uniform contract; the *actual* download always goes through the proven native `startDownload()`.

```
            UI (Download Manager, Models screen)
                         │  one list + cancel/delete/retry; NO per-type branching
        ┌────────────────────────────────────────────────┐
        │            ModelDownloadService                  │  ← single owner: start / cancel /
        │  start(spec) · cancel(id) · retry(id) · delete   │     retry / delete / list / subscribe
        │  list(): ModelDownload[] · subscribe(cb)         │     + restore-on-boot, persistence
        └───────┬───────────────────────────┬─────────────┘
                │ dispatches by modelType    │ drives ALL files through
        ┌───────▼─────────┐        ┌─────────▼──────────────┐
        │ DownloadProvider │        │  backgroundDownloadSvc  │  ← the proven native, resumable
        │  per modelType   │        │  startDownload() as an  │     downloader (one mechanism)
        │  • files(spec)   │        │  N-FILE GROUP           │
        │  • finalize()    │        └─────────────────────────┘
        │  text/image/stt/tts (thin: URLs in, register out) │
        └───────────────────────────────────────────────────┘
```

### Contracts

```ts
interface ModelDownload {            // one uniform view, any type/backend
  id; modelType: 'text'|'image'|'stt'|'tts';
  name; sizeBytes; bytesDownloaded; progress;            // 0..1
  status: 'queued'|'downloading'|'completed'|'error'|'paused';
  filePath?; error?;
}

interface DownloadProvider {         // each domain implements ONE; knows its URLs + how to install
  readonly modelType;
  files(spec): DownloadFile[];       // 1..N files to fetch (generalises text's main+mmproj)
  finalize(group): Promise<...>;     // move + register into the domain's store
  // list/cancel/retry/start are the SERVICE's job, not the provider's
}
```

The service generalises TEXT's main+mmproj (2-file) pairing into an **N-file download group** with **persisted per-file completion**, all via `startDownload()`. Image multi-file, STT, and Kokoro stop being special — they become file lists + a finalize step.

## Migration plan (staged; each ships + is device-verifiable, behavior-neutral for working paths)

1. **`ModelDownloadService` aggregator seam (read + control over existing paths).** Wrap today's four sources behind the uniform `list()/subscribe()/cancel()/retry()/delete()`. Move the DM's per-type branching INTO providers. **No change to underlying downloads** → behavior-neutral, low risk. Side effect: the in-progress **Kokoro download becomes visible in the DM** (the reported bug) for free. *Tests: provider list/cancel/delete; DM renders identically.*
2. **N-file group download on the native path.** Generalise main+mmproj → N files with persisted per-file state. Migrate **image multi-file** off the in-process loop onto group `startDownload()`. *Fixes image stuck-on-kill. Device-verify.*
3. **Migrate STT** (both paths, esp. the RNFS `downloadFromUrl`) onto the group service. *Kills the non-resumable path.*
4. **TTS Kokoro adapter** — route its assets through `startDownload()`, or wrap executorch's fetcher with the same retry/resume/cancel semantics. (Hardest; executorch fetcher is a black box.)
5. **Native failure-mode fixes** (the direct stuck-for-days causes): iOS resume-not-fail on orphans; persistent progress polling (not screen-tied); attach JS listeners before any completion can fire; cascade multi-file errors to the parent; clean partial files on cancel.

Tests at each stage: unit (provider contracts, the group state machine, status mapping) + integration (start→progress→complete, app-kill→resume, cancel, retry, multi-file partial failure). Behavior-neutral vs today for the TEXT path (the reference) — verified before deleting the old stitching.

## Non-goals
- Not rewriting the native downloader — reusing `startDownload()` as-is (then hardening its known failure modes in stage 5).
- Not changing model *storage* formats or the model stores' public shape (providers adapt to them).
