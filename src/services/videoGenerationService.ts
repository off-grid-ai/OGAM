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
  type VideoGenerationJobContract,
  type VideoGenerationRequestContract,
} from '@offgrid/models';
import { useAppStore, useChatStore } from '../stores';
import { videoGenerator } from './videoGenerator';
import { resolveVideoPack } from './videoModelFiles';
import { modelResidencyManager } from './modelResidency';
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
  async retry(): Promise<GeneratedVideo | undefined> {
    if (!this.journal) return;
    if (this.completion)
      throw new Error('Video generation is already running.');
    if (generationSession.getConversationId())
      throw new Error(
        'Wait for the current generation to finish before retrying.',
      );
    this.completion = this.run(this.journal.input, this.journal).finally(() => {
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
  private async run(
    input: VideoInput,
    resumed?: VideoJournal,
  ): Promise<GeneratedVideo | undefined> {
    const app = useAppStore.getState();
    const model = app.downloadedVideoModels.find(
      m => m.id === (input.model ?? app.activeVideoModelId),
    );
    const remoteState = useRemoteServerStore.getState();
    const server = remoteState.servers.find(
      s =>
        s.id ===
        (resumed?.remoteServerId ??
          remoteState.activeRemoteMediaServerIds.video),
    );
    if (resumed?.remoteServerId && !server)
      throw new Error('The OGAD server for this job is no longer configured.');
    if (!model && !server) throw new Error('Select a video model in Models.');
    const modelId =
      resumed?.input.model ?? server?.mediaModels?.video ?? model!.id;
    const primary =
      server?.mediaModels?.video ??
      model!.files.find(f => f.role === 'primary')!.name;
    let request = resolveVideoRequest(input, {
      ...(app.settings.videoParams?.[primary] ??
        app.settings.videoParams?.default),
      seed: app.settings.videoSeed ?? -1,
      negativePrompt: app.settings.videoNegative ?? '',
    });
    const id = resumed?.id ?? uuid(),
      messageId = resumed?.messageId ?? uuid();
    const directory = `${RNFS.DocumentDirectoryPath}/generated-videos`,
      output = `${directory}/${id}.mp4`;
    this.cancelled = false;
    this.abort = new AbortController();
    this.messageId = messageId;
    this.update({
      ...EMPTY,
      id,
      phase: 'running',
      conversationId: input.conversationId ?? null,
      stage: 'preparing',
      startedAt: Date.now(),
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
      this.journal.input = { ...this.journal.input, ...request };
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
            onProgress: progress =>
              this.update({ stage: 'generating', progress }),
          },
        );
        path = remote.path;
        resultId = remote.provenance ? remote.syncId : id;
        provenance = remote.provenance;
      } else {
        const pack = await resolveVideoPack(model!);
        await modelResidencyManager.runExclusive(
          'video-generation',
          async () => {
            const sizeMB =
              model!.files.reduce(
                (sum, file) => sum + (file.sizeBytes ?? 0),
                0,
              ) /
                1048576 +
              (request.width * request.height * request.frames * 12) / 1048576 +
              1024;
            const spec = {
              key: 'video',
              type: 'video' as const,
              modelId: model!.id,
              sizeMB,
              dirtyMemory: true,
              canEvict: () => false,
            };
            const fit = await modelResidencyManager.makeRoomFor(spec);
            if (!fit.fits)
              throw new Error(
                'Not enough available memory for this video model and clip size.',
              );
            if (this.cancelled) throw new Error('Video generation stopped.');
            registration = modelResidencyManager.register(spec, () =>
              videoGenerator.cancel(),
            );
          },
        );
        if (this.cancelled) throw new Error('Video generation stopped.');
        path = await videoGenerator.generate(request, pack, output, update =>
          this.update(update),
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
      if (!this.cancelled) throw error;
    } finally {
      if (registration) modelResidencyManager.unregister('video', registration);
      if (generationSession.isGeneratingFor(input.conversationId))
        generationSession.end('video-finished');
    }
  }
}
export const videoGenerationService = new VideoGenerationService();
