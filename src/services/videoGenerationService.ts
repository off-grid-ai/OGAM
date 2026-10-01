import { Alert, DevSettings, Platform } from 'react-native';
import { videoGenerationMeta } from '../utils/modelHelpers';
import { resolveDocumentPath } from '../utils/resolveDocumentPath';
import logger from '../utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { remoteMediaRuntime } from './remoteMediaRuntime';
import {
  generateStandalone,
  getActiveEngineService,
  isRemoteTextModelActive,
} from './engines';
import { activeModelService } from './activeModelService';
import RNFS from 'react-native-fs';
import { generateId as uuid } from '../utils/generateId';
import {
  resolveVideoRequest,
  videoArchitecture,
  type ModelEntry,
  type ResolvedVideoRequest,
  type VideoGenerationJobContract,
  type VideoGenerationRequestContract,
} from '@offgrid/models';
import { useAppStore, useChatStore } from '../stores';
import { videoGenerator } from './videoGenerator';
import { resolveVideoPack } from './videoModelFiles';
import { modelResidencyManager } from './modelResidency';
import { OverridableMemoryError } from './modelLoadErrors';
import { reportModelFailure, clearModelFailure } from './modelFailureHandler';
import { reasonFromLoadError } from './modelFailureReasons';
import { generationSession } from './generationSession';
import type { GeneratedVideo } from '../types';

const JOURNAL_KEY = 'offgrid.video.active-job.v1';
type VideoInput = VideoGenerationRequestContract & { conversationId?: string };
interface VideoJournal {
  input: VideoInput;
  id: string;
  messageId: string;
  remoteServerId?: string;
  remoteJobId?: string;
  startedAt: number;
  result?: GeneratedVideo;
}
const EMPTY: VideoGenerationJobContract = {
  id: null,
  phase: 'idle',
  conversationId: null,
  projectId: null,
  stage: null,
  enhancedPrompt: '',
  progress: null,
  preview: null,
  outputPath: null,
  error: null,
  startedAt: null,
  finishedAt: null,
};
class VideoGenerationService {
  private state = EMPTY;
  private journal: VideoJournal | null = null;
  private persistence: Promise<unknown> = Promise.resolve();
  private persist() {
    const value = this.journal ? JSON.stringify(this.journal) : null;
    this.persistence = this.persistence
      .catch(() => {})
      .then(() =>
        value
          ? AsyncStorage.setItem(JOURNAL_KEY, value)
          : AsyncStorage.removeItem(JOURNAL_KEY),
      );
    return this.persistence;
  }
  async restore(): Promise<void> {
    if (this.completion) return;
    const raw = await AsyncStorage.getItem(JOURNAL_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as VideoJournal;
    if (
      !saved.input ||
      typeof saved.id !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/.test(saved.id) ||
      typeof saved.messageId !== 'string'
    )
      return;
    resolveVideoRequest(saved.input);
    if (
      saved.result &&
      saved.result.videoPath ===
        `${RNFS.DocumentDirectoryPath}/generated-videos/${saved.id}.mp4` &&
      (await RNFS.exists(saved.result.videoPath))
    ) {
      this.publishResult(saved.result, saved.messageId, saved.startedAt);
      await AsyncStorage.removeItem(JOURNAL_KEY);
      return;
    }
    if (
      useAppStore
        .getState()
        .generatedVideos.some(video => video.id === saved.id)
    ) {
      await AsyncStorage.removeItem(JOURNAL_KEY);
      return;
    }
    this.journal = saved;
    this.messageId = saved.messageId;
    const output = `${RNFS.DocumentDirectoryPath}/generated-videos/${saved.id}.mp4`;
    if (!saved.remoteServerId && await videoGenerator.getStatus(output)) {
      this.completion = this.run(saved.input, saved, { nativeRecovery: true }).finally(() => {
        this.completion = null;
      });
      void this.completion.catch(error => logger.warn('[Video] Recovered job failed', error));
      return;
    }
    this.update({
      ...EMPTY,
      id: saved.id,
      conversationId: saved.input.conversationId ?? null,
      phase: 'failed',
      error: saved.remoteJobId
        ? 'The connection was interrupted. Retry to check the same OGAD job.'
        : 'Video generation was interrupted. Retry to start it again.',
      startedAt: saved.startedAt,
      finishedAt: Date.now(),
    });
    this.reportFailure(new Error(this.state.error!), !!saved.remoteServerId);
  }
  private publishResult(
    result: GeneratedVideo,
    messageId: string,
    startedAt: number,
  ) {
    useAppStore.getState().addGeneratedVideo(result);
    const conversation = useChatStore
      .getState()
      .conversations.find(c => c.id === result.conversationId);
    if (
      !conversation ||
      conversation.messages.some(message => message.uuid === messageId)
    )
      return;
    useChatStore
      .getState()
      .addMessage(conversation.id, {
        role: 'assistant',
        uuid: messageId,
        content: `Generated video for: "${result.prompt}"`,
        turnStatus: 'completed',
        turnKind: 'video',
        attachments: [
          {
            id: result.id,
            type: 'video',
            uri: `file://${result.videoPath}`,
            width: result.width,
            height: result.height,
          },
        ],
        generationTimeMs: Date.now() - startedAt,
        generationMeta: videoGenerationMeta(result),
      });
  }
  async deleteVideo(id: string): Promise<void> {
    const video = useAppStore
      .getState()
      .generatedVideos.find(item => item.id === id);
    if (!video) return;
    const path = resolveDocumentPath(video.videoPath);
    const root = RNFS.DocumentDirectoryPath + '/';
    if (!path.startsWith(root) || path.split('/').includes('..'))
      throw new Error('The video path is outside app storage.');
    if (await RNFS.exists(path)) await RNFS.unlink(path);
    useChatStore.getState().removeMediaAttachment(id);
    useAppStore.getState().removeGeneratedVideo(id);
  }
  private reportFailure(error: unknown, remote = false) {
    const reason = reasonFromLoadError(error);
    const interrupted =
      (error as { code?: string } | null)?.code === 'VIDEO_BACKGROUND_INTERRUPTED';
    const generationFailed =
      reason === 'load-threw' &&
      this.state.stage !== null &&
      this.state.stage !== 'preparing';
    const detail = error instanceof Error ? error.message : String(error);
    reportModelFailure('video', error, {
      remote,
      ...(interrupted || generationFailed
        ? {
            title: interrupted ? 'Video generation interrupted' : 'Video generation failed',
            message: detail,
          }
        : {}),
      onRetry: () => {
        void (async () => {
          if (!remote && reason === 'insufficient-memory')
            await activeModelService.ejectAll();
          await this.retry();
        })().catch(() => {});
      },
      onLoadAnyway: () => {
        void this.retry({ override: true }).catch(() => {});
      },
    });
  }
  async retry(options?: { override?: boolean }): Promise<GeneratedVideo | undefined> {
    if (!this.journal) return;
    if (this.completion)
      throw new Error('Video generation is already running.');
    if (generationSession.getConversationId())
      throw new Error(
        'Wait for the current generation to finish before retrying.',
      );
    this.completion = this.run(this.journal.input, { ...this.journal, startedAt: Date.now() }, options).finally(() => {
      this.completion = null;
    });
    return this.completion;
  }
  private listeners = new Set<() => void>();
  private cancelled = false;
  private abort = new AbortController();
  private messageId: string | null = null;
  getMessageId = () => this.messageId;
  private pending = new Map<string, VideoGenerationRequestContract>();
  private completion: Promise<GeneratedVideo | undefined> | null = null;
  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<VideoGenerationJobContract>) {
    if (this.cancelled && patch.stage !== undefined) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  defer(conversationId: string, input: VideoGenerationRequestContract) {
    resolveVideoRequest(input);
    if (this.pending.has(conversationId))
      throw new Error('A video is already requested for this turn.');
    this.pending.set(conversationId, input);
  }
  discardDeferred(conversationId: string) {
    this.pending.delete(conversationId);
  }
  hasPending() {
    return this.pending.size > 0 || this.state.phase === 'running';
  }
  async finishDeferred(conversationId: string, stopped: boolean) {
    const input = this.pending.get(conversationId);
    this.pending.delete(conversationId);
    if (input && !stopped) await this.generate({ ...input, conversationId });
  }
  async cancelGeneration() {
    this.pending.clear();
    this.cancelled = true;
    this.abort.abort();
    if (this.state.phase === 'running') {
      this.update({ error: 'Video stop requested.', progress: null, preview: null });
      await videoGenerator.cancel();
      if (this.state.stage === 'enhancing')
        await getActiveEngineService()?.stopGeneration();
      await this.completion;
    }
  }
  generate(
    input: VideoGenerationRequestContract & { conversationId?: string },
  ): Promise<GeneratedVideo | undefined> {
    if (this.completion)
      return Promise.reject(new Error('Video generation is already running.'));
    this.completion = this.run(input).finally(() => {
      this.completion = null;
    });
    return this.completion;
  }
  private async reserveVideo(
    model: ModelEntry | undefined,
    request: ResolvedVideoRequest,
    modelId: string,
    options?: { override?: boolean; nativeRecovery?: boolean },
  ): Promise<symbol> {
    return modelResidencyManager.runExclusive('video-generation', async () => {
      const sizeMB =
        (model?.files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0) ??
          0) /
          1048576 +
        (request.width * request.height * request.frames * 12) / 1048576 +
        1024;
      const spec = {
        key: 'video',
        type: 'video' as const,
        modelId,
        sizeMB,
        dirtyMemory: true,
        canEvict: () => false,
      };
      // A recovered native worker already owns its memory.
      if (!options?.nativeRecovery) {
        const fit = await modelResidencyManager.makeRoomFor(spec, options);
        if (!fit.fits)
          throw new OverridableMemoryError(
            'Not enough available memory for this video model and clip size.',
          );
      }
      if (this.cancelled) throw new Error('Video generation stopped.');
      return modelResidencyManager.register(spec, () =>
        this.cancelGeneration(),
      );
    });
  }
  async diagnose(backend: 'auto' | 'gpu' | 'cpu'): Promise<string> {
    if (!__DEV__ || Platform.OS !== 'android')
      throw new Error('Video diagnostics require an Android debug build.');
    if (this.completion || generationSession.getConversationId())
      throw new Error('Wait for the current generation to finish.');
    const app = useAppStore.getState();
    const model = app.downloadedVideoModels.find(
      m => m.id === app.activeVideoModelId,
    );
    const primary = model?.files.find(file => file.role === 'primary')?.name;
    if (!model || !primary || videoArchitecture(primary) !== 'wan21')
      throw new Error('Select an installed Wan 2.1 video model first.');
    // Public validation remains unchanged. Only this explicit developer action uses one frame.
    const request = {
      ...resolveVideoRequest({
        model: primary,
        prompt:
          'A red ball rolls slowly across a wooden table. Natural daylight, fixed camera.',
        width: 832,
        height: 480,
        frames: 9,
        fps: 8,
        steps: 4,
        guidance: 6,
        seed: 597089194,
      }),
      frames: 1,
      steps: 2,
    };
    const output = `${
      RNFS.DocumentDirectoryPath
    }/generated-videos/diagnostic-${backend}-${Date.now()}.mp4`;
    this.cancelled = false;
    this.abort = new AbortController();
    this.update({
      ...EMPTY,
      phase: 'running',
      stage: 'preparing',
      startedAt: Date.now(),
    });
    this.completion = (async () => {
      let registration: symbol | undefined;
      try {
        const pack = await resolveVideoPack(model);
        registration = await this.reserveVideo(model, request, model.id, {
          override: true,
        });
        await RNFS.mkdir(`${RNFS.DocumentDirectoryPath}/generated-videos`);
        logger.log('[VideoDiagnostic] start', { ...request, backend, output });
        await videoGenerator.generate(
          request,
          pack,
          output,
          update => this.update(update),
          undefined,
          backend,
        );
        if (this.cancelled) throw new Error('Video generation stopped.');
        const metadata = {
          ...request,
          requestedBackend: backend,
          output,
          size: (await RNFS.stat(output)).size,
          durationMs: Date.now() - (this.state.startedAt ?? Date.now()),
        };
        await RNFS.writeFile(
          `${output}.json`,
          JSON.stringify(metadata, null, 2),
          'utf8',
        );
        logger.log('[VideoDiagnostic] complete', metadata);
        this.update({
          phase: 'succeeded',
          outputPath: output,
          finishedAt: Date.now(),
        });
      } catch (error) {
        this.update({
          phase: this.cancelled ? 'cancelled' : 'failed',
          error: String(error),
          finishedAt: Date.now(),
        });
        throw error;
      } finally {
        if (registration)
          modelResidencyManager.unregister('video', registration);
        await RNFS.unlink(`${output}.preview.png`).catch(() => {});
      }
      return undefined;
    })().finally(() => {
      this.completion = null;
    });
    await this.completion;
    return output;
  }
  private async run(
    input: VideoInput,
    resumed?: VideoJournal,
    options?: { override?: boolean; nativeRecovery?: boolean },
  ): Promise<GeneratedVideo | undefined> {
    const app = useAppStore.getState();
    const model = app.downloadedVideoModels.find(
      m => m.id === (input.model ?? app.activeVideoModelId) ||
        (options?.nativeRecovery && m.files.some(file => file.role === 'primary' && file.name === input.model)),
    );
    const remoteState = useRemoteServerStore.getState();
    const server = options?.nativeRecovery ? undefined : remoteState.servers.find(
      s =>
        s.id ===
        (resumed?.remoteServerId ??
          remoteState.activeRemoteMediaServerIds.video),
    );
    if (resumed?.remoteServerId && !server)
      throw new Error('The OGAD server for this job is no longer configured.');
    if (!model && !server && !options?.nativeRecovery) throw new Error('Select a video model in Models.');
    const modelId =
      (options?.nativeRecovery ? model?.id : resumed?.input.model) ?? server?.mediaModels?.video ?? model!.id;
    const primary =
      server?.mediaModels?.video ??
      model?.files.find(f => f.role === 'primary')?.name ?? input.model!;
    let request = resolveVideoRequest({ ...input, model: primary }, {
      ...(app.settings.videoParams?.[primary] ??
        app.settings.videoParams?.default),
      seed: app.settings.videoSeed ?? -1,
      negativePrompt: app.settings.videoNegative ?? '',
    });
    const id = resumed?.id ?? uuid(),
      messageId = resumed?.messageId ?? uuid();
    const directory = `${RNFS.DocumentDirectoryPath}/generated-videos`,
      output = `${directory}/${id}.mp4`;
    clearModelFailure('video');
    this.cancelled = false;
    this.abort = new AbortController();
    this.messageId = messageId;
    this.update({
      ...EMPTY,
      id,
      phase: 'running',
      conversationId: input.conversationId ?? null,
      stage: 'preparing',
      startedAt: resumed?.startedAt ?? Date.now(),
    });
    if (input.conversationId) generationSession.begin(input.conversationId);
    let registration: symbol | undefined;
    this.journal = resumed ?? {
      input: { ...input, ...request, model: modelId },
      id,
      messageId,
      remoteServerId: server?.id,
      startedAt: Date.now(),
    };
    try {
      await this.persist();
      if (
        !resumed &&
        (input.enhancePrompt ?? app.settings.enhanceVideoPrompts)
      ) {
        this.update({ stage: 'enhancing' });
        const selectedText = activeModelService.selectedTextModelId();
        if (
          !isRemoteTextModelActive() &&
          !getActiveEngineService()?.isModelLoaded() &&
          selectedText
        )
          await activeModelService.loadTextModel(selectedText);
        if (
          isRemoteTextModelActive() ||
          getActiveEngineService()?.isModelLoaded()
        ) {
          const enhanced = await generateStandalone([
            {
              id: uuid(),
              role: 'system',
              content:
                'Rewrite the request as one short video prompt. Preserve the subject and action. Describe useful motion and camera movement. Return only the prompt.',
              timestamp: Date.now(),
            },
            {
              id: uuid(),
              role: 'user',
              content: request.prompt,
              timestamp: Date.now(),
            },
          ]);
          if (enhanced.trim())
            request = { ...request, prompt: enhanced.trim() };
        }
      }
      if (this.cancelled) throw new Error('Video generation stopped.');
      this.update({ stage: 'preparing', enhancedPrompt: request.prompt });
      this.journal.input = { ...this.journal.input, ...request, model: modelId };
      await this.persist();
      await RNFS.mkdir(directory);
      let path = output,
        resultId = id;
      let provenance: GeneratedVideo['provenance'];
      if (server) {
        const remote = await remoteMediaRuntime.generateVideo(
          server,
          request,
          output,
          {
            signal: this.abort.signal,
            model: modelId,
            jobId: resumed?.remoteJobId,
            onJobStarted: async jobId => {
              if (this.journal) {
                this.journal.remoteJobId = jobId;
                await this.persist();
              }
            },
            onProgress: (progress, stage) =>
              this.update({ stage: stage ?? 'generating', progress }),
            onPreview: preview => this.update({ preview }),
          },
        );
        path = remote.path;
        resultId = remote.provenance ? remote.syncId : id;
        provenance = remote.provenance;
      } else {
        const pack = options?.nativeRecovery ? null : await resolveVideoPack(model!);
        registration = await this.reserveVideo(model, request, modelId, options);
        if (this.cancelled) throw new Error('Video generation stopped.');
        path = options?.nativeRecovery
          ? await videoGenerator.recover(request, output, update => this.update(update))
          : await videoGenerator.generate(
              request, pack!, output,
              update => this.update(update),
              reason => this.update({ error: reason, progress: null, preview: null }),
            );
      }
      if (this.cancelled) throw new Error('Video generation stopped.');
      const result: GeneratedVideo = {
        id: resultId,
        provenance,
        ...request,
        modelId,
        videoPath: path,
        fileName: `${id}.mp4`,
        durationSeconds: request.frames / request.fps,
        createdAt: new Date().toISOString(),
        conversationId: input.conversationId,
      };
      this.journal.result = result;
      await this.persist();
      this.publishResult(result, messageId, this.state.startedAt ?? Date.now());
      this.journal = null;
      await this.persist().catch(error =>
        logger.warn('[Video] Could not clear finished job', error),
      );
      this.update({
        phase: 'succeeded',
        outputPath: path,
        finishedAt: Date.now(),
      });
      return result;
    } catch (error) {
      if (
        (error as { code?: string })?.code === 'VIDEO_REMOTE_FAILED' &&
        this.journal
      ) {
        delete this.journal.remoteJobId;
        await this.persist().catch(error =>
          logger.warn('[Video] Could not save failed job', error),
        );
      }
      if ((error as { code?: string })?.code === 'VIDEO_CANCELLED')
        this.cancelled = true;
      if (this.cancelled) {
        this.journal = null;
        await this.persist().catch(error =>
          logger.warn('[Video] Could not clear stopped job', error),
        );
      }
      await RNFS.unlink(output).catch(() => {});
      this.update({
        phase: this.cancelled ? 'cancelled' : 'failed',
        error:
          error instanceof Error ? error.message : 'Video generation failed.',
        finishedAt: Date.now(),
      });
      if (!this.cancelled) {
        this.reportFailure(error, !!server);
        throw error;
      }
    } finally {
      this.update({ preview: null });
      await RNFS.unlink(`${output}.preview.png`).catch(() => {});
      if (registration) modelResidencyManager.unregister('video', registration);
      if (generationSession.isGeneratingFor(input.conversationId))
        generationSession.end('video-finished');
    }
  }
}
export const videoGenerationService = new VideoGenerationService();

if (__DEV__ && Platform.OS === 'android') {
  for (const backend of ['auto', 'gpu', 'cpu'] as const) {
    DevSettings.addMenuItem(
      `Video diagnostic: ${backend} · 1 frame, 2 steps`,
      () => {
        void videoGenerationService.diagnose(backend).then(
          path => Alert.alert('Video diagnostic saved', path),
          error => Alert.alert('Video diagnostic stopped', String(error)),
        );
      },
    );
  }
  DevSettings.addMenuItem('Stop video diagnostic', () => {
    void videoGenerationService.cancelGeneration();
  });
}
