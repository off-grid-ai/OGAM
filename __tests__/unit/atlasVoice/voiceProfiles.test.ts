const mockNative = {
  setNeuralVoice: jest.fn(async () => 8),
  setRate: jest.fn(async () => true),
  speak: jest.fn(async () => true),
  speakIn: jest.fn(async () => true),
  warmUp: jest.fn(async () => true),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
// neural.ts reads NativeModules.AtlasTts when it is first loaded.
require('react-native').NativeModules.AtlasTts = mockNative;
const { useVoiceProfiles, profileForConversation, profileForMessage } = require('../../../src/atlasVoice/profiles');
const { loadVoiceForSpeech, restoreSavedVoice, selectVoice, NEURAL_VOICES, KITTEN_SPEAKERS } = require('../../../src/atlasVoice/neural');
const { useAtlasVoiceStore } = require('../../../src/atlasVoice/store');
const { useChatStore } = require('../../../src/stores/chatStore');
const { useAgentStore } = require('../../../src/stores/agentStore');

describe('KittenTTS catalogue', () => {
  it('offers the Nano and Mini models with eight built-in voices', () => {
    const ids = NEURAL_VOICES.map((v: any) => v.id);
    expect(ids).toEqual(expect.arrayContaining(['kitten-nano-en', 'kitten-mini-en']));
    expect(KITTEN_SPEAKERS).toHaveLength(8);
    expect(NEURAL_VOICES.find((v: any) => v.id === 'kitten-nano-en')?.speakers).toBe(KITTEN_SPEAKERS);
  });
});

describe('voice profiles', () => {
  beforeEach(() => {
    useVoiceProfiles.setState({ profiles: [] });
    mockNative.setNeuralVoice.mockClear();
  });

  it('saves, renames and removes named profiles', () => {
    const p = useVoiceProfiles.getState().addProfile({ name: ' Coach ', voiceId: 'kitten-nano-en', sid: 3, rate: 1.25 });
    expect(p.name).toBe('Coach');
    useVoiceProfiles.getState().renameProfile(p.id, 'Calm coach');
    expect(useVoiceProfiles.getState().profiles[0].name).toBe('Calm coach');
    useVoiceProfiles.getState().removeProfile(p.id);
    expect(useVoiceProfiles.getState().profiles).toHaveLength(0);
  });

  it("resolves the answering agent's profile from a conversation or message", () => {
    const p = useVoiceProfiles.getState().addProfile({ name: 'Narrator', voiceId: 'kitten-mini-en', sid: 1, rate: 1 });
    const agentId = useAgentStore.getState().agents[0].id;
    useAgentStore.getState().updateAgent(agentId, { voiceProfileId: p.id });
    useChatStore.setState({ conversations: [
      { id: 'c1', agentId, messages: [{ id: 'm1', role: 'assistant', content: 'hi', timestamp: 0 }] } as any,
      { id: 'c2', messages: [{ id: 'm2', role: 'assistant', content: 'hi', timestamp: 0 }] } as any,
    ] });
    expect(profileForConversation('c1')?.id).toBe(p.id);
    expect(profileForMessage('m1')?.id).toBe(p.id);
    expect(profileForConversation('c2')).toBeNull();
    expect(profileForMessage('missing')).toBeNull();
  });

  it('switches to an agent voice without changing the saved voice, and restores it', async () => {
    await selectVoice('kokoro-en', 2);
    mockNative.setNeuralVoice.mockClear();
    await loadVoiceForSpeech('kitten-nano-en', 5);
    await loadVoiceForSpeech('kitten-nano-en', 5); // already loaded: no reload
    expect(mockNative.setNeuralVoice).toHaveBeenCalledTimes(1);
    expect(useAtlasVoiceStore.getState().neuralVoice).toBe('kokoro-en');
    await restoreSavedVoice();
    expect(mockNative.setNeuralVoice).toHaveBeenLastCalledWith('kokoro-en', 2, { accent: '', depth: 1 });
  });
});
