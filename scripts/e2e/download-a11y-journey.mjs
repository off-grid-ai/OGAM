/**
 * Download buttons, as a screen reader meets them, on a real phone.
 *
 * jest checks the RN props: every download button carries accessibilityLabel "Download <model>". It
 * cannot check what the OS accessibility tree makes of them. On iOS an accessible ancestor (a card
 * that is itself a Touchable) turns its whole subtree into ONE VoiceOver element, so a correctly
 * labelled child button can still be unreachable. This journey reads the native tree:
 *   iOS      WDA's XML source: `accessible="true"` marks a VoiceOver element. A button is reachable
 *            when it is accessible AND no ancestor is.
 *   Android  uiautomator's raw dump: a node TalkBack can focus is clickable or focusable; nested
 *            focusable nodes stay individually focusable, so ancestors are reported, not failed.
 *
 *   node scripts/e2e/download-a11y-journey.mjs --platform ios|android|both
 *
 * Surfaces: Text picks + list, a model's detail sizes, Image tab, Speech tab, Voice tab. For each, every
 * element whose testID ends in `-download` (or whose label starts with "Download ") is checked:
 *   own element  - reachable as itself (rule above)
 *   label        - exactly "Download <name>", name not empty and not the generic "model"
 * A surface with NO download button on screen is reported (every model there already downloaded),
 * not passed silently. Writes a11y-<surface>.json per surface with every button found.
 *
 * Read-only: it opens screens and reads trees. It never taps a download button.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { flag, parseXml, runJourney, sleep, toHome, walkXml as walk } from './device-journey.mjs';

/** Every download button in the tree, judged for reachability by the platform's rule. */
function downloadButtons(xml, platform) {
  const found = [];
  for (const node of walk(parseXml(xml))) {
    const a = node.attrs;
    const id = platform === 'ios' ? a.name ?? '' : (a['resource-id'] ?? '').replace(/^.*:id\//, '');
    const label = platform === 'ios' ? a.label ?? '' : a['content-desc'] || a.text || '';
    if (!/-download$/.test(id) && !/^Download /.test(label)) continue;
    if (platform === 'ios' && a.visible === 'false' && a.width === '0') continue;
    const ancestors = [];
    for (let p = node.parent; p && p.tag !== '#root'; p = p.parent) {
      const accessibleAncestor =
        platform === 'ios' ? p.attrs.accessible === 'true' : p.attrs.focusable === 'true' || p.attrs.clickable === 'true';
      if (accessibleAncestor) {
        ancestors.push(platform === 'ios' ? `${p.attrs.name ?? p.tag} "${p.attrs.label ?? ''}"` : `${(p.attrs['resource-id'] ?? '').replace(/^.*:id\//, '')} "${p.attrs['content-desc'] ?? ''}"`);
      }
    }
    const own = platform === 'ios' ? a.accessible === 'true' : a.clickable === 'true' || a.focusable === 'true';
    const reachable = platform === 'ios' ? own && ancestors.length === 0 : own;
    const name = label.replace(/^Download\s*/, '').trim();
    const labelOk = /^Download /.test(label) && name.length > 0 && name.toLowerCase() !== 'model';
    found.push({ id, label, own, reachable, labelOk, accessibleAncestors: ancestors });
  }
  return found;
}

/** Read the tree, and on Android also after scrolling (its dump only holds what is rendered). */
async function collect(phone, scrolls = 2) {
  const c = phone.client;
  const all = new Map();
  for (let i = 0; i <= scrolls; i += 1) {
    for (const b of downloadButtons(await phone.sourceXml(), phone.platform)) all.set(`${b.id}|${b.label}`, b);
    if (phone.platform === 'ios' || i === scrolls) break; // WDA's tree already includes off-screen rows
    const { width, height } = await c.windowSize();
    await c.swipe(width / 2, height * 0.75, width / 2, height * 0.4);
    await sleep(700);
  }
  return [...all.values()];
}

async function judge(run, phone, surface) {
  const buttons = await collect(phone);
  await writeFile(join(run.dir, `a11y-${surface}.json`), JSON.stringify(buttons, null, 2));
  if (!buttons.length) {
    return { surface, note: 'no download button on screen (everything here is downloaded?)', bad: [] };
  }
  const bad = buttons.filter((b) => !b.reachable || !b.labelOk);
  return { surface, buttons, bad };
}

function verdict(result) {
  if (!result.buttons) return result.note;
  if (!result.bad.length) {
    return `${result.buttons.length} button(s) reachable: ${result.buttons.map((b) => `"${b.label}"`).join(', ')}`;
  }
  const lines = result.bad.map(
    (b) =>
      `${b.id || '(no testID)'} "${b.label}" own=${b.own} labelOk=${b.labelOk}` +
      (b.accessibleAncestors.length ? ` hidden inside ${b.accessibleAncestors[0]}` : ''),
  );
  throw new Error(`${result.bad.length}/${result.buttons.length} download button(s) not reachable as themselves: ${lines.join('; ')}`);
}

async function openModelsTab(phone, tab) {
  const c = phone.client;
  await toHome(phone);
  await c.tapWhenReady('models-tab', { timeoutMs: 15_000 });
  await c.waitForLabel('models-screen', { timeoutMs: 15_000 }).catch(() => undefined);
  const testIds = { Voice: 'voice-models-tab', Speech: 'transcription-models-tab' };
  if (testIds[tab]) await c.tapWhenReady(testIds[tab], { timeoutMs: 10_000 });
  else {
    const el = await c.waitForLabel(tab, { timeoutMs: 10_000 });
    await c.tap(el.center.x, el.center.y);
  }
  await sleep(1_500);
}

await runJourney('download-a11y', async (phone, run) => {
  const c = phone.client;
  const surfaces = [];
  // --only text-picks-and-list,model-detail-sizes,image-tab,speech-tab,voice-tab re-runs single surfaces.
  const only = flag('only')?.split(',');
  const step = (name, fn) =>
    only && !only.includes(name)
      ? undefined
      : run.step(phone, name, async () => verdict(await fn())).catch((error) => surfaces.push({ name, error: error.message }));

  await step('text-picks-and-list', async () => {
    await openModelsTab(phone, 'Text');
    return judge(run, phone, 'text');
  });

  await step('model-detail-sizes', async () => {
    await openModelsTab(phone, 'Text');
    // The first catalog card that is NOT already downloaded has download buttons in its sizes.
    const labels = await c.labels();
    const cards = labels.filter((l) => /^model-card-\d+$/.test(l));
    const fresh = cards.find((id) => !labels.includes(`${id}-downloaded`)) ?? cards[0];
    if (!fresh) throw new Error('no model cards on the Text tab');
    await c.scrollAndTap(fresh);
    await c.waitForLabel('model-detail-screen', { timeoutMs: 15_000 }).catch(() => undefined);
    await sleep(1_500);
    const toggle = await c.findByLabel('all-files-toggle');
    if (toggle && /All files/i.test((await c.labels()).join(' '))) {
      await c.tap(toggle.center.x, toggle.center.y);
      await sleep(1_000);
    }
    return judge(run, phone, `detail-${fresh}`);
  });

  await step('image-tab', async () => {
    await openModelsTab(phone, 'Image');
    return judge(run, phone, 'image');
  });

  await step('speech-tab', async () => {
    await openModelsTab(phone, 'Speech');
    return judge(run, phone, 'speech');
  });

  await step('voice-tab', async () => {
    await openModelsTab(phone, 'Voice');
    return judge(run, phone, 'voice');
  });

  if (surfaces.length) console.log(`  ${surfaces.length} surface(s) failed; see a11y-*.json in ${run.dir}`);
});
