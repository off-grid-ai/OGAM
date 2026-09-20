# Pending Fixes

Issues identified but not yet applied to code. Address before or alongside the next release.

---

## ~~1. SQLiteException not caught in `startProgressPolling`~~ ✅ Fixed in `fix/android-download-zombie-polling`


**File:** `android/app/src/main/java/ai/offgridmobile/download/DownloadManagerModule.kt`

**Problem:**
Room opens the database lazily — the actual file open (and migration) happens on the first DAO call, not on `build()`. The first DAO call in `startProgressPolling` is:

```kotlin
downloadDao.getAllDownloads().first().filter { ... }
```

If `MIGRATION_2_3` SQL fails for any reason (e.g. disk corruption, unusual SQLite build), a `SQLiteException` throws here. Unlike every other `@ReactMethod` in the module, `startProgressPolling` has no `try/catch` because it has no `Promise` to reject. The uncaught exception propagates through `SupervisorJob` to the thread's uncaught exception handler — **crash**.

**Fix:**
Wrap the `scope.launch` body in a `try { ... } catch (_: Exception) { }`. Failure is acceptable here — polling is best-effort. Downloads won't show live progress but the app keeps running.

```kotlin
fun startProgressPolling() {
    scope.launch {
        try {
            // ... existing body ...
        } catch (_: Exception) {
            // DB unavailable — polling skipped, no crash
        }
    }
}
```

**Note:** `fallbackToDestructiveMigration()` only handles *missing migration path* errors. It does not catch SQL errors inside a migration that Room did find. So `fallbackToDestructiveMigration` alone is not enough protection here.

---

## ~~2. Zombie download entries after app update~~ ✅ Fixed in `fix/android-download-zombie-polling`


**File:** `android/app/src/main/java/ai/offgridmobile/download/DownloadManagerModule.kt`

**Problem:**
After an app update, WorkManager may cancel or drop tasks that were running before the update (e.g. if the worker class changed). The Room DB still has those rows as `QUEUED` or `RUNNING`. `startProgressPolling` registers WorkManager LiveData observers for them. When the LiveData fires:

- `WorkInfo.State.CANCELLED` → observer removes itself, emits nothing to JS → entry stays stuck forever as `pending` / `running` in the download manager.
- Empty list (WorkManager has no record of the task) → `firstOrNull() ?: return@Observer` → silently ignored → same result.

The user sees ghost entries with no progress that never resolve.

**Fix:**
In `startProgressPolling`, before registering an observer, query WorkManager synchronously for each active DB row. If the task is missing, cancelled, or failed, mark it `FAILED` in the DB and emit an error event to JS so the UI shows a retry button.

```kotlin
for (download in active) {
    val workInfos = withContext(Dispatchers.IO) {
        workManager.getWorkInfosForUniqueWork(WorkerDownload.workName(download.id)).get()
    }
    val isZombie = workInfos.isEmpty() || workInfos.all {
        it.state == WorkInfo.State.CANCELLED || it.state == WorkInfo.State.FAILED
    }
    if (isZombie) {
        withContext(Dispatchers.IO) {
            downloadDao.updateStatus(download.id, DownloadStatus.FAILED, DownloadReason.DOWNLOAD_INTERRUPTED)
        }
        DownloadEventBridge.error(
            download.id, download.fileName, download.modelId ?: "",
            DownloadReason.messageFor(DownloadReason.DOWNLOAD_INTERRUPTED) ?: "Download was interrupted.",
            DownloadReason.DOWNLOAD_INTERRUPTED,
        )
    } else {
        registerObserver(download.id)
    }
}
```

**Note:** This also benefits from Fix #1 (try/catch) since this block adds more DAO calls.

---

## Dependencies between fixes

Fix #2 should be applied at the same time as Fix #1. Fix #2 adds DAO calls inside `startProgressPolling`; without Fix #1's try/catch, those calls are also unprotected.

Apply together in one commit.
