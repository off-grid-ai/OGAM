/**
 * Opt-in analytics from Auto Setup (docs/ANALYTICS.md, Rules + Consent).
 *
 * SPEC (OGAM user's view): analytics is off by default. A person who passes Auto Setup without
 * ticking "Share anonymous stats and crash reports" and then chats sends nothing to PostHog. A
 * person who ticks it sends `analytics_opted_in` (source `setup`) and a `generation_finished` for
 * the reply, and neither their prompt nor the reply ever leaves the device.
 *
 * The real App runs as a store build. Only device boundaries are faked; the PostHog endpoint is
 * faked at `fetch`, and what reaches it is the terminal artifact (the network is the surface).
 */
import {
  launchApp,
  openNewChat,
  passOnboarding,
  restoreBuildFlavor,
  sendMessage,
  sendToBackground,
  type AnalyticsApp,
} from '../../harness/analyticsApp';

jest.unmock('@react-navigation/native');

const PROMPT = 'plan my sister birthday at the lake house';
const REPLY = 'Book the lake house for Saturday and invite the cousins.';

let app: AnalyticsApp | undefined;

afterEach(async () => {
  await require('../../../src/services/generationService').generationService.stopGeneration();
  app?.view.unmount();
  // Let the client's last flush land on the fake endpoint before the endpoint goes away.
  await new Promise(resolve => setTimeout(resolve, 50));
  app?.endpoint.restore();
  app = undefined;
  restoreBuildFlavor();
});

it('a default install sends nothing to PostHog through Auto Setup and a chat', async () => {
  app = await launchApp({ release: true });
  await passOnboarding(app, false);
  await openNewChat(app);
  await sendMessage(app, PROMPT, REPLY);
  await sendToBackground(app);

  expect(app.view.getByText(REPLY)).toBeTruthy();
  // Give a would-be flush every chance to happen before asserting that none did.
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(app.endpoint.urls).toEqual([]);
});

it('ticking the Auto Setup row sends opt-in and the reply outcome, never the chat', async () => {
  app = await launchApp({ release: true });
  await passOnboarding(app, true);
  // Opting in alone does not chat; nothing about a reply exists yet.
  expect(app.endpoint.named('generation_finished')).toEqual([]);
  await openNewChat(app);
  await sendMessage(app, PROMPT, REPLY);
  await sendToBackground(app);

  const endpoint = app.endpoint;
  await app.rtl.waitFor(() => expect(endpoint.named('generation_finished')).toHaveLength(1));
  expect(endpoint.named('analytics_opted_in').map(e => e.properties.source)).toEqual(['setup']);

  const finished = endpoint.named('generation_finished')[0].properties;
  expect(finished).toMatchObject({ modality: 'text', engine: 'llama.cpp', outcome: 'done', platform: 'android' });
  // The public repo, never the file name.
  expect(finished.model).toBe('unsloth/Qwen3-0.6B-GGUF');
  expect(endpoint.named('message_sent')[0].properties).toMatchObject({ has_image: false, has_document: false });

  // Only the events docs/ANALYTICS.md lists: none of the SDK's own lifecycle events, whose
  // "Application Opened" carries the deep link the app was opened with.
  const listed = new Set([
    'app_opened', 'app_backgrounded', '$screen', 'analytics_opted_in', 'model_loaded',
    'generation_finished', 'chat_created', 'message_sent', 'features_snapshot',
    'flow_started', 'flow_step', 'flow_finished', 'model_selected', 'first_message', 'session_summary',
    'usage_snapshot',
  ]);
  expect(endpoint.events.map(e => e.event).filter(name => !listed.has(name))).toEqual([]);
  // Only event batches: no flags, no remote config, no surveys.
  expect(endpoint.urls.every(url => url === 'https://eu.i.posthog.com/batch/')).toBe(true);
  // Never the chat, never a file name.
  const sent = endpoint.bodies.join('\n');
  expect(sent).not.toContain('lake house');
  expect(sent).not.toContain('cousins');
  expect(sent).not.toContain('small.gguf');
});
