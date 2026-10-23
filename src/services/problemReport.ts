/**
 * Report a problem (docs/ANALYTICS.md): send the debug log to support. Works whether or not
 * analytics is on. The person has already seen the log in the Debug Logs view before this runs.
 *
 * No mail-composer library is installed, so this opens the system share sheet: Mail is one of its
 * targets. iOS attaches the log file; Android's share sheet takes text only, so the log's most
 * recent part goes in the message.
 */
import { Platform, Share } from 'react-native';
import RNFS from 'react-native-fs';
import { flushDebugLogNow, getDebugLogPath } from '../utils/debugLogFile';
import { SUPPORT_EMAIL } from '../utils/supportEmail';
import { appBuildLabel, appVersion } from '../utils/appVersion';
import { track } from './analytics/analytics';

/** Android share text stays well under the platform's transaction limit. */
const MAX_INLINE_LOG_CHARS = 100_000;

async function readLog(path: string): Promise<string | null> {
  try {
    if (!(await RNFS.exists(path))) return null;
    return await RNFS.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function sendProblemReport(): Promise<void> {
  await flushDebugLogNow();
  const path = getDebugLogPath();
  const log = await readLog(path);
  const header =
    `To: ${SUPPORT_EMAIL}\n${appBuildLabel()}\n\nWhat went wrong:\n\n`;
  const content = Platform.OS === 'ios' && log !== null
    ? { message: header, url: `file://${path}` }
    : { message: log ? `${header}---\n${log.slice(-MAX_INLINE_LOG_CHARS)}` : header };
  track('problem_reported');
  await Share.share(
    { title: 'Report a problem', ...content },
    { subject: `[Problem] Off Grid AI v${appVersion()}` },
  );
}
