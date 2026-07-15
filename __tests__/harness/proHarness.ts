/**
 * proHarness — activate the PRO feature set (audio/voice mode, TTS, MCP, pro screens/settings) in a test,
 * the SAME way the app bootstrap does. Pro features register into core via the slot/hook/screen/settings
 * registries; core renders them by looking those up. Without this, a mounted screen shows only the free
 * shell (e.g. no header text/voice mode toggle, no audio-mode layout), so any real pro user-flow is
 * unreachable.
 *
 * Call AFTER installNativeBoundary() (so it registers into the same fresh module graph the screens read)
 * and BEFORE render(). Idempotent-ish: registering a slot twice just overwrites with the same component.
 *
 * This is the ONE reusable pro seam — voice-mode, TTS, and MCP flow tests all use it instead of hand-
 * registering individual slots per test.
 */
export async function installPro(): Promise<void> {
  // isPro=true → the real bootstrap requires @offgrid/pro and calls pro.activate({...registries}),
  // registering every pro slot (chatInput.modeToggle, chatInput.audioMode, message.speakButton, …).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadProFeatures } = require('../../src/bootstrap/loadProFeatures');
  await loadProFeatures(true);
}
