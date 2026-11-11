import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Remembers when this phone was last backed up, so Atlas can say so and nudge when it has been a while.
 * A backup needs the person to choose where the file goes (Atlas has no standing access to your storage),
 * so this reminds instead of backing up by itself. It is a per-phone note: not in backups, not synced.
 */
interface BackupReminderState {
  /** When the first reminder clock started (the first launch with this feature). */
  since: number;
  lastBackupAt: number | null;
  snoozedUntil: number;
  markBackedUp: () => void;
  snooze: (days: number) => void;
}

const DAY = 864e5;
/** Days after a backup (or after first use) before the reminder appears. */
export const REMIND_AFTER_DAYS = { afterBackup: 14, firstBackup: 7 };

export const useBackupReminder = create<BackupReminderState>()(persist((set) => ({
  since: Date.now(),
  lastBackupAt: null,
  snoozedUntil: 0,
  markBackedUp: () => set({ lastBackupAt: Date.now(), snoozedUntil: 0 }),
  snooze: (days) => set({ snoozedUntil: Date.now() + days * DAY }),
}), { name: 'atlas-backup-reminder', storage: createJSONStorage(() => AsyncStorage) }));

/** True when the reminder should show: long enough since the last backup (or since first use), and not snoozed. */
export function backupDue(s: Pick<BackupReminderState, 'since' | 'lastBackupAt' | 'snoozedUntil'>, now = Date.now()): boolean {
  if (now < s.snoozedUntil) return false;
  return s.lastBackupAt === null
    ? now - s.since >= REMIND_AFTER_DAYS.firstBackup * DAY
    : now - s.lastBackupAt >= REMIND_AFTER_DAYS.afterBackup * DAY;
}

/** "3 days ago", "today", or "never" for the Settings line. */
export function lastBackupText(lastBackupAt: number | null, now = Date.now()): string {
  if (lastBackupAt === null) return 'No backup made on this phone yet';
  const days = Math.floor((now - lastBackupAt) / DAY);
  return days <= 0 ? 'Last backup: today' : days === 1 ? 'Last backup: yesterday' : `Last backup: ${days} days ago`;
}
