/**
 * A voice question hands the floor to the assistant when it is captured. A tester asked a question in
 * voice mode and the mic button stopped answering until they left the chat and came back: the send ended
 * with no reply ever ready, so nothing handed the floor back.
 *
 * Drives the REAL handleSendFn (makeGenDeps + real stores) and the real voice session. The phone is the
 * native boundary.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { makeGenDeps } from '../../harness/genDeps';

type Session = typeof import('../../../src/services/voiceSession')['voiceSession'];

let voiceSession: Session;
let handleSendFn: (deps: unknown, call: unknown) => Promise<void>;

beforeEach(() => {
  installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  ({ voiceSession } = require('../../../src/services/voiceSession'));
  ({ handleSendFn } = require('../../../src/screens/ChatScreen/useChatGenerationActions'));
  voiceSession._resetForTesting();
  // The person taps the mic, speaks, and the question is captured: the assistant has the floor.
  voiceSession.dispatch('userStart');
  voiceSession.dispatch('turnCaptured');
  expect(voiceSession.current()).toMatchObject({ state: 'speak', phase: 'transcribing' });
});

const send = (deps: unknown, startGeneration: () => Promise<void>) =>
  handleSendFn(deps, { text: 'what is the weather', startGeneration, setDebugInfo: () => {} });

describe('a voice question that gets no reply', () => {
  it('hands the floor back when no model can answer, so the next tap starts the mic', async () => {
    const { deps, captured } = makeGenDeps({ hasActiveModel: false });
    await send(deps, async () => {});
    expect(captured.alerts).toHaveLength(1);
    expect(voiceSession.current().state).toBe('stopped');
  });

  it('hands the floor back when the reply fails before a word arrives', async () => {
    const { deps } = makeGenDeps();
    await expect(
      send(deps, async () => { throw new Error('This model needs more memory than is free'); }),
    ).rejects.toThrow('more memory');
    expect(voiceSession.current().state).toBe('stopped');
  });
});

describe('a voice question that gets a reply', () => {
  it('keeps the floor while the reply is being heard', async () => {
    const { deps } = makeGenDeps();
    // The first token makes the reply ready, as the chat store does when it streams.
    await send(deps, async () => { voiceSession.dispatch('replyReady'); });
    expect(voiceSession.current()).toMatchObject({ state: 'speak', phase: 'talking' });
  });
});
