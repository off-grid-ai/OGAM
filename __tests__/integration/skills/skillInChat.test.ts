/**
 * A skill the person installed shapes the chat: the real generation flow adds its instructions to the system prompt
 * when the message fits it (or is called by name), and leaves the prompt alone otherwise. The llama fake records what was sent.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { makeGenDeps } from '../../harness/genDeps';

describe('skills in a chat turn', () => {
  it('sends the matching skill\'s instructions to the model, and nothing for an unrelated message', async () => {
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const { llmService } = require('../../../src/services/llm');
    const { hardwareService } = require('../../../src/services/hardware');
    const { startGenerationFn } = require('../../../src/screens/ChatScreen/useChatGenerationActions');
    const { useChatStore } = require('../../../src/stores');
    const { useSkills } = require('../../../src/skills/skillsStore');
    const { parseSkill } = require('../../../src/skills/parseSkill');

    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();
    await llmService.loadModel('/models/small.gguf');
    useSkills.setState({ skills: [] });
    useSkills.getState().add(parseSkill('---\nname: pirate-talk\ndescription: Answer like a pirate when asked for pirate style or sea stories.\n---\nAlways answer as a pirate and end with "Arr!".'));

    const send = async (text: string) => {
      const convId = useChatStore.getState().createConversation('txt', 't');
      useChatStore.getState().addMessage(convId, { role: 'user', content: text });
      const { deps } = makeGenDeps({ activeConversationId: convId });
      boundary.llama!.calls.completion.length = 0;
      boundary.llama!.scriptCompletion({ text: 'ok' });
      await startGenerationFn(deps, { targetConversationId: convId, messageText: text, setDebugInfo: () => {} });
      return JSON.stringify(boundary.llama!.calls.completion.map((c: unknown[]) => (c[0] as { messages?: unknown }).messages));
    };

    expect(await send('/pirate-talk tell me about the moon')).toContain('Always answer as a pirate');
    expect(await send('Tell me a pirate style sea story')).toContain('Always answer as a pirate');
    expect(await send('What is the capital of France?')).not.toContain('Always answer as a pirate');
    useSkills.getState().setEnabled('pirate-talk', false);
    expect(await send('/pirate-talk tell me about the moon')).not.toContain('Always answer as a pirate');
  });
});
