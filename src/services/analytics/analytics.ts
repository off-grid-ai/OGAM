/**
 * Opt-in analytics: the single owner of consent, the SDK client, super properties, screens,
 * flows and the events in docs/ANALYTICS.md. Every other module reports facts through the
 * functions here; none of them imports the SDK.
 *
 * - Off by default. The client exists only while Usage data or Crash reports is on, and only in a
 *   release build with a key. Before that, every call here is a no-op and nothing is queued.
 * - Usage data gates every event except `$exception` and `unclean_exit`, which Crash reports gates.
 * - Turning both off opts out: what is queued is dropped and the anonymous ID is reset.
 */
import { AppState, Platform, type AppStateStatus } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../../stores/appStore';
import { selectHasProAccess } from '../../stores/proAccessSlice';
import { appVersion } from '../../utils/appVersion';
import { hardwareService } from '../hardware';
import { analyticsBuildAllowed, createAnalyticsClient, type AnalyticsClient } from './client';
import { scrubExceptionProperties } from './scrub';
import { markForeground, markStageEnded, markStageStarted, takeUncleanExit } from './uncleanExit';
import { maybePromptAfterFailure, maybePromptAfterFirstChat } from './consentPrompt';
import {
  batteryPct,
  bytesToGb,
  contextBucket,
  errorCode,
  ignore,
  languageOnly,
  ms,
  oneDecimal,
  releaseChannel,
  sizeBucket,
} from './values';

type Properties = Record<string, unknown>;
export type ConsentSource = 'setup' | 'settings' | 'failure_prompt' | 'first_chat_prompt';
export type Flow =
  | 'onboarding'
  | 'model_transfer'
  | 'sync_pairing'
  | 'remote_server'
  | 'voice_setup'
  | 'image_setup'
  | 'video_setup'
  | 'video_story'
  | 'connector_add'
  | 'pro_upgrade';
export type Feature =
  | 'voice_input'
  | 'tts'
  | 'image_generation'
  | 'video_generation'
  | 'vision'
  | 'web_search'
  | 'tools'
  | 'mcp_tool'
  | 'remote_server'
  | 'browser_action'
  | 'clipboard'
  | 'meetings'
  | 'sync';
export type Modality = 'text' | 'vision' | 'image' | 'video' | 'stt' | 'tts' | 'embedding';
export type Outcome = 'done' | 'stopped' | 'failed';

/** What a model is, in the spec's words: `model`, `quant`, `engine`, `backend`. */
export interface ModelFacts {
  model: string;
  quant?: string;
  engine: string;
  backend: string;
}

const CRASH_EVENTS = new Set(['$exception', 'unclean_exit']);
const SNAPSHOT_DAY_KEY = 'offgrid.analytics.snapshotDay';
const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const moduleLoadedAt = Date.now();

let client: AnalyticsClient | null = null;
let clientCrashes = false;
let clientUsage = false;
let consentChain: Promise<void> = Promise.resolve();
let stopListening: (() => void) | null = null;
/** Set by startAnalytics, before any snapshot can run. */
let featureSnapshot: () => Record<string, boolean>;
let foregroundAt = Date.now();
let ramGb: number | undefined;

// ── consent + client ───────────────────────────────────────────────────────────

function consent(): { usage: boolean; crashes: boolean } {
  const { analyticsUsage, analyticsCrashes } = useAppStore.getState().settings;
  return { usage: !!analyticsUsage, crashes: !!analyticsCrashes };
}

function beforeSend(event: { event: string; properties?: Properties }) {
  const { usage, crashes } = consent();
  const crash = CRASH_EVENTS.has(event.event);
  if (crash ? !crashes : !usage) return null;
  // An event can be captured before registration lands; every event still carries the spec's
  // properties.
  const properties = { ...superProperties(), ...(ramGb === undefined ? {} : { ram_gb: ramGb }), ...event.properties };
  if (event.event !== '$exception') return { ...event, properties };
  return { ...event, properties: scrubExceptionProperties(properties) };
}

function superProperties(): Properties {
  const version = appVersion();
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return {
    platform: Platform.OS,
    app_version: version,
    channel: releaseChannel(version),
    pro: selectHasProAccess(useAppStore.getState()),
    device_class: DeviceInfo.isTablet() ? 'tablet' : 'phone',
    os_version: DeviceInfo.getSystemVersion(),
    locale: languageOnly(locale),
  };
}

async function applyConsent(): Promise<void> {
  const { usage, crashes } = consent();
  if (!usage && !crashes) {
    const previous = client;
    client = null;
    clientUsage = false;
    if (previous) await previous.forget();
    return;
  }
  // Usage withdrawn with Crash reports kept: usage events already queued must not upload later.
  // Crash events, the client and the anonymous ID stay (forget() is for a full opt-out).
  if (client && clientUsage && !usage) client.dropQueued(event => CRASH_EVENTS.has(event));
  clientUsage = usage;
  if (!analyticsBuildAllowed() || (client && clientCrashes === crashes)) return;
  if (client) {
    const previous = client;
    client = null;
    await previous.close();
  }
  client = createAnalyticsClient({ crashes, beforeSend });
  clientCrashes = crashes;
  client.register(superProperties());
  DeviceInfo.getTotalMemory()
    .then(total => {
      ramGb = Math.round(total / GB);
      client?.register({ ram_gb: ramGb });
    })
    .catch(ignore);
}

/** Bring the client in line with the stored consent. Calls run one at a time, in order. */
function syncClient(): Promise<void> {
  consentChain = consentChain.then(applyConsent).catch(ignore);
  return consentChain;
}

function capture(event: string, properties: Properties = {}): void {
  if (!client) return;
  const clean: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) clean[key] = value;
  }
  client.capture(event, clean);
}

/**
 * Store consent and (re)build the client to match. Turning analytics on from fully off sends
 * `analytics_opted_in` with the source of the choice.
 */
export function setAnalyticsConsent(
  next: { usage?: boolean; crashes?: boolean },
  source: ConsentSource,
): Promise<void> {
  const before = consent();
  const after = {
    usage: next.usage ?? before.usage,
    crashes: next.crashes ?? before.crashes,
  };
  useAppStore.getState().updateSettings({
    analyticsUsage: after.usage,
    analyticsCrashes: after.crashes,
    analyticsAsked: true,
  });
  // Never rejects: a consent change must not surface as an error in the UI that made it.
  return syncClient()
    .then(() => {
      if (!before.usage && after.usage) capture('analytics_opted_in', { source });
    })
    .catch(ignore);
}

/** Called once the app has finished starting and its settings are hydrated. */
export function startAnalytics(features: () => Record<string, boolean>): () => void {
  featureSnapshot = features;
  stopListening?.();
  stopListening = useAppStore.subscribe((state, prev) => {
    const now = state.settings;
    const was = prev.settings;
    if (now.analyticsUsage !== was.analyticsUsage || now.analyticsCrashes !== was.analyticsCrashes) {
      syncClient().catch(ignore);
    }
    const pro = selectHasProAccess(state);
    if (pro !== selectHasProAccess(prev)) client?.register({ pro });
  });
  foregroundAt = Date.now();
  stopAppState?.();
  const appStateSubscription = AppState.addEventListener('change', onAppStateChange);
  stopAppState = () => appStateSubscription.remove();
  syncClient()
    .then(async () => {
      capture('app_opened', { cold_start_ms: ms(Date.now() - moduleLoadedAt) });
      const unclean = await takeUncleanExit(appVersion());
      if (unclean) {
        capture('unclean_exit', {
          stage: unclean.stage,
          model: unclean.model,
          engine: unclean.engine,
          backend: unclean.backend,
          free_ram_gb: unclean.free_ram_gb,
          elapsed_ms: ms(Date.now() - unclean.startedAt),
        });
      }
      await snapshotFeaturesDaily();
    })
    .catch(ignore);
  // The App unmounting: send what is queued and stop the client's timers. The ID is kept.
  return () => {
    stopListening?.();
    stopListening = null;
    stopAppState?.();
    stopAppState = null;
    const previous = client;
    client = null;
    previous?.close().catch(ignore);
  };
}

// ── app lifecycle + screens ────────────────────────────────────────────────────

let currentScreen: string | null = null;
let screenShownAt: number | null = null;
let screenElapsed = 0;

let stopAppState: (() => void) | null = null;
let inBackground = false;

/**
 * Only a real trip to the background counts. iOS also passes through `inactive` at a cold launch and
 * under every system dialog; counting that sent a second `app_opened` 128 ms after launch.
 */
function onAppStateChange(next: AppStateStatus): void {
  if (next === 'background' && !inBackground) {
    inBackground = true;
    appBackgrounded();
  } else if (next === 'active' && inBackground) {
    inBackground = false;
    appForegrounded();
  }
}

function appForegrounded(): void {
  foregroundAt = Date.now();
  markForeground(true);
  if (currentScreen) screenShownAt = Date.now();
  capture('app_opened');
  snapshotFeaturesDaily().catch(ignore);
}

function appBackgrounded(): void {
  markForeground(false);
  if (screenShownAt !== null) screenElapsed += Date.now() - screenShownAt;
  screenShownAt = null;
  capture('app_backgrounded', { session_ms: ms(Date.now() - foregroundAt) });
}

/** A route name only (never params). */
export function trackScreen(name: string | undefined): void {
  if (!name || name === currentScreen) return;
  const now = Date.now();
  const shownMs = screenShownAt === null ? 0 : now - screenShownAt;
  const prevMs = currentScreen ? screenElapsed + shownMs : undefined;
  client?.screen(name, { screen: name, prev_screen: currentScreen ?? undefined, prev_ms: ms(prevMs) });
  currentScreen = name;
  screenShownAt = now;
  screenElapsed = 0;
}

async function snapshotFeaturesDaily(): Promise<void> {
  if (!client || !consent().usage) return;
  const today = new Date().toISOString().slice(0, 10);
  const last = await AsyncStorage.getItem(SNAPSHOT_DAY_KEY).catch(ignore);
  if (last === today) return;
  await AsyncStorage.setItem(SNAPSHOT_DAY_KEY, today).catch(ignore);
  capture('features_snapshot', featureSnapshot());
}

// ── flows ──────────────────────────────────────────────────────────────────────

const flows = new Map<Flow, { startedAt: number; lastStep?: string }>();

export function flowStarted(flow: Flow, firstStep?: string, properties?: Properties): void {
  flows.set(flow, { startedAt: Date.now() });
  capture('flow_started', { flow });
  if (firstStep) flowStep(flow, firstStep, properties);
}

/** A step counts only inside a flow that started. */
export function flowStep(flow: Flow, step: string, properties?: Properties): void {
  const state = flows.get(flow);
  if (!state || state.lastStep === step) return;
  state.lastStep = step;
  capture('flow_step', { flow, step, ...properties });
}

export function flowFinished(flow: Flow, outcome: 'done' | 'failed' | 'cancelled', error?: unknown): void {
  const state = flows.get(flow);
  if (!state) return;
  flows.delete(flow);
  capture('flow_finished', {
    flow,
    outcome,
    duration_ms: ms(Date.now() - state.startedAt),
    failed_step: outcome === 'failed' ? state.lastStep : undefined,
    error_code: outcome === 'failed' && error !== undefined ? errorCode(error) : undefined,
  });
}

/** A Pro feature was gated: the person was sent to the Pro page instead of the feature. */
export function proGateShown(feature: string): void {
  flowStarted('pro_upgrade', 'gate_shown', { feature });
}

export function proPaywallViewed(): void {
  if (!flows.has('pro_upgrade')) flowStarted('pro_upgrade');
  flowStep('pro_upgrade', 'paywall_viewed');
}

/** Pro was activated on this device (the purchase itself happens on the web). */
export function proPurchased(): void {
  flowStep('pro_upgrade', 'purchased');
  flowFinished('pro_upgrade', 'done');
}

// ── actions ────────────────────────────────────────────────────────────────────

export function track(
  event: 'chat_created' | 'reply_regenerated' | 'project_created' | 'problem_reported',
): void {
  capture(event);
}

export function featureUsed(feature: Feature): void {
  capture('feature_used', { feature });
}

export function messageSent(facts: { hasImage: boolean; hasDocument: boolean; toolsEnabled: boolean }): void {
  capture('message_sent', {
    has_image: facts.hasImage,
    has_document: facts.hasDocument,
    tools_enabled: facts.toolsEnabled,
  });
  flowStep('onboarding', 'first_message');
  flowFinished('onboarding', 'done');
}

export function documentAdded(extension: string | undefined, sizeBytes: number | undefined): void {
  capture('document_added', { file_type: extension, size_bucket: sizeBucket(sizeBytes) });
}

// ── models ─────────────────────────────────────────────────────────────────────

function freeRamGb(): number | undefined {
  return oneDecimal(hardwareService.getAvailableMemoryGB());
}

async function socLabel(): Promise<string> {
  try {
    const soc = await hardwareService.getSoCInfo();
    return soc.appleChip ?? (soc.qnnVariant ? `${soc.vendor}-${soc.qnnVariant}` : soc.vendor);
  } catch {
    return 'unknown';
  }
}

/** Run a model load and report `model_loaded` / `model_load_failed`. The result is unchanged. */
export async function trackModelLoad<T>(facts: ModelFacts, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const free = freeRamGb();
  markStageStarted({ stage: 'load', ...facts, free_ram_gb: free, startedAt, appVersion: appVersion() });
  const report = (event: string, extra: Properties) => {
    socLabel()
      .then(soc => capture(event, { ...facts, soc, free_ram_gb: free, load_ms: ms(Date.now() - startedAt), ...extra }))
      .catch(ignore);
  };
  try {
    const result = await run();
    markStageEnded('load');
    report('model_loaded', {});
    flowStep('onboarding', 'model_loaded');
    return result;
  } catch (error) {
    markStageEnded('load');
    report('model_load_failed', { error_code: errorCode(error) });
    maybePromptAfterFailure();
    throw error;
  }
}

// ── generation ─────────────────────────────────────────────────────────────────

export interface GenerationMetrics {
  ttftMs?: number;
  tokensPerSec?: number;
  contextTokens?: number;
  /** The whole generation, sent for video (it has no first token). */
  durationMs?: number;
  /** The backend that ran, when it is known only at the end (video). */
  backend?: string;
  /** Video only: the clip started from a photo. */
  hasInitImage?: boolean;
  /** Video only: a draft or a final render. */
  quality?: 'draft' | 'final';
  /** Video only: the clip is a shot of a film. */
  story?: boolean;
  error?: unknown;
}

export type GenerationEnd = (outcome: Outcome, metrics?: GenerationMetrics) => void;

const MARKED_MODALITIES = new Set<Modality>(['text', 'vision', 'image', 'video']);

/** Start timing one generation. Call the returned function exactly once when it ends. */
export function generationStarted(modality: Modality, facts: ModelFacts): GenerationEnd {
  const startedAt = Date.now();
  const marked = MARKED_MODALITIES.has(modality);
  if (marked) {
    markStageStarted({ stage: 'generate', ...facts, free_ram_gb: freeRamGb(), startedAt, appVersion: appVersion() });
  }
  let ended = false;
  return (outcome, metrics = {}) => {
    if (ended) return;
    ended = true;
    if (marked) markStageEnded('generate');
    DeviceInfo.getPowerState()
      .catch(() => ({}) as { batteryLevel?: number; batteryState?: string })
      .then(power => {
        capture('generation_finished', {
          modality,
          model: facts.model,
          engine: facts.engine,
          backend: metrics.backend ?? facts.backend,
          outcome,
          duration_ms: ms(metrics.durationMs),
          ttft_ms: ms(metrics.ttftMs),
          tokens_per_sec: oneDecimal(metrics.tokensPerSec),
          context_tokens_bucket: contextBucket(metrics.contextTokens),
          battery_pct: batteryPct(power?.batteryLevel),
          charging: power?.batteryState ? power.batteryState === 'charging' || power.batteryState === 'full' : undefined,
          error_code: outcome === 'failed' ? errorCode(metrics.error) : undefined,
          has_init_image: modality === 'video' ? metrics.hasInitImage === true : undefined,
          quality: modality === 'video' ? metrics.quality ?? 'final' : undefined,
          story: modality === 'video' ? metrics.story === true : undefined,
        });
      })
      .catch(ignore);
    if (outcome === 'failed') maybePromptAfterFailure();
    if (outcome === 'done' && (modality === 'text' || modality === 'vision')) maybePromptAfterFirstChat();
  };
}

// ── downloads ──────────────────────────────────────────────────────────────────

export interface DownloadFacts {
  model: string;
  quant?: string;
  sizeBytes?: number;
  modelType: 'text' | 'image' | 'video' | 'stt' | 'tts';
}

const downloads = new Map<string, { facts: DownloadFacts; startedAt: number; base: Promise<Properties> }>();

function setupFlow(modelType: DownloadFacts['modelType']): Flow | null {
  if (modelType === 'image') return 'image_setup';
  if (modelType === 'video') return 'video_setup';
  if (modelType === 'stt' || modelType === 'tts') return 'voice_setup';
  return null;
}

export function downloadStarted(key: string, facts: DownloadFacts): void {
  // Not opted in: no disk read, nothing kept.
  if (!client) return;
  const base = Promise.resolve()
    .then(() => RNFS.getFSInfo())
    .then(info => bytesToGb(info.freeSpace))
    .catch(ignore)
    .then(free => ({
      model: facts.model,
      quant: facts.quant,
      size_bucket: sizeBucket(facts.sizeBytes),
      // No connection-type reader is installed; see docs/ANALYTICS.md `network`.
      network: 'unknown',
      free_storage_gb: free,
    }));
  downloads.set(key, { facts, startedAt: Date.now(), base });
  base.then(props => capture('model_download_started', props)).catch(ignore);
  const flow = setupFlow(facts.modelType);
  if (flow) flowStep(flow, 'model_picked');
}

export function downloadEnded(key: string, outcome: 'done' | 'failed', error?: unknown): void {
  // Before the early return: a person who has not opted in has no download entry, and they are
  // the ones the failure prompt is for.
  if (outcome === 'failed') maybePromptAfterFailure();
  const entry = downloads.get(key);
  if (!entry) return;
  downloads.delete(key);
  const durationMs = Date.now() - entry.startedAt;
  entry.base
    .then(props => {
      if (outcome === 'done') {
        // A same-millisecond finish (a resumed file already on disk) counts as one millisecond.
        const mbPerSec = entry.facts.sizeBytes
          ? entry.facts.sizeBytes / MB / (Math.max(durationMs, 1) / 1000)
          : undefined;
        capture('model_download_finished', { ...props, duration_ms: ms(durationMs), mb_per_sec: oneDecimal(mbPerSec) });
      } else {
        capture('model_download_failed', { ...props, duration_ms: ms(durationMs), error_code: errorCode(error) });
      }
    })
    .catch(ignore);
  const flow = setupFlow(entry.facts.modelType);
  if (flow && outcome === 'done') {
    flowStep(flow, 'downloaded');
    flowFinished(flow, 'done');
  }
}
