/**
 * Which chat models load in low-memory mode from the start.
 *
 * A copied load (Android repacks the weights into memory) writes a marker before native init and
 * clears it when init returns. If a later launch finds the marker, the app died during that load:
 * the OS killed it for memory. That model then always loads mapped, so nobody crashes twice on it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const IN_FLIGHT_KEY = 'offgrid.llm.copiedLoadInFlight';
const CRASHED_KEY = 'offgrid.llm.lowMemoryModels';

/** A full disk (POSIX 28 on iPhone) must never fail a load: the guard is best effort. */
const ignore = (): undefined => undefined;

/** This launch: a marker written by this launch is a load still running, not a death. */
const LAUNCH = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface InFlight {
  modelPath: string;
  launch: string;
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Models that died loading as a copy. A marker left by an earlier launch joins them. */
async function crashedModels(): Promise<string[]> {
  const crashed = (await readJson<string[]>(CRASHED_KEY)) ?? [];
  const inFlight = await readJson<InFlight>(IN_FLIGHT_KEY);
  if (!inFlight || inFlight.launch === LAUNCH) return crashed;
  const next = crashed.includes(inFlight.modelPath) ? crashed : [...crashed, inFlight.modelPath];
  // The marker goes only once the list holds the model: if saving fails, the next call still sees
  // the marker, so the loader never retries the copy that killed the app.
  const saved = await AsyncStorage.setItem(CRASHED_KEY, JSON.stringify(next)).then(() => true, () => false);
  if (saved) await AsyncStorage.removeItem(IN_FLIGHT_KEY).catch(ignore);
  return next;
}

/** True when this model died loading as a copy before, so it starts in low-memory mode. */
export async function startsInLowMemory(modelPath: string): Promise<boolean> {
  return (await crashedModels()).includes(modelPath);
}

/** A copied load is about to start native init. */
export async function copiedLoadStarted(modelPath: string): Promise<void> {
  const marker: InFlight = { modelPath, launch: LAUNCH };
  await AsyncStorage.setItem(IN_FLIGHT_KEY, JSON.stringify(marker)).catch(ignore);
}

/** Native init returned, loaded or failed: the app survived it. */
export async function copiedLoadEnded(): Promise<void> {
  await AsyncStorage.removeItem(IN_FLIGHT_KEY).catch(ignore);
}
