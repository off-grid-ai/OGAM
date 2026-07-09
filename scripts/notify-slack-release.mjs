#!/usr/bin/env node
// Announce a published release to Slack. Called as the LAST step of each release workflow
// (desktop + mobile android/ios) so a message lands in the release channel on every release.
//
// Single responsibility: read the already-generated release notes + a few env facts and post
// one chat.postMessage. It NEVER fails the release — a missing token, an unreachable Slack, or a
// non-ok response logs a warning and exits 0. The posting logic lives here once; each workflow
// just sets env and runs it.
//
// Delivery (either works; webhook wins if both set):
//   SLACK_WEBHOOK_URL  an Incoming Webhook (channel-bound — no token/scope/channel needed)
//   SLACK_BOT_TOKEN    a Bot User OAuth token (xoxb-…, chat:write) + SLACK_CHANNEL
//   With neither set => no-op, exit 0.
// Content env:
//   PRODUCT          e.g. "Off Grid AI Desktop"
//   VERSION          e.g. "0.0.39-beta.63"
//   CHANNEL_LABEL    "beta" | "stable" (optional, shown as a tag)
//   NOTES_FILE       (default release-notes.md)
//   RELEASE_URL      (optional; default derived from GITHUB_SERVER_URL/GITHUB_REPOSITORY + tag)
import { readFileSync } from 'node:fs';

const warn = (m) => console.warn(`[slack-release] ${m}`);

const webhook = process.env.SLACK_WEBHOOK_URL;
const token = process.env.SLACK_BOT_TOKEN;
if (!webhook && !token) { warn('no SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN set — skipping announcement (no-op).'); process.exit(0); }

const channel = process.env.SLACK_CHANNEL || 'C0AFARY80HJ';
const product = process.env.PRODUCT || 'Off Grid AI';
const version = process.env.VERSION || '';
const label = (process.env.CHANNEL_LABEL || '').trim();
const notesFile = process.env.NOTES_FILE || 'release-notes.md';

const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
const repo = process.env.GITHUB_REPOSITORY || '';
const releaseUrl = process.env.RELEASE_URL || (repo && version ? `${server}/${repo}/releases/tag/v${version}` : '');

// Slack mrkdwn reserves & < > — a raw commit subject containing them (release notes are raw
// commit subjects) would misrender or be read as a <link|mention>. Escape the note body only;
// NOT the intentional <url|label> link line below.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let notes = '';
try { notes = readFileSync(notesFile, 'utf8').trim(); } catch { /* notes optional */ }
// Slack section text caps at 3000 chars; keep well under and never dump a wall.
if (notes.length > 2600) { notes = `${notes.slice(0, 2600)}\n…`; }

const tag = label ? `  \`${label}\`` : '';
const header = `:package:  *${esc(product)}*  \`${version || 'release'}\`${tag}`;
const linkLine = releaseUrl ? `<${releaseUrl}|Download / release page>` : '';
const body = notes ? esc(notes) : '_No release notes generated for this build._';

const blocks = [
  { type: 'section', text: { type: 'mrkdwn', text: header } },
  { type: 'section', text: { type: 'mrkdwn', text: body } },
];
if (linkLine) { blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: linkLine }] }); }

const fallbackText = `${product} ${version} released`;
try {
  if (webhook) {
    // Incoming webhook: channel is fixed by the hook; POST the blocks, expect body "ok".
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text: fallbackText, blocks, unfurl_links: false }),
      signal: AbortSignal.timeout(10000),
    });
    const t = await res.text().catch(() => '');
    if (!res.ok) { warn(`webhook not ok: HTTP ${res.status} ${t}`); process.exit(0); }
    console.log(`[slack-release] announced ${product} ${version} via webhook`);
  } else {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, text: fallbackText, blocks, unfurl_links: false }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { warn(`chat.postMessage not ok: HTTP ${res.status} ${j.error || ''}`); process.exit(0); }
    console.log(`[slack-release] announced ${product} ${version} to ${channel} (ts=${j.ts})`);
  }
} catch (e) {
  warn(`post failed: ${e?.message || e}`);
}
process.exit(0);
