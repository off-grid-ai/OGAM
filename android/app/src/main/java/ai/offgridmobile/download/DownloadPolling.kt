package ai.offgridmobile.download

import androidx.work.WorkInfo

/**
 * Pure helpers for [DownloadManagerModule.startProgressPolling].
 * Extracted so zombie-detection rules are unit-testable without Room/WorkManager.
 */
internal object DownloadPolling {
    fun isZombieWorkStates(states: List<WorkInfo.State>): Boolean =
        states.isEmpty() || states.all {
            it == WorkInfo.State.CANCELLED || it == WorkInfo.State.FAILED
        }
}
