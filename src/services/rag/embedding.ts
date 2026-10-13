import { initLlama, loadLlamaModelInfo, LlamaContext } from 'llama.rn';
import { Platform } from 'react-native';
import { sha256 } from 'js-sha256';
import RNFS from 'react-native-fs';
import logger from '../../utils/logger';
import { ragDatabase, type EmbeddingModelSelection } from './database';
import { modelResidencyManager } from '../modelResidency';

const EMBEDDING_MODEL_FILENAME = 'all-MiniLM-L6-v2-Q8_0.gguf';
const EMBEDDING_DIMENSION = 384;
const EMBEDDING_CTX_SIZE = 512;
/** Residency key for the embedding model so it's accounted for in the RAM budget. */
const EMBEDDING_RESIDENT_KEY = 'embedding';
/** Approx resident footprint: ~25MB Q8 weights + working set + 512-ctx KV. */
const EMBEDDING_RESIDENT_MB = 90;
/** Bound the native init so a stalled load can't hold the global load lock. */
const EMBEDDING_LOAD_TIMEOUT_MS = 30000;

/**
 * Race `promise` against a timeout. On timeout the returned promise rejects so the
 * caller (and the global load lock it holds) is released; if the underlying promise
 * later resolves, `onOrphan` cleans up the now-orphaned result.
 */
function withTimeout<T>(promise: Promise<T>, opts: { ms: number; message: string; onOrphan: (v: T) => void }): Promise<T> {
  const { ms, message, onOrphan } = opts;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([
    promise.then(v => { clearTimeout(timer); return v; }),
    timeout,
  ]).catch(err => {
    promise.then(onOrphan).catch(() => { /* underlying load failed too — nothing to clean up */ });
    throw err;
  });
}

class EmbeddingService {
  private context: LlamaContext | null = null;
  private loading: Promise<void> | null = null;
  private operations: Promise<unknown> = Promise.resolve();
  private downloads: Promise<unknown> = Promise.resolve();
  private operationActive = false;
  private pendingModel: EmbeddingModelSelection | null | undefined;
  private dimension = EMBEDDING_DIMENSION;
  private modelId = 'bundled:all-MiniLM-L6-v2-Q8_0';

  /** Hold this across vector creation AND index/cache reads or writes. */
  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(async () => {
      this.operationActive = true;
      try { return await operation(); } finally { this.operationActive = false; }
    });
    this.operations = next.catch(() => {});
    return next;
  }

  getModelId(): string { return this.modelId; }

  /** Caller holds the operation lock; failure leaves the stored model and index intact. */
  async withRebuildModel<T>(model: EmbeddingModelSelection | null, rebuild: () => Promise<T>): Promise<T> {
    if (this.loading) await this.loading;
    await this.unload();
    this.pendingModel = model;
    try {
      await this.load();
      await this.embed('Embedding compatibility test.');
      return await rebuild();
    } catch (error) {
      await this.unload();
      throw error;
    } finally {
      this.pendingModel = undefined;
    }
  }

  async isModelDownloaded(candidate: { id: string; size: number; sha256?: string }): Promise<boolean> {
    const filePath = `${RNFS.DocumentDirectoryPath}/embedding-${sha256(candidate.id)}.gguf`;
    if (!await RNFS.exists(filePath)) return false;
    return Number((await RNFS.stat(filePath)).size) === candidate.size &&
      (!candidate.sha256 || await RNFS.hash(filePath, 'sha256') === candidate.sha256);
  }

  /** Download only. Activation and rebuilding require a separate confirmed RAG operation. */
  async downloadModel(
    candidate: { id: string; name: string; size: number; downloadUrl: string; sha256?: string },
    onProgress: (message: string) => void,
    signal: AbortSignal,
    onDownloadProgress?: (fraction: number) => void,
  ): Promise<EmbeddingModelSelection> {
    const next = this.downloads.then(() => this.downloadModelFile(candidate, onProgress, signal, onDownloadProgress));
    this.downloads = next.catch(() => {});
    return next;
  }

  private async downloadModelFile(
    candidate: { id: string; name: string; size: number; downloadUrl: string; sha256?: string },
    onProgress: (message: string) => void,
    signal: AbortSignal,
    onDownloadProgress?: (fraction: number) => void,
  ): Promise<EmbeddingModelSelection> {
    if (signal.aborted) throw new Error('Model download cancelled');
    if (!Number.isFinite(candidate.size) || candidate.size <= 0) {
      throw new Error('The embedding model has no valid file size.');
    }
    const filePath = `${RNFS.DocumentDirectoryPath}/embedding-${sha256(candidate.id)}.gguf`;
    const selection = { id: candidate.id, name: candidate.name, size: candidate.size, filePath };
    if (await RNFS.exists(filePath)) {
      if (await this.isModelDownloaded(candidate)) {
        if (signal.aborted) throw new Error('Model download cancelled');
        onDownloadProgress?.(1);
        return selection;
      }
      await ragDatabase.ensureReady();
      if (ragDatabase.getEmbeddingModel()?.id === candidate.id) {
        throw new Error('The active model file is damaged. Select the built-in model, then download this model again.');
      }
      await RNFS.unlink(filePath);
    }
    const partial = `${filePath}.part`;
    const download = RNFS.downloadFile({
      fromUrl: candidate.downloadUrl, toFile: partial,
      progressInterval: 250,
      begin: () => { onProgress('Downloading embedding model...'); onDownloadProgress?.(0); },
      progress: progress => {
        const fraction = Math.min(1, progress.bytesWritten / candidate.size);
        onDownloadProgress?.(fraction);
        onProgress(`Downloading embedding model: ${Math.round(fraction * 100)}%`);
      },
    });
    const stop = () => RNFS.stopDownload(download.jobId);
    signal.addEventListener('abort', stop);
    try {
      if (signal.aborted) { stop(); throw new Error('Model change cancelled'); }
      const result = await download.promise;
      if (signal.aborted) throw new Error('Model change cancelled');
      if (result.statusCode !== 200 || Number((await RNFS.stat(partial)).size) !== candidate.size) {
        throw new Error('The model download is incomplete. Try again.');
      }
      if (candidate.sha256 && await RNFS.hash(partial, 'sha256') !== candidate.sha256) {
        throw new Error('The model file failed its integrity check. Try again.');
      }
      if (signal.aborted) throw new Error('Model download cancelled');
      await RNFS.moveFile(partial, filePath);
      onDownloadProgress?.(1);
      return selection;
    } finally {
      signal.removeEventListener('abort', stop);
      if (await RNFS.exists(partial)) await RNFS.unlink(partial);
    }
  }

  async load(): Promise<void> {
    if (this.context) return;
    if (this.loading !== null) return this.loading;

    this.loading = this.doLoad();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async doLoad(): Promise<void> {
    await ragDatabase.ensureReady();
    const selected = this.pendingModel !== undefined ? this.pendingModel : ragDatabase.getEmbeddingModel();
    // iOS can move the app container after a restore; derive its current path from the stable identity.
    const modelPath = selected
      ? `${RNFS.DocumentDirectoryPath}/embedding-${sha256(selected.id)}.gguf`
      : await this.ensureModelCopied();
    this.dimension = EMBEDDING_DIMENSION;
    if (selected) {
      const info = await loadLlamaModelInfo(modelPath) as Record<string, unknown>;
      // Only bidirectional BERT encoders with sentence pooling fit this runtime contract.
      // Decoder models and rerankers need different prompting/output handling.
      const contextLength = Number(info['bert.context_length']);
      if (info['general.architecture'] !== 'bert' ||
          ![1, 2].includes(Number(info['bert.pooling_type'])) ||
          !Number.isInteger(contextLength) || contextLength < EMBEDDING_CTX_SIZE) {
        throw new Error('Unsupported embedding model. Use a BERT GGUF text encoder with mean or CLS pooling and at least 512 tokens.');
      }
      const dimension = Number(info['bert.embedding_length']);
      if (!Number.isInteger(dimension) || dimension < 1) {
        throw new Error('This model has an unsupported embedding size.');
      }
      this.dimension = dimension;
    }
    this.modelId = selected?.id ?? 'bundled:all-MiniLM-L6-v2-Q8_0';
    logger.log('[Embedding] Loading embedding model...');
    // Load through the residency manager's global lock so this small RAG model
    // never initializes alongside another model load (the single load gateway).
    // The init is bounded by a timeout so a stalled native load (the
    // ThreadPool::startWorkers hang) releases the lock instead of wedging a
    // concurrent chat-model load and tripping the OS watchdog.
    this.context = await modelResidencyManager.runExclusive('load:embedding', async () => {
      const spec = {
        key: EMBEDDING_RESIDENT_KEY, type: 'embedding' as const,
        sizeMB: selected ? Math.ceil(selected.size / (1024 * 1024)) + 128 : EMBEDDING_RESIDENT_MB,
        canEvict: () => !this.operationActive,
      };
      if (selected && !(await modelResidencyManager.makeRoomFor(spec)).fits) {
        throw new Error('Not enough memory for this embedding model. Choose a smaller model.');
      }
      const ctx = await withTimeout(
        initLlama({
          model: modelPath,
          embedding: true,
          n_gpu_layers: 0,
          n_ctx: EMBEDDING_CTX_SIZE,
          n_batch: EMBEDDING_CTX_SIZE,
          n_threads: 2,
          use_mlock: false,
          use_mmap: true,
        } as any),
        {
          ms: EMBEDDING_LOAD_TIMEOUT_MS,
          message: 'Embedding model load timed out',
          onOrphan: (orphan) => { (orphan as LlamaContext)?.release?.().catch(() => {}); },
        },
      );
      // Register WHILE still holding the global load lock, so the embedding model's
      // footprint counts against the RAM budget atomically with the load. Registering
      // after runExclusive returns left a window where the model was in RAM but absent
      // from the residents set — a concurrent chat-model load could then over-admit
      // against stale free-RAM and OOM. It loads on the tiny MiniLM context and can be
      // evicted as a last-resort sidecar; it never evicts the active generation model.
      modelResidencyManager.register(
        spec,
        () => this.unload(),
      );
      return ctx;
    });
    logger.log('[Embedding] Model loaded successfully');
  }

  private async ensureModelCopied(): Promise<string> {
    const destPath = `${RNFS.DocumentDirectoryPath}/${EMBEDDING_MODEL_FILENAME}`;
    const exists = await RNFS.exists(destPath);
    if (!exists) {
      if (Platform.OS === 'android') {
        await RNFS.copyFileAssets(`models/${EMBEDDING_MODEL_FILENAME}`, destPath);
      } else {
        const bundlePath = `${RNFS.MainBundlePath}/${EMBEDDING_MODEL_FILENAME}`;
        await RNFS.copyFile(bundlePath, destPath);
      }
      logger.log('[Embedding] Copied embedding model to documents directory');
    }
    return destPath;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.context) throw new Error('Embedding model not loaded. Call load() first.');
    try {
      const result = await (this.context as any).embedding(text);
      // [WIRE] embedding dim + a sample (not the whole vector) so fixtures match the real model's dimensionality.
      logger.log(`[WIRE-EMBED] ${JSON.stringify({ dim: result?.embedding?.length, sample: result?.embedding?.slice?.(0, 8) })}`);
      const vector: unknown = result.embedding;
      if (!Array.isArray(vector) || vector.length !== this.dimension ||
          !vector.every(value => typeof value === 'number' && Number.isFinite(value)) ||
          !vector.some(value => value !== 0)) {
        throw new Error('The model did not return a valid sentence embedding.');
      }
      return vector;
    } catch (error: any) {
      const msg = error?.message || String(error) || '';
      logger.error('[Embedding] Native error during embedding:', msg);
      // Attempt recovery by reloading the embedding model
      if (msg.includes('ggml') || msg.includes('abort') || msg.includes('alloc') || msg.includes('OOM')) {
        try {
          await this.unload();
        } catch { /* ignore cleanup errors */ }
        throw new Error(`Embedding failed (native error). Model has been unloaded for safety. (${msg})`);
      }
      throw error;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  async unload(): Promise<void> {
    if (this.context) {
      try {
        await this.context.release();
      } catch (e) {
        logger.warn('[Embedding] Error releasing context (bridge may be torn down):', e);
      }
      this.context = null;
      // Stop counting against the RAM budget. Safe to call during eviction: the
      // residency manager's unload runs inside the held lock and release() only
      // mutates the map (it never re-acquires the lock), so there's no deadlock.
      modelResidencyManager.release(EMBEDDING_RESIDENT_KEY);
      logger.log('[Embedding] Model unloaded');
    }
  }

  isLoaded(): boolean {
    return this.context !== null;
  }

  getDimension(): number {
    return this.dimension;
  }
}

export const embeddingService = new EmbeddingService();
