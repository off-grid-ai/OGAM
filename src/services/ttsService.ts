import { initLlama, LlamaContext } from 'llama.rn';
import RNFS from 'react-native-fs';
import { AudioContext, AudioBufferSourceNode } from 'react-native-audio-api';
import logger from '../utils/logger';
import { TTS_BACKBONE_MODEL } from '../constants/ttsModels';

export interface TTSOptions {
  speed?: number;
  voiceId?: string;
}

export interface GeneratedAudio {
  samples: Float32Array;
  durationSeconds: number;
  sampleRate: number;
  /** Downsampled amplitude envelope (~200 points) for waveform visualization */
  waveformData: number[];
}

class TTSService {
  private context: LlamaContext | null = null;
  private isVocoderReady = false;
  private isSpeakingFlag = false;
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private contextLoadPromise: Promise<void> = Promise.resolve();

  // ─── Paths ────────────────────────────────────────────────────────────────

  getModelsDir(): string {
    return `${RNFS.DocumentDirectoryPath}/tts-models`;
  }

  getAudioCacheDir(conversationId: string): string {
    return `${RNFS.DocumentDirectoryPath}/audio-cache/${conversationId}`;
  }

  getAudioFilePath(conversationId: string, messageId: string): string {
    return `${this.getAudioCacheDir(conversationId)}/${messageId}.pcm`;
  }

  getBackbonePath(): string {
    return `${this.getModelsDir()}/${TTS_BACKBONE_MODEL.backboneFile}`;
  }

  getVocoderPath(): string {
    return `${this.getModelsDir()}/${TTS_BACKBONE_MODEL.vocoderFile}`;
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!(await RNFS.exists(dir))) {
      await RNFS.mkdir(dir);
    }
  }

  // ─── Download Status ─────────────────────────────────────────────────────

  async isBackboneDownloaded(): Promise<boolean> {
    return RNFS.exists(this.getBackbonePath());
  }

  async isVocoderDownloaded(): Promise<boolean> {
    return RNFS.exists(this.getVocoderPath());
  }

  async areBothModelsDownloaded(): Promise<boolean> {
    return (await this.isBackboneDownloaded()) && (await this.isVocoderDownloaded());
  }

  async isAudioCached(conversationId: string, messageId: string): Promise<boolean> {
    return RNFS.exists(this.getAudioFilePath(conversationId, messageId));
  }

  async getAudioCacheSizeMB(): Promise<number> {
    const cacheRoot = `${RNFS.DocumentDirectoryPath}/audio-cache`;
    if (!(await RNFS.exists(cacheRoot))) return 0;
    let totalBytes = 0;
    const convDirs = await RNFS.readDir(cacheRoot);
    for (const convDir of convDirs) {
      if (convDir.isDirectory()) {
        const files = await RNFS.readDir(convDir.path);
        for (const file of files) { totalBytes += Number(file.size); }
      }
    }
    return totalBytes / (1024 * 1024);
  }

  async clearAudioCache(): Promise<void> {
    const cacheRoot = `${RNFS.DocumentDirectoryPath}/audio-cache`;
    if (await RNFS.exists(cacheRoot)) {
      await RNFS.unlink(cacheRoot);
    }
  }

  // ─── Download ────────────────────────────────────────────────────────────

  async downloadBackbone(onProgress?: (p: number) => void): Promise<string> {
    await this.ensureDir(this.getModelsDir());
    const dest = this.getBackbonePath();
    if (await RNFS.exists(dest)) {
      return dest;
    }
    const dl = RNFS.downloadFile({
      fromUrl: TTS_BACKBONE_MODEL.backboneUrl,
      toFile: dest,
      progressDivider: 1,
      progress: (res) => onProgress?.(res.bytesWritten / res.contentLength),
    });
    const result = await dl.promise;
    if (result.statusCode !== 200) {
      await RNFS.unlink(dest).catch(() => {});
      throw new Error(`Backbone download failed: HTTP ${result.statusCode}`);
    }
    return dest;
  }

  async downloadVocoder(onProgress?: (p: number) => void): Promise<string> {
    await this.ensureDir(this.getModelsDir());
    const dest = this.getVocoderPath();
    if (await RNFS.exists(dest)) {
      return dest;
    }
    const dl = RNFS.downloadFile({
      fromUrl: TTS_BACKBONE_MODEL.vocoderUrl,
      toFile: dest,
      progressDivider: 1,
      progress: (res) => onProgress?.(res.bytesWritten / res.contentLength),
    });
    const result = await dl.promise;
    if (result.statusCode !== 200) {
      await RNFS.unlink(dest).catch(() => {});
      throw new Error(`Vocoder download failed: HTTP ${result.statusCode}`);
    }
    return dest;
  }

  async deleteModels(): Promise<void> {
    await this.unloadModels();
    const bp = this.getBackbonePath();
    const vp = this.getVocoderPath();
    if (await RNFS.exists(bp)) {
      await RNFS.unlink(bp);
    }
    if (await RNFS.exists(vp)) {
      await RNFS.unlink(vp);
    }
  }

  // ─── Model Lifecycle ─────────────────────────────────────────────────────

  async loadModels(): Promise<void> {
    if (this.context && this.isVocoderReady) {
      return;
    }
    // Serial load — prevent double init
    this.contextLoadPromise = this.contextLoadPromise.then(async () => {
      if (this.context && this.isVocoderReady) {
        return;
      }
      logger.log('[TTS] Loading backbone...');
      this.context = await initLlama({
        model: this.getBackbonePath(),
        n_ctx: 8192,
        n_threads: 4,
      });
      logger.log('[TTS] Loading vocoder...');
      await this.context.initVocoder({ path: this.getVocoderPath(), n_batch: 4096 });
      this.isVocoderReady = await this.context.isVocoderEnabled();
      if (!this.isVocoderReady) {
        throw new Error('Vocoder failed to initialize — check model files.');
      }
      logger.log('[TTS] Ready.');
    });
    return this.contextLoadPromise;
  }

  async unloadModels(): Promise<void> {
    this.stop();
    if (this.context) {
      await this.context.releaseVocoder().catch(() => {});
      await this.context.release().catch(() => {});
      this.context = null;
    }
    this.isVocoderReady = false;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }

  isLoaded(): boolean {
    return this.context !== null && this.isVocoderReady;
  }

  // ─── Audio Generation ────────────────────────────────────────────────────

  async generate(text: string, _options: TTSOptions = {}): Promise<GeneratedAudio> {
    if (!this.context || !this.isVocoderReady) {
      throw new Error('TTS models not loaded.');
    }
    const { prompt, grammar } = await this.context.getFormattedAudioCompletion(
      null, // null = default speaker
      text,
    );
    const guideTokens = (await this.context.getAudioCompletionGuideTokens(text)) ?? [];
    const result = await this.context.completion({
      prompt,
      grammar,
      guide_tokens: guideTokens,
      n_predict: 4096,
      temperature: 0.7,
      top_p: 0.9,
      stop: ['<|im_end|>'],
    });
    const pcmArray = await this.context.decodeAudioTokens(result.audio_tokens ?? []);
    const samples = new Float32Array(pcmArray);
    const sampleRate = TTS_BACKBONE_MODEL.sampleRate;
    return {
      samples,
      durationSeconds: samples.length / sampleRate,
      sampleRate,
      waveformData: this.buildWaveformData(samples, 200),
    };
  }

  async saveToFile(audio: GeneratedAudio, conversationId: string, messageId: string): Promise<string> {
    await this.ensureDir(this.getAudioCacheDir(conversationId));
    const path = this.getAudioFilePath(conversationId, messageId);
    const base64 = this.float32ToBase64(audio.samples);
    await RNFS.writeFile(path, base64, 'base64');
    return path;
  }

  async generateAndSave(
    text: string,
    ctx: { conversationId: string; messageId: string },
    options: TTSOptions = {},
  ): Promise<{ path: string; audio: GeneratedAudio }> {
    const audio = await this.generate(text, options);
    const path = await this.saveToFile(audio, ctx.conversationId, ctx.messageId);
    return { path, audio };
  }

  // ─── Playback ────────────────────────────────────────────────────────────

  async playFromSamples(samples: Float32Array, speed = 1.0, startOffset = 0): Promise<void> {
    const sampleRate = TTS_BACKBONE_MODEL.sampleRate;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = new AudioContext({ sampleRate });
    const buffer = this.audioCtx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = speed;
    source.connect(this.audioCtx.destination);
    this.currentSource = source;
    this.isSpeakingFlag = true;
    return new Promise((resolve) => {
      source.onEnded = () => {
        this.currentSource = null;
        this.isSpeakingFlag = false;
        resolve();
      };
      source.start(0, startOffset);
    });
  }

  async playFromFile(filePath: string, speed = 1.0, startOffset = 0): Promise<void> {
    // WAV/PCM files must be decoded with decodeAudioData — NOT cast from raw bytes.
    // The old base64→Float32 path was designed for OuteTTS raw Float32 output only.
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = new AudioContext();
    const src = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
    // decodeAudioData accepts a string path as DecodeDataInput
    const buffer = await this.audioCtx.decodeAudioData(src as unknown as ArrayBuffer);
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = speed;
    source.connect(this.audioCtx.destination);
    this.currentSource = source;
    this.isSpeakingFlag = true;
    return new Promise((resolve) => {
      source.onEnded = () => {
        this.currentSource = null;
        this.isSpeakingFlag = false;
        resolve();
      };
      source.start(0, startOffset);
    });
  }

  /** Chat Mode: generate + play + discard. No disk write.
   *  @param onStartPlayback  Called once generation is done and audio is about to play.
   */
  async speak(text: string, options: TTSOptions = {}, onStartPlayback?: () => void): Promise<void> {
    this.stop();
    this.isSpeakingFlag = true; // mark in-progress so stop() during generation works
    try {
      const audio = await this.generate(text, options);
      if (!this.isSpeakingFlag) return; // stop() was called during generation
      onStartPlayback?.();
      await this.playFromSamples(audio.samples, options.speed ?? 1.0);
    } finally {
      this.isSpeakingFlag = false;
    }
  }

  stop(): void {
    this.isSpeakingFlag = false;
    try {
      this.currentSource?.stop();
    } catch {
      // already stopped
    }
    this.currentSource = null;
  }

  isSpeaking(): boolean {
    return this.isSpeakingFlag;
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  private buildWaveformData(samples: Float32Array, points: number): number[] {
    const blockSize = Math.floor(samples.length / points);
    const result: number[] = [];
    for (let i = 0; i < points; i++) {
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(samples[i * blockSize + j] ?? 0);
      }
      result.push(blockSize > 0 ? sum / blockSize : 0);
    }
    return result;
  }

  private float32ToBase64(samples: Float32Array): string {
    const uint8 = new Uint8Array(samples.buffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  }

  private base64ToFloat32(base64: string): Float32Array {
    const binary = atob(base64);
    const uint8 = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      uint8[i] = binary.charCodeAt(i);
    }
    return new Float32Array(uint8.buffer);
  }
}

export const ttsService = new TTSService();
