import { backupDue, lastBackupText, REMIND_AFTER_DAYS } from '../../src/atlasTools/backupReminder';

const DAY = 864e5;
const now = 100 * DAY;

describe('backup reminder', () => {
  it('waits a week after first use, then two weeks after each backup', () => {
    expect(backupDue({ since: now - 6 * DAY, lastBackupAt: null, snoozedUntil: 0 }, now)).toBe(false);
    expect(backupDue({ since: now - REMIND_AFTER_DAYS.firstBackup * DAY, lastBackupAt: null, snoozedUntil: 0 }, now)).toBe(true);
    expect(backupDue({ since: 0, lastBackupAt: now - 13 * DAY, snoozedUntil: 0 }, now)).toBe(false);
    expect(backupDue({ since: 0, lastBackupAt: now - 14 * DAY, snoozedUntil: 0 }, now)).toBe(true);
  });

  it('stays quiet while snoozed', () => {
    expect(backupDue({ since: 0, lastBackupAt: null, snoozedUntil: now + DAY }, now)).toBe(false);
    expect(backupDue({ since: 0, lastBackupAt: null, snoozedUntil: now - 1 }, now)).toBe(true);
  });

  it('says when the last backup was', () => {
    expect(lastBackupText(null, now)).toBe('No backup made on this phone yet');
    expect(lastBackupText(now - 100, now)).toBe('Last backup: today');
    expect(lastBackupText(now - DAY, now)).toBe('Last backup: yesterday');
    expect(lastBackupText(now - 5 * DAY, now)).toBe('Last backup: 5 days ago');
  });
});
