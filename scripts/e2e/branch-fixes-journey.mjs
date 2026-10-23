/**
 * The fixes on release/stable-v55-v115, checked on a real phone where a phone can reach them.
 *
 *   node scripts/e2e/branch-fixes-journey.mjs --platform ios|android|both [--only maker,check,remote,coldnew]
 *     [--maker "Liquid AI"] [--maker-expect LFM]
 *
 * Steps (snapshots before/after each):
 *   maker    Models -> Text -> filters -> Org -> Liquid AI: the list shows curated LFM models
 *            (b87882e74 "A maker filter lists that maker's curated models").
 *   check    Models -> "Check for new models", twice: the second check (nothing changed in between)
 *            says "Up to date" (e76435584). The first answer is recorded, not asserted - a phone that
 *            has not checked for a while may legitimately have news.
 *   remote   Stop pressed while a remote chat request is still being prepared: no reply and no
 *            error bubble appear (f855ccef6). Needs a REACHABLE remote text model in the chat's
 *            model selector; without one the step is SKIPPED with the reason.
 *   coldnew  Cold launch, tap New Chat at once, send: the turn lands in a NEW conversation at the top
 *            of the Chats list, and the previous top conversation is untouched (912dd7930).
 *
 * Data: `coldnew` and `remote` each add one short conversation (marker e2e-...); nothing is deleted.
 */
import {
  flag,
  lastAssistantText,
  literalPattern,
  openNewChat,
  runJourney,
  sendPrompt,
  sleep,
  toHome,
  waitForReply,
} from './device-journey.mjs';

const only = flag('only', 'maker,check,remote,coldnew').split(',');
const maker = flag('maker', 'Liquid AI');
const makerExpect = literalPattern(flag('maker-expect', 'LFM'));
// The maker's curated catalog entry. LFM2.5 8B A1B needs minRamGb 10, so the fit rule hides it on a
// phone that cannot hold it; the step then records that rather than failing.
const makerCurated = flag('maker-curated', 'LFM2.5 8B A1B');

async function openModels(phone) {
  await toHome(phone);
  await phone.client.tapWhenReady('models-tab', { timeoutMs: 15_000 });
  await sleep(1_500);
  const text = await phone.client.waitForLabel('Text', { timeoutMs: 10_000 });
  await phone.client.tap(text.center.x, text.center.y);
  await sleep(1_000);
}

/** The visible model card names (model-card-N carries the name as its label on iOS; Android text). */
async function cardNames(phone) {
  const tree = await phone.client.source();
  const names = [];
  const walk = (node, inCard) => {
    if (!node) return;
    const id = `${node.name ?? ''}`;
    const isCard = /^model-card-\d+$/.test(id);
    if (isCard && node.label) names.push(`${node.label}`.trim());
    if (inCard && !isCard && node.value && !/^model-card/.test(id)) names.push(`${node.value}`.trim());
    (node.children || []).forEach((child) => walk(child, inCard || isCard));
  };
  walk(tree, false);
  return [...new Set(names.filter(Boolean))];
}

/** Tap an element by its exact visible text (chips and pills carry no testIDs). */
async function tapText(phone, text, timeoutMs = 10_000) {
  const el = await phone.client.waitFor(
    async (c) => {
      const found = await c.findByLabel(text);
      return found && found.label.trim().toLowerCase() === text.toLowerCase() ? found : null;
    },
    { label: `"${text}"`, timeoutMs },
  );
  await phone.client.tap(el.center.x, el.center.y);
  return el;
}

await runJourney('branch-fixes', async (phone, run) => {
  const c = phone.client;

  if (only.includes('maker')) {
    await run.step(phone, 'maker-filter', async () => {
      await openModels(phone);
      await c.tapWhenReady('text-filter-toggle', { timeoutMs: 10_000 });
      await sleep(800);
      // The pill reads "Org ▾" (or "Org" when the arrow is a separate glyph).
      const org = (await c.findByLabel('Org ▾')) ?? (await c.findByLabel('Org'));
      if (!org) throw new Error('no "Org" filter pill after opening the filters');
      await c.tap(org.center.x, org.center.y);
      await sleep(800);
      await tapText(phone, maker);
      await sleep(2_500);
      const names = await cardNames(phone);
      const lfm = names.filter((n) => makerExpect.test(n));
      await run.snap(phone, `filtered-${maker}`);
      // Leave the filter as we found it: tap the chip again to clear it.
      await tapText(phone, maker).catch(() => undefined);
      if (!lfm.length) {
        throw new Error(`the ${maker} filter shows no ${makerExpect} model. Cards on screen: ${names.join(' | ') || '(none)'}`);
      }
      const others = names.filter((n) => !makerExpect.test(n) && /model-card|GGUF|\d+B\b/.test(n));
      if (others.length) throw new Error(`the ${maker} filter also lists other makers: ${others.join(', ')}`);
      const curated = names.includes(makerCurated)
        ? `curated "${makerCurated}" listed`
        : `curated "${makerCurated}" NOT listed (too big for this phone's fit rule?)`;
      return `${maker}: ${lfm.join(', ')}; ${curated}`;
    }).catch(() => undefined);
  }

  if (only.includes('check')) {
    await run.step(phone, 'check-for-new-models', async () => {
      await openModels(phone);
      const answers = [];
      for (let i = 0; i < 2; i += 1) {
        await c.tapWhenReady('check-new-models-button', { timeoutMs: 10_000 });
        const title = await c.waitFor(
          async (dev) => {
            const labels = (await dev.labels()).map((l) => l.trim());
            if (!labels.includes('catalog-check-sheet') && !labels.some((l) => /Up to date|new model|Models updated|Couldn.t check/i.test(l))) {
              return null;
            }
            return labels.find((l) => /^(Up to date|\d+ new models?|Models updated|Couldn.t check for new models)$/i.test(l)) ?? null;
          },
          { label: 'the Check for new models answer', timeoutMs: 60_000, intervalMs: 1_000 },
        );
        answers.push(title);
        await run.snap(phone, `check-${i + 1}-${title}`);
        const close = (await c.findByLabel('app-sheet-close')) ?? (await c.findByLabel('Done')) ?? (await c.findByLabel('OK'));
        if (close) await c.tap(close.center.x, close.center.y);
        await sleep(1_200);
      }
      if (!/^Up to date$/i.test(answers[1])) {
        throw new Error(`the second check, with nothing changed since the first, said "${answers[1]}" (first said "${answers[0]}")`);
      }
      return `first: "${answers[0]}", second: "${answers[1]}"`;
    }).catch(() => undefined);
  }

  if (only.includes('remote')) {
    await openNewChat(phone);
    await c.tapWhenReady('model-selector', { timeoutMs: 15_000 });
    const slot = await c.waitForStable('models-row-text');
    await c.tap(slot.center.x, slot.center.y);
    await sleep(4_000);
    const remoteRow = (await c.labels()).find((l) => l.startsWith('remote-text-model-'));
    if (!remoteRow) {
      await run.snap(phone, 'remote-no-server');
      run.skip(
        'remote-stop-before-send',
        'no remote text model is listed in the chat model selector (no reachable server paired/added on this phone)',
      );
      for (let i = 0; i < 3 && (await c.findByLabel('app-sheet-close')); i += 1) {
        await c.tapLabel('app-sheet-close');
        await sleep(700);
      }
    } else {
      await run.step(phone, 'remote-stop-before-send', async () => {
        const row = await c.scrollToLabel(remoteRow);
        await c.tap(row.center.x, row.center.y);
        await sleep(2_000);
        for (let i = 0; i < 3 && (await c.findByLabel('app-sheet-close')); i += 1) {
          await c.tapLabel('app-sheet-close');
          await sleep(700);
        }
        const marker = `e2e-remotestop-${Date.now()}`;
        await sendPrompt(phone, `${marker} write a 300 word poem about rain`);
        // Stop at once, while the request is still being prepared.
        await c.tapWhenReady('stop-button', { timeoutMs: 5_000 });
        await sleep(15_000);
        const reply = await lastAssistantText(phone);
        if (/error|failed|went wrong/i.test(reply)) throw new Error(`Stop before send left an error bubble: ${reply}`);
        if (reply.replace(/[^a-z]/gi, '').length > 40) throw new Error(`a reply arrived after Stop: ${reply.slice(0, 120)}`);
        return `no reply and no error 15s after Stop (${remoteRow})`;
      }).catch(() => undefined);
    }
  }

  if (only.includes('coldnew')) {
    await run.step(phone, 'cold-launch-new-chat', async () => {
      await c.tapWhenReady('chats-tab', { timeoutMs: 15_000 }).catch(async () => {
        await toHome(phone);
        await c.tapWhenReady('chats-tab', { timeoutMs: 15_000 });
      });
      await sleep(1_500);
      const topBefore = (await c.labels()).find((l, i, all) => all[i + 1] === 'conversation-item-0') ?? '';

      await phone.coldLaunch();
      // As fast as a person: the first moment New Chat exists, tap it - while saved chats may
      // still be loading.
      const tappedAt = Date.now();
      await c.tapWhenReady('new-chat-button', { timeoutMs: 30_000, intervalMs: 150 });
      await c.waitForLabel('chat-input', { timeoutMs: 20_000 });
      const sinceLaunch = Date.now() - tappedAt;
      await sleep(1_500);
      const labels = await run.snap(phone, 'chat-after-cold-new');
      if (labels.includes('user-message')) {
        throw new Error('New Chat right after a cold launch opened a chat that already has messages');
      }
      const marker = `e2e-coldnew-${Date.now()}`;
      await sendPrompt(phone, `${marker} reply with the single word ok`);
      await waitForReply(phone, 300_000);
      await toHome(phone);
      await c.tapWhenReady('chats-tab', { timeoutMs: 15_000 });
      await sleep(2_000);
      const list = (await c.labels()).map((l) => l.trim());
      const top = list[list.indexOf('conversation-item-0') - 1] ?? '';
      const second = list[list.indexOf('conversation-item-1') - 1] ?? '';
      if (!top.startsWith(marker)) {
        throw new Error(`the top conversation is not the new one. Top: "${top.slice(0, 100)}"`);
      }
      if (topBefore && !second.startsWith(topBefore.split(',')[0])) {
        throw new Error(
          `the previous top conversation moved or changed. Before: "${topBefore.slice(0, 80)}"; now second: "${second.slice(0, 80)}"`,
        );
      }
      return `new conversation on top (${marker}); previous top still second; chat opened ${sinceLaunch}ms after the New Chat tap`;
    }).catch(() => undefined);
  }
});
