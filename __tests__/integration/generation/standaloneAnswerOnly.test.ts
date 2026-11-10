/**
 * A one-shot rewrite (video prompt, image prompt, storyboard) keeps the model's answer, never its reasoning.
 *
 * SPEC (community report, 2026-11-03): "<think> …" showed as a clip's title in the bottom sheet and
 * elsewhere. generateStandalone asks the model not to think, yet some models reason anyway; the video
 * path took the raw reply as the clip's prompt, and the title is cut from the prompt.
 *
 * Everything we own runs: activeModelService loads the text model, generateStandalone and llmService
 * build and parse the request. Device leaf only: llama.rn answers with the text a thinking model sends.
 */
import { setupChatScreen } from '../../harness/chatHarness';

async function rewrite(reply: string): Promise<string> {
  const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
  h.boundary.llama!.scriptCompletion({ text: reply });
  const { generateStandalone } = require('../../../src/services/engines');
  return generateStandalone([
    { id: 's', role: 'system', content: 'Rewrite the request as one short video prompt.', timestamp: 0 },
    { id: 'u', role: 'user', content: 'a lighthouse at night', timestamp: 0 },
  ]);
}

it('a reply that reasons first returns only the prompt after the reasoning', async () => {
  expect(await rewrite('<think>The user wants a calm night scene.</think>A lighthouse beam sweeps a dark sea.'))
    .toBe('A lighthouse beam sweeps a dark sea.');
});

it('a reply cut off mid-thought returns nothing, so the caller keeps the person\'s own prompt', async () => {
  expect(await rewrite('<think>The user wants a calm night scene, so I should')).toBe('');
});

it('a plain reply is returned as it is', async () => {
  expect(await rewrite('A lighthouse beam sweeps a dark sea.')).toBe('A lighthouse beam sweeps a dark sea.');
});
