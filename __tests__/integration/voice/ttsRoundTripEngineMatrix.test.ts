/**
 * ADVERSARIAL voice round-trip: STT transcript -> generation answer -> TTS speaks it,
 * across the TTS-ENGINE axis and the residency canEvict veto (docs/TEST_MATRIX.md
 * §3.2 modality, §3.3 residency × feature — "TTS after STT (voice-mode round trip)
 * across engines").
 *
 * The TTS abstraction (ttsRegistry + TTSEngine interface) is the whole point: adding an
 * engine must require ZERO store changes, and the store must route the SAME speak(text,
 * opts) call to whichever engine is active. So we parametrize a REAL-shaped registry over
 * two engine descriptors with different capabilities:
 *   - streaming engine (kokoro-like): streaming:true, generateAndSave:true
 *   - file engine (outetts-like):     streaming:false, generateAndSave:true
 * and assert the TERMINAL artifact: the exact { text, messageId } the ACTIVE engine
 * received, and the store's currentMessageId lifecycle — proving the answer text (the
 * thing that would have been the STT-transcript-driven model reply) is what got spoken,
 * on EITHER engine.
 *
 * We mock the engine registry at the native boundary only (executorch/kokoro can't run in
 * node); the REAL ttsStore + REAL playbackMachine + REAL residency canEvict veto run on
 * top. Deleting the engine.speak(text,{messageId}) route or the canEvict veto MUST fail.
 */

// ── Parametrized engine descriptors (the TTS-engine axis) ────────────────────
type EngineSpec = { id: string; streaming: boolean };
const ENGINE_SPECS: EngineSpec[] = [
  { id: 'kokoro', streaming: true },
  { id: 'outetts', streaming: false },
];

// A single mutable "active engine" the mock registry hands out; each test installs the
// descriptor under test. `mock`-prefixed so the jest.mock factory may reference it.
type SpeakCall = { text: string; opts: { messageId?: string; speed?: number; voiceId?: string } };
const mockSpeakCalls: SpeakCall[] = [];
let mockActiveEngineId = 'kokoro';
let mockActiveStreaming = true;

const mockTtsEngine = {
  get id() { return mockActiveEngineId; },
  displayName: 'Mock',
  capabilities: {
    get streaming() { return mockActiveStreaming; },
    voiceCloning: false,
    pauseResume: true,
    generateAndSave: true,
    peakRamMB: 100,
  },
  getPhase: jest.fn(() => 'ready' as const),
  on: jest.fn(() => jest.fn()),
  off: jest.fn(),
  once: jest.fn(() => jest.fn()),
  isSupported: jest.fn(() => true),
  initialize: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  destroy: jest.fn().mockResolvedValue(undefined),
  getRequiredAssets: jest.fn(() => [{ id: 'a', label: 'A', url: '', sizeBytes: 100 * 1024 * 1024, filename: 'a' }]),
  checkAssetStatus: jest.fn().mockResolvedValue([]),
  downloadAssets: jest.fn().mockResolvedValue(undefined),
  deleteAssets: jest.fn().mockResolvedValue(undefined),
  getOverallDownloadProgress: jest.fn(() => 1),
  isFullyDownloaded: jest.fn(() => true),
  getBridgeComponent: jest.fn(() => null),
  getVoices: jest.fn(() => [{ id: '0', label: 'Default', metadata: {} }]),
  getActiveVoice: jest.fn(() => ({ id: '0', label: 'Default', metadata: {} })),
  setVoice: jest.fn().mockResolvedValue(undefined),
  speak: jest.fn(async (text: string, opts: SpeakCall['opts']) => { mockSpeakCalls.push({ text, opts }); }),
  generateAndSave: jest.fn(async (_t: string, conversationId: string, messageId: string) => ({
    filePath: `/cache/${conversationId}/${messageId}.pcm`,
    durationSeconds: 1.5,
    waveformData: new Array(200).fill(0.2),
  })),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  setSpeed: jest.fn(),
};

jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: {
    register: jest.fn(),
    has: jest.fn(() => true),
    getEngine: jest.fn(() => mockTtsEngine),
    setActiveEngine: jest.fn().mockResolvedValue(mockTtsEngine),
    getActiveEngine: jest.fn(() => mockTtsEngine),
    getActiveEngineId: jest.fn(() => mockActiveEngineId),
    getRegisteredIds: jest.fn(() => ['kokoro', 'outetts']),
  },
  OuteTTSEngine: class {},
}));

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { useTTSStore } from '../../../pro/audio/ttsStore';
import { modelResidencyManager } from '@offgrid/core/services/modelResidency';

const getState = () => useTTSStore.getState();

const resetStore = (engineId: string) => {
  useTTSStore.setState({
    phase: 'ready', currentMessageId: null, currentAmplitude: 0, playbackElapsed: 0,
    playbackStatus: 'idle', playSessionId: 0, error: null, isReady: true,
    isDownloading: false, isLoading: false, isSpeaking: false, isPaused: false,
    isGeneratingAudio: false, assets: [], overallDownloadProgress: 1,
    voices: [{ id: '0', label: 'Default', metadata: {} }], activeVoiceId: '0',
    audioCacheSizeMB: 0,
    settings: { interfaceMode: 'chat', enabled: true, speed: 1.0, engineId, voiceByEngine: {} },
  });
};

// ═════════════════════════════════════════════════════════════════════════════
describe.each(ENGINE_SPECS)('TTS round-trip — engine=$id (streaming=$streaming)', ({ id, streaming }) => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpeakCalls.length = 0;
    mockActiveEngineId = id;
    mockActiveStreaming = streaming;
    mockTtsEngine.getPhase.mockReturnValue('ready');
    resetStore(id);
    modelResidencyManager._reset();
  });

  it('speaks the MODEL ANSWER (the transcript-driven reply) with its messageId — via the abstraction', async () => {
    // The generation turn produced this assistant reply from the voice transcript.
    const answer = 'The capital of France is Paris.';
    const messageId = 'assistant-turn-1';

    await getState().speak(answer, messageId);

    // TERMINAL: the ACTIVE engine (whichever one) received exactly this text + id.
    // One speak() call, routed through the single uniform entry point.
    expect(mockSpeakCalls).toEqual([{ text: answer, opts: expect.objectContaining({ messageId, speed: 1.0 }) }]);
    // The store cleared the active message on natural completion (no stuck spinner).
    expect(getState().currentMessageId).toBeNull();
  });

  it('two sequential answers each route to the active engine with their own messageId', async () => {
    await getState().speak('first reply', 'm1');
    await getState().speak('second reply', 'm2');

    // TERMINAL: both replies reached the SAME active engine, in order, each with its id.
    expect(mockSpeakCalls).toEqual([
      { text: 'first reply', opts: expect.objectContaining({ messageId: 'm1' }) },
      { text: 'second reply', opts: expect.objectContaining({ messageId: 'm2' }) },
    ]);
    expect(getState().currentMessageId).toBeNull();
  });

  it('a tap while the engine is PREPARING is ignored (no double-speak crash) on either engine', async () => {
    // First speak hangs in the engine, so the store stays in `preparing`.
    mockTtsEngine.speak.mockImplementationOnce((text: string, opts: SpeakCall['opts']) => {
      mockSpeakCalls.push({ text, opts });
      return new Promise<void>(() => { /* never settles */ });
    });
    getState().speak('first reply', 'm1');
    expect(getState().playbackStatus).toBe('preparing');

    // A second tap arrives mid-prepare. The guard drops it — the engine is NOT asked to
    // speak a second time (starting a second run on a loading stream is the crash).
    await getState().speak('second reply', 'm2');

    // TERMINAL: only the first reply ever reached the engine; the mid-prepare tap dropped.
    expect(mockSpeakCalls.map(c => c.text)).toEqual(['first reply']);
    expect(mockSpeakCalls.some(c => c.text === 'second reply')).toBe(false);
  });

  it('audio-mode generateAndSave routes the answer to the active engine and returns its file', async () => {
    useTTSStore.setState({ settings: { ...getState().settings, interfaceMode: 'audio' } });

    const result = await getState().generateAndSave('The answer.', 'conv-9', 'msg-9');

    // TERMINAL: the file the active engine produced for THIS conversation+message.
    expect(mockTtsEngine.generateAndSave).toHaveBeenCalledWith('The answer.', 'conv-9', 'msg-9', expect.any(Object));
    expect(result.path).toBe('/cache/conv-9/msg-9.pcm');
    expect(result.durationSeconds).toBe(1.5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Residency canEvict veto: while TTS is PLAYING, residency must not evict it (the
// audio layer registers canEvict = playbackStatus==='idle'). This is the intersection
// where a mid-answer generation reload would kill the voice mid-word.
describe('TTS residency canEvict veto — never evict a speaking engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    modelResidencyManager._reset();
    modelResidencyManager.setLoadPolicy('balanced');
    mockActiveEngineId = 'kokoro';
    mockActiveStreaming = true;
    resetStore('kokoro');
  });

  it('a memory warning reclaims idle TTS but NOT a playing one', async () => {
    let ttsUnloaded = false;
    // The exact veto the audio layer registers: TTS is evictable only when playback is idle.
    let speaking = true;
    modelResidencyManager.register(
      { key: 'tts', type: 'tts', sizeMB: 100, canEvict: () => !speaking },
      async () => { ttsUnloaded = true; },
    );

    // Playing -> veto holds -> memory warning must NOT unload TTS.
    await modelResidencyManager.handleMemoryWarning();
    expect(ttsUnloaded).toBe(false);
    expect(modelResidencyManager.isResident('tts')).toBe(true);

    // Playback finished -> now idle -> the SAME sidecar is reclaimable.
    speaking = false;
    await modelResidencyManager.handleMemoryWarning();
    expect(ttsUnloaded).toBe(true);
    expect(modelResidencyManager.isResident('tts')).toBe(false);
  });

  it('capacity eviction treats a playing TTS as pinned (a bigger load cannot evict it)', async () => {
    modelResidencyManager.setBudgetOverrideMB(1500);
    let ttsUnloaded = false;
    modelResidencyManager.register(
      { key: 'tts', type: 'tts', sizeMB: 300, canEvict: () => false }, // speaking
      async () => { ttsUnloaded = true; },
    );

    // A text model tries to make room WITHOUT override. TTS is in use -> cannot be evicted
    // -> the load does not fit (balanced, no override won't kill an in-use model).
    const { fits, evicted } = await modelResidencyManager.makeRoomFor(
      { key: 'text', type: 'text', sizeMB: 1400 },
    );

    expect(evicted).not.toContain('tts');
    expect(fits).toBe(false);
    expect(ttsUnloaded).toBe(false);
    expect(modelResidencyManager.isResident('tts')).toBe(true);
  });
});
