/**
 * Memory-size (context) safety net.
 * A bigger context can make a model fail to load, or crash the app while loading (out of memory,
 * or a LiteRT model built for a smaller maximum). Because the setting is saved, the model would then
 * fail every time. This remembers the last size that worked for each model and goes back to it:
 *  - right away when a load fails (and the load is retried once at the working size), and
 *  - on the next start if the app was killed in the middle of a load.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, ToastAndroid } from 'react-native';
import { useAppStore } from '../stores/appStore';

type Engine = 'llama' | 'litert';
const PENDING = 'atlas-ctx-pending';
const GOOD = 'atlas-ctx-good';
const DEFAULT: Record<Engine, number> = { llama: 4096, litert: 4096 };
/** Marks which app run wrote a pending marker (a marker from an earlier run = that run died mid-load). */
const SESSION = `run-${Date.now()}`;
const key = (engine: Engine) => (engine === 'litert' ? 'liteRTMaxTokens' : 'contextLength');

async function goodMap(): Promise<Record<string, number>> {
  try { return JSON.parse((await AsyncStorage.getItem(GOOD)) || '{}') || {}; } catch { return {}; }
}

export const requestedCtx = (engine: Engine): number =>
  Number((useAppStore.getState().settings as any)[key(engine)]) || DEFAULT[engine];

/** Call just before loading. Only sizes bigger than the last working one are "risky". */
export async function beginLoad(engine: Engine, modelId: string): Promise<void> {
  try {
    const msg = await recoverAfterCrash();
    if (msg && Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.LONG);
    const tried = requestedCtx(engine);
    const good = (await goodMap())[`${engine}:${modelId}`] ?? 0;
    if (good && tried <= good) return;
    await AsyncStorage.setItem(PENDING, JSON.stringify({ engine, modelId, tried, good: good || Math.min(tried, DEFAULT[engine]), at: Date.now(), session: SESSION }));
  } catch { /* best-effort */ }
}

export async function loadWorked(engine: Engine, modelId: string): Promise<void> {
  try {
    const m = await goodMap();
    m[`${engine}:${modelId}`] = Math.max(m[`${engine}:${modelId}`] ?? 0, requestedCtx(engine));
    await AsyncStorage.setItem(GOOD, JSON.stringify(m));
    await AsyncStorage.removeItem(PENDING);
  } catch { /* best-effort */ }
}

function setBack(engine: Engine, size: number): void {
  const st = useAppStore.getState();
  st.updateSettings({ [key(engine)]: size } as any);
  // An agent with its own bigger memory size would set it again - lower that too.
  try {
    const { useAgentStore } = require('../stores/agentStore');
    const ag = useAgentStore.getState();
    const a = ag.agents.find((x: any) => x.id === ag.activeAgentId);
    if (a?.contextLength && a.contextLength > size) ag.updateAgent(a.id, { contextLength: size });
  } catch { /* no agents */ }
}

const k = (n: number) => `${Math.round(n / 1024)}K`;

/** A load failed. Returns the size it went back to (then retry once), or null if the size wasn't the problem. */
export async function loadFailed(engine: Engine, modelId: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING);
    await AsyncStorage.removeItem(PENDING);
    const p = raw ? JSON.parse(raw) : null;
    if (!p || p.engine !== engine || p.modelId !== modelId || p.tried <= p.good) return null;
    setBack(engine, p.good);
    if (Platform.OS === 'android') ToastAndroid.show(`Memory size ${k(p.tried)} didn't work with this model - set back to ${k(p.good)}.`, ToastAndroid.LONG);
    return p.good;
  } catch { return null; }
}

/** On app start: if the last load never finished (the app was closed by the phone), go back. */
export async function recoverAfterCrash(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p?.session === SESSION) return null; // a load running right now
    await AsyncStorage.removeItem(PENDING);
    if (!p || Date.now() - p.at > 24 * 3600e3 || p.tried <= p.good) return null;
    if (requestedCtx(p.engine) !== p.tried) return null; // already changed since
    setBack(p.engine, p.good);
    return `Atlas closed while loading the model with memory size ${k(p.tried)} - that's too much for this phone with this model. It's set back to ${k(p.good)}.`;
  } catch { return null; }
}

/** Run once at app start (after settings load): explain and undo a memory size that crashed the app. */
export function startCtxRecovery(): void {
  const run = () => recoverAfterCrash().then((m) => {
    if (m) require('react-native').Alert.alert('Memory size changed', m);
  }).catch(() => undefined);
  const p: any = (useAppStore as any).persist;
  if (p?.hasHydrated?.()) void run(); else p?.onFinishHydration?.(() => { void run(); });
}
