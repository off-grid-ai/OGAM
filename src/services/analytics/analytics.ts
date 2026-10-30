/**
 * Opt-in analytics: the single owner of consent, the SDK client, super properties, screens,
 * flows and the events in docs/ANALYTICS.md. Every other module reports facts through the
 * functions here; none of them imports the SDK.
 *
 * - Off by default. The client exists only while Anonymous stats or Crash reports is on, and only in a
 *   release build with a key. Before that, every call here is a no-op and nothing is queued.
 * - Anonymous stats gates every event except `$exception` and `unclean_exit`, which Crash reports gates.
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
import { SessionTally, type ScrollBucket, type SummaryCounter } from './sessionTally';
import { setInteractionSink, setScreenSink } from './interactions';
import {
  batteryPct,
  bytesToGb,
  contextBucket,
  errorCode,
  ignore,
  modelRef,
  screenName,
  settingChangeKey,
  languageOnly,
  ms,
  msSince,
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
const PENDING_SESSION_KEY = 'offgrid.analytics.pendingSession';
const FIRST_MESSAGE_KEY = 'offgrid.analytics.firstMessageSent';
/** The open session's counters reach the disk this long after a change, so a crash loses at most this much. */
const PERSIST_DELAY_MS = 1_000;
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
let usageSnapshot: (() => Promise<Properties>) | undefined;
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
  consentChain = consentChain
    .then(applyConsent)
    .then(refreshSession)
    .catch(ignore);
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
      if (before.usage || !after.usage) return;
      capture('analytics_opted_in', { source });
      // Auto Setup was shown before the person could opt in, so its start was not sent then.
      if (source === 'setup') replayFlowStart('onboarding');
    })
    .catch(ignore);
}

/** Called once the app has finished starting and its settings are hydrated. */
export function startAnalytics(
  features: () => Record<string, boolean>,
  usage?: () => Promise<Properties>,
): () => void {
  featureSnapshot = features;
  usageSnapshot = usage;
  stopListening?.();
  stopListening = useAppStore.subscribe((state, prev) => {
    const now = state.settings;
    const was = prev.settings;
    if (now.analyticsUsage !== was.analyticsUsage || now.analyticsCrashes !== was.analyticsCrashes) {
      syncClient().catch(ignore);
    }
    const pro = selectHasProAccess(state);
    if (pro !== selectHasProAccess(prev)) client?.register({ pro });
    if (now !== was) countSettingChanges(now as unknown as Properties, was as unknown as Properties);
    if (state.themeMode !== prev.themeMode) countSetting(settingChangeKey('theme', state.themeMode));
    if (state.activeImageModelId && state.activeImageModelId !== prev.activeImageModelId) {
      modelSelected('image', state.activeImageModelId);
    }
    if (state.activeVideoModelId && state.activeVideoModelId !== prev.activeVideoModelId) {
      modelSelected('video', state.activeVideoModelId);
    }
  });
  setScreenSink({ subScreen: trackSubScreen, sheetShown, sheetHidden });
  foregroundAt = Date.now();
  stopAppState?.();
  const appStateSubscription = AppState.addEventListener('change', onAppStateChange);
  stopAppState = () => appStateSubscription.remove();
  session = SessionTally.start(Date.now());
  syncClient()
    .then(async () => {
      await reportPreviousSession();
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
    setInteractionSink(null);
    setScreenSink(null);
    cancelPersist();
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
  session = SessionTally.start(foregroundAt);
  if (currentScreen) session.screenViewed(currentScreen, foregroundAt);
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
  endSession();
}

/** Show a view: the route, a tab inside it (`models:text`) or a sheet over it (`chat:model-selector`). */
function showView(name: string): void {
  if (name === currentScreen) return;
  const now = Date.now();
  const shownMs = screenShownAt === null ? 0 : now - screenShownAt;
  const prevMs = currentScreen ? screenElapsed + shownMs : undefined;
  client?.screen(name, { screen: name, prev_screen: currentScreen ?? undefined, prev_ms: ms(prevMs) });
  if (usageOn()) {
    session?.screenViewed(name, now);
    persistSoon();
  }
  currentScreen = name;
  screenShownAt = now;
  screenElapsed = 0;
}

/** The route the person is on (never params), in the spec's form: `ProjectDetail` → `project-detail`. */
let routeScreen: string | null = null;
/** The route, or the tab shown inside it. */
let routeView: string | null = null;
const openSheets: string[] = [];

/** A route name only (never params). */
export function trackScreen(name: string | undefined): void {
  const screen = screenName(name);
  if (!screen || screen === routeScreen) return;
  routeScreen = screen;
  routeView = screen;
  openSheets.length = 0;
  showView(screen);
}

/** A tab inside the current route, e.g. the Models screen's tabs: `models:<tab>`. */
function trackSubScreen(sub: string): void {
  const part = screenName(sub);
  if (!routeScreen || !part) return;
  routeView = `${routeScreen}:${part}`;
  if (openSheets.length === 0) showView(routeView);
}

/** A sheet or modal over the current route: `<screen>:<sheet>`. */
function sheetShown(sheet: string): void {
  const part = screenName(sheet);
  if (!routeScreen || !part) return;
  openSheets.push(part);
  showView(`${routeScreen}:${part}`);
}

function sheetHidden(sheet: string): void {
  const part = screenName(sheet);
  const index = part ? openSheets.lastIndexOf(part) : -1;
  if (index < 0) return;
  openSheets.splice(index, 1);
  // A sheet opens only over a route, so the route and its view are known here.
  const top = openSheets[openSheets.length - 1];
  showView(top ? `${routeScreen}:${top}` : (routeView as string));
}

// ── session summary ────────────────────────────────────────────────────────────

let session: SessionTally | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function usageOn(): boolean {
  return client !== null && consent().usage;
}

/** Taps, long-presses and errors are counted per screen: `<screen>:<id>`. */
const SCREEN_SCOPED = new Set<SummaryCounter>(['actions', 'long_press', 'errors_shown']);

const sink = {
  count(counter: SummaryCounter, key: string): void {
    if (!session) return;
    const scoped = SCREEN_SCOPED.has(counter) ? `${routeScreen ?? 'app'}:${key}` : key;
    session.count(counter, scoped, Date.now());
    persistSoon();
  },
  scrolled(pct: ScrollBucket): void {
    if (session && currentScreen && session.scrolled(currentScreen, pct, Date.now())) persistSoon();
  },
};

/** Counters run only while Anonymous stats is on; turning it off forgets the open session's. */
function refreshSession(): void {
  if (usageOn()) {
    setInteractionSink(sink);
    return;
  }
  setInteractionSink(null);
  if (session) session = SessionTally.start(Date.now());
  AsyncStorage.removeItem(PENDING_SESSION_KEY).catch(ignore);
}

function persist(): void {
  persistTimer = null;
  if (!session || !usageOn()) return;
  AsyncStorage.setItem(PENDING_SESSION_KEY, JSON.stringify(session.toJSON())).catch(ignore);
}

/** One disk write per burst of interactions, not one per tap. */
function persistSoon(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(persist, PERSIST_DELAY_MS);
}

function cancelPersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
}

/** The trip to the background closes the session: one `session_summary`, then its counters go. */
function endSession(): void {
  const ended = session;
  session = null;
  if (ended && usageOn()) capture('session_summary', ended.summary(Date.now()));
  AsyncStorage.removeItem(PENDING_SESSION_KEY).catch(ignore);
}

/** On launch: a session the previous launch never closed (it was killed or crashed) is sent now. */
async function reportPreviousSession(): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_SESSION_KEY).catch(ignore);
  if (!raw) return;
  await AsyncStorage.removeItem(PENDING_SESSION_KEY).catch(ignore);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const previous = SessionTally.restore(parsed);
  if (previous && usageOn()) {
    capture('session_summary', { ...previous.summary(previous.state.lastAt), recovered: true });
  }
}

function countSetting(key: string | null): void {
  if (key && usageOn()) sink.count('settings_changed', key);
}

function countSettingChanges(now: Properties, was: Properties): void {
  for (const key of Object.keys(now)) {
    if (now[key] !== was[key]) countSetting(settingChangeKey(key, now[key]));
  }
}

async function snapshotFeaturesDaily(): Promise<void> {
  if (!client || !consent().usage) return;
  const today = new Date().toISOString().slice(0, 10);
  const last = await AsyncStorage.getItem(SNAPSHOT_DAY_KEY).catch(ignore);
  if (last === today) return;
  await AsyncStorage.setItem(SNAPSHOT_DAY_KEY, today).catch(ignore);
  capture('features_snapshot', featureSnapshot());
  // A snapshot that cannot be read is skipped, not sent empty.
  const usage = usageSnapshot ? await usageSnapshot().catch(ignore) : undefined;
  if (usage) capture('usage_snapshot', usage);
}

// ── flows ──────────────────────────────────────────────────────────────────────

const flows = new Map<Flow, { startedAt: number; lastStep?: string }>();

export function flowStarted(flow: Flow, firstStep?: string, properties?: Properties): void {
  flows.set(flow, { startedAt: Date.now() });
  capture('flow_started', { flow });
  if (firstStep) flowStep(flow, firstStep, properties);
}

/** Send a flow's start again, keeping its clock: it began before the person opted in. */
function replayFlowStart(flow: Flow): void {
  const state = flows.get(flow);
  if (!state) return;
  capture('flow_started', { flow });
  if (state.lastStep) capture('flow_step', { flow, step: state.lastStep });
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
  noteFirstMessage();
  flowStep('onboarding', 'first_message');
  flowFinished('onboarding', 'done');
}

let firstMessageNoted = false;

/** `first_message`: once per launch, the time from launch, and from install for the first ever. */
function noteFirstMessage(): void {
  if (firstMessageNoted || !usageOn()) return;
  firstMessageNoted = true;
  const now = Date.now();
  (async () => {
    const before = await AsyncStorage.getItem(FIRST_MESSAGE_KEY).catch(ignore);
    const firstEver = !before;
    if (firstEver) await AsyncStorage.setItem(FIRST_MESSAGE_KEY, '1').catch(ignore);
    const installedAt = firstEver
      ? await Promise.resolve()
          .then(() => DeviceInfo.getFirstInstallTime())
          .catch(ignore)
      : undefined;
    capture('first_message', {
      since_launch_ms: ms(now - moduleLoadedAt),
      first_ever: firstEver,
      since_install_ms: msSince(installedAt, now),
    });
  })().catch(ignore);
}

export type MessageAction = 'copy' | 'edit' | 'delete';
export type DeletedItem = 'chat' | 'project' | 'document';
export type VideoAction = 'extend' | 'make_story' | 'save';
type ModelPickSource =
  | 'model_picker'
  | 'models_screen'
  | 'setup'
  | 'chat'
  | 'home'
  | 'settings'
  | 'video'
  | 'unknown';

export function messageAction(action: MessageAction): void {
  capture('message_action', { action });
}

export function itemDeleted(item: DeletedItem): void {
  capture('item_deleted', { item });
}

/** A video clip's follow-on: Extend, Make it a story, Save. */
export function videoAction(action: VideoAction): void {
  capture('video_action', { action });
}

/** Where the person was when they picked a model, from the screen and any sheet over it. */
function pickSource(): ModelPickSource {
  if (openSheets.includes('model-selector')) return 'model_picker';
  const screen = routeScreen ?? '';
  if (screen === 'models') return 'models_screen';
  if (screen === 'onboarding' || screen === 'auto-setup' || screen === 'advanced-setup') return 'setup';
  if (screen === 'chat' || screen === 'home') return screen;
  if (screen.startsWith('settings') || screen === 'model-settings') return 'settings';
  if (screen.startsWith('video') || screen.startsWith('studio')) return 'video';
  return 'unknown';
}

/** A model was picked (switched to). Image and video picks are seen on the store; text through here. */
export function modelSelected(modality: 'text' | 'image' | 'video', modelId: string): void {
  capture('model_selected', { modality, model: modelRef(modelId), source: pickSource() });
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
