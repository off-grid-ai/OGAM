/**
 * Mic permission timing, on a real phone: the OS asks for the microphone when the person taps the
 * mic - never just because a chat opened.
 *
 * jest proves the app calls the non-prompting check on open and the prompting request on tap, against
 * a fake permission module. Only the phone shows whether the OS alert actually appears, and when.
 *
 *   node scripts/e2e/mic-permission-journey.mjs --platform ios|android|both
 *
 * What it RESETS: the app's microphone permission, back to "not determined" -
 *   iOS      XCUIApplication.resetAuthorizationStatusForResource(microphone) through WDA (iOS kills
 *            the app as part of it; the journey relaunches it). Nothing else about the app changes.
 *   Android  pm revoke RECORD_AUDIO + clear the user-set/user-fixed flags, then restart the app.
 * It leaves the permission GRANTED at the end (it presses Allow), which is how a person who uses the
 * mic has it.
 *
 * Steps (snapshots before/after each):
 *   reset        permission back to undetermined, app relaunched.
 *   open-chat    a new chat opens and stays up for 4s with NO OS permission alert on screen, and the
 *                mic is not shown as "Microphone access is off".
 *   tap-mic      tapping the mic raises the OS microphone alert.
 *   allow        pressing Allow starts recording (the composer shows the recording state).
 *   cleanup      stop recording.
 */
import { openNewChat, runJourney, sleep } from './device-journey.mjs';

/** Is the composer recording? Read from what the person sees: the mic's label or the hint. */
async function isRecording(c) {
  const labels = (await c.labels()).map((l) => l.trim());
  return labels.some((l) => ['Stop voice recording', 'tap-to-stop-hint', 'recording-hint', 'Tap mic to stop'].includes(l));
}

await runJourney('mic-permission', async (phone, run) => {
  const c = phone.client;

  await run.step(phone, 'reset', async () => {
    await phone.resetMicPermission();
    await sleep(8_000);
    // An alert left over from anything else would make every later read ambiguous.
    const stray = await phone.systemAlert();
    if (stray) throw new Error(`an OS alert is already up after relaunch: ${stray.text}`);
    return `microphone permission reset (${await phone.micPermissionState()})`;
  });

  await run.step(phone, 'open-chat', async () => {
    await openNewChat(phone);
    // Long enough for any on-mount permission request to have surfaced.
    for (let i = 0; i < 4; i += 1) {
      const alert = await phone.systemAlert();
      if (alert) throw new Error(`opening a chat raised an OS alert before any mic tap: "${alert.text}"`);
      await sleep(1_000);
    }
    const labels = (await c.labels()).map((l) => l.trim());
    if (labels.includes('Microphone access is off') || labels.includes('voice-record-button-mic-denied')) {
      throw new Error('the mic reads "Microphone access is off" while the permission is merely undetermined');
    }
    if (!labels.includes('Start voice recording') && !labels.includes('voice-record-button')) {
      throw new Error('no mic button in the composer');
    }
    return 'no OS alert on chat open; mic offered';
  });

  let alertText = '';
  await run.step(phone, 'tap-mic', async () => {
    const mic = (await c.findByLabel('Start voice recording')) ?? (await c.findByLabel('voice-record-button'));
    await c.tap(mic.center.x, mic.center.y);
    const alert = await c.waitFor(async () => phone.systemAlert(), {
      label: 'the OS microphone permission alert after tapping the mic',
      timeoutMs: 15_000,
      intervalMs: 500,
    });
    alertText = alert.text;
    if (!/microphone|record audio/i.test(alert.text)) {
      throw new Error(`an OS alert appeared, but not the microphone one: "${alert.text}"`);
    }
    return `alert: "${alert.text.replace(/\s+/g, ' ').slice(0, 140)}" buttons: ${alert.buttons.join(' / ')}`;
  });

  await run.step(phone, 'allow', async () => {
    await phone.allowSystemAlert();
    await c.waitFor(async () => !(await phone.systemAlert()), { label: 'the alert to close', timeoutMs: 10_000 });
    // Some builds need a second tap after the grant; a person would tap again, so does the journey.
    const started = await c
      .waitFor(async () => isRecording(c), { label: 'recording to start', timeoutMs: 15_000 })
      .then(() => 'recording started on the same tap')
      .catch(() => null);
    if (started) return `${started} (granted: ${await phone.micPermissionState()})`;
    throw new Error(`Allow was pressed ("${alertText.slice(0, 60)}") but recording did not start`);
  });

  await run.step(phone, 'cleanup', async () => {
    const stop = await c.findByLabel('Stop voice recording');
    if (stop) await c.tap(stop.center.x, stop.center.y);
    await c.waitFor(async () => !(await isRecording(c)), { label: 'recording to stop', timeoutMs: 20_000 });
    // Let any transcription settle so the next journey starts from a quiet composer.
    await c.waitForGone('Transcribing...', { timeoutMs: 120_000 }).catch(() => undefined);
    return 'recording stopped';
  });
});
