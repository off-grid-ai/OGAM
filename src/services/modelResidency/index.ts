/**
 * ModelResidencyManager
 *
 * Keeps resident on-device models within a RAM budget. Callers ask to make a
 * model resident; the manager evicts others per `planEviction` (unloading via
 * each resident's registered unload fn) before loading the new one. Load/unload
 * are injected by the caller, so this stays decoupled from the text/image/
 * whisper/tts services and is unit-testable.
 *
 * See docs/design/MODEL_ROUTING.md §5.1–5.2.
 */
import { AppState } from 'react-native';
import { hardwareService } from '../hardware';
import logger from '../../utils/logger';
import { planEviction, computeBudgetMB, Resident, ResidentType } from './policy';
import { LoadPolicy, OVERRIDE_SURVIVAL_FLOOR_MB } from '../memoryBudget';

type UnloadFn = () => Promise<void>;

/** Hard floor so a small model can always load, even under memory pressure. */
const MIN_BUDGET_MB = 1024;
/** For DIRTY-memory models (CoreML/ONNX image): keep this much real RAM free for the
 *  OS + other apps so a dirty load never spills into swap. (Not applied to mmap'd
 *  GGUF — their clean weights don't pressure this limit.) */
const DIRTY_AVAILABILITY_HEADROOM_MB = 1024;
/** Aggressive-mode dirty headroom — leaner, still non-zero (lenient safeguard). */
const AGGRESSIVE_DIRTY_HEADROOM_MB = 512;
/** Small, cheaply-reloadable models reclaimed first under memory pressure. */
const SIDECAR_TYPES = new Set<ResidentType>(['whisper', 'tts', 'embedding']);

interface RegisteredResident extends Resident {
  unload: UnloadFn;
  /** Owner's veto: returns false when the model is in use right now (e.g. TTS is
   *  playing) so residency never evicts it mid-use. Absent → always evictable. */
  canEvict?: () => boolean;
}

export interface ResidentSpec {
  key: string;
  type: ResidentType;
  /** The specific downloaded-model id — keys the per-model session override memory.
   *  (`key` is only the slot/type, e.g. 'text', so it can't distinguish models.) */
  modelId?: string;
  sizeMB: number;
  pinned?: boolean;
  /** Owner's veto: returns false while the model is in use (e.g. TTS playing) so
   *  residency never evicts it mid-use. Absent → always evictable. */
  canEvict?: () => boolean;
  /**
   * Whether the model's weights occupy DIRTY (anonymous, jetsam-counted) memory —
   * the gap modeled as DATA, not a Platform/type branch in the budget.
   *  - false (default): mmap-backed GGUF (llama text / whisper). Weights are CLEAN,
   *    file-backed pages the OS pages freely; they do NOT pressure os_proc_available.
   *    Bounded by PHYSICAL RAM only — so an 8GB GGUF loads on a 12GB phone.
   *  - true: CoreML/ONNX image weights load into dirty/GPU memory that DOES count
   *    against the jetsam limit → also bounded by real free RAM (os_proc_available)
   *    so it never loads into swap.
   */
  dirtyMemory?: boolean;
}

export interface EnsureResult {
  loaded: boolean;
  evicted: string[];
}

const stripUnload = ({ unload: _unload, ...rest }: RegisteredResident): Resident => rest;

class ModelResidencyManager {
  private readonly residents = new Map<string, RegisteredResident>();
  private budgetOverrideMB: number | null = null;
  /**
   * Current load policy (single owner). The View (settings screen) dispatches an
   * intent via setLoadPolicy; the manager — not a reactive store snapshot — is the
   * authoritative source the memory math reads, so no imperative decision is made
   * off a store value multiple writers can desync.
   */
  private loadPolicy: LoadPolicy = 'balanced';
  /**
   * Model ids the user has approved a memory-override ("Load Anyway") for THIS session.
   * In-memory only (never persisted) so a relaunch starts fresh and asks again. Once a
   * model is in here, its loads skip the gate — the user isn't re-prompted every time it
   * gets evicted (e.g. text↔image↔TTS swaps) and reloaded.
   */
  private readonly sessionOverrides = new Set<string>();

  /** Whether the user already approved a memory override for this model this session. */
  hasSessionOverride(modelId: string | undefined): boolean {
    return !!modelId && this.sessionOverrides.has(modelId);
  }

  /** Record a user-approved override for this model (session-scoped). */
  rememberSessionOverride(modelId: string | undefined): void {
    if (modelId) this.sessionOverrides.add(modelId);
  }

  constructor() {
    // Residency owns the memory-pressure response (single owner of model memory).
    // It used to be scattered — e.g. the Kokoro bridge had its own memoryWarning
    // listener freeing itself. Now one place reclaims idle models on a warning.
    try {
      AppState.addEventListener('memoryWarning', () => { this.handleMemoryWarning().catch(() => {}); });
    } catch { /* non-RN env (some tests) — no AppState */ }
  }

  /** Residents as the pure policy sees them, with a live `canEvict()===false`
   *  treated as pinned so capacity eviction never unloads a model that's in use. */
  private planningResidents(): Resident[] {
    return [...this.residents.values()].map(r => ({
      ...stripUnload(r),
      pinned: r.pinned || (r.canEvict ? !r.canEvict() : false),
    }));
  }

  /**
   * Memory-warning response: reclaim idle SIDECAR models (TTS/STT/embedding) —
   * small and cheap to reload — but never one whose owner vetoes via canEvict()
   * (e.g. TTS is actively playing). Generation models and pinned residents are
   * left alone. This is what the Kokoro bridge's own listener used to do, now
   * centralized so the eviction decision lives in one place.
   */
  async handleMemoryWarning(): Promise<void> {
    // Run under the same FIFO lock as every load/unload: mutating `residents` and
    // driving native unloads concurrently with an in-flight load is exactly the
    // race the lock exists to prevent. The sidecar unloads here don't re-acquire the
    // lock, so this can't deadlock.
    await this.runExclusive('memory-warning', async () => {
      for (const [key, r] of [...this.residents.entries()]) {
        if (r.pinned || !SIDECAR_TYPES.has(r.type)) continue;
        if (r.canEvict && !r.canEvict()) continue; // in use — owner vetoes
        logger.log(`[ModelResidency] memory warning → reclaiming idle ${r.type} (${key})`);
        await r.unload().catch(err => logger.log(`[ModelResidency] memory-warning unload ${key} failed:`, err));
        this.residents.delete(key);
      }
    });
  }

  /**
   * Global FIFO lock. Every model load/unload (text, image, whisper, tts,
   * classifier) runs through here, so only ONE heavy model operation touches
   * memory at a time. This is what makes the budget safe to enforce: makeRoomFor
   * + the actual load + register happen atomically, never racing a second load.
   *
   * Re-entrancy rule: an eviction unload (registered via `register`) runs INSIDE
   * a held lock, so it must be the NON-locking internal unload — it must never
   * call runExclusive again, or it deadlocks. Public load/unload methods acquire
   * the lock; the internal `_do…` variants they call do not.
   */
  private opChain: Promise<void> = Promise.resolve();

  async runExclusive<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.opChain;
    let release: () => void = () => {};
    this.opChain = new Promise<void>(resolve => {
      release = resolve;
    });
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Force a specific budget (tests / low-memory tuning). null → derive from device RAM. */
  setBudgetOverrideMB(mb: number | null): void {
    this.budgetOverrideMB = mb;
  }

  /**
   * Set the load policy. Called (as an intent) when the user toggles "aggressive
   * model loading" and at boot from the persisted setting. 'aggressive' commits a
   * larger fraction of RAM and a smaller reserve so big models load; the numbers
   * themselves live in the memoryBudget owner, never branched on here.
   */
  setLoadPolicy(policy: LoadPolicy): void {
    this.loadPolicy = policy;
  }

  getLoadPolicy(): LoadPolicy {
    return this.loadPolicy;
  }

  getBudgetMB(): number {
    if (this.budgetOverrideMB != null) return this.budgetOverrideMB;
    // The budget is the device + platform PHYSICAL-RAM cap (a fraction of total RAM).
    //
    // We do NOT min() this with os_proc_available_memory. That metric is the DIRTY
    // (anonymous) memory headroom before jetsam — but llama.cpp mmaps the GGUF, so a
    // model's weights are CLEAN, file-backed pages that the OS pages in/out freely and
    // that do NOT count against the jetsam limit. Budgeting the full model size against
    // the dirty headroom was a category error: it refused an 8GB mmap'd model (whose
    // real dirty cost is ~1-2GB of KV+compute) on a 12GB phone that runs it fine. A
    // GGUF's loadability is bounded by physical RAM (its weights fit as clean pages),
    // which is exactly computeBudgetMB. Floored so a small model always loads.
    const physicalCapMB = computeBudgetMB(hardwareService.getTotalMemoryGB() * 1024, { policy: this.loadPolicy });
    return Math.round(Math.max(MIN_BUDGET_MB, physicalCapMB));
  }

  /**
   * Budget for loading a SPECIFIC model, branching on its memory characteristic
   * (data, not type): mmap-backed GGUF is bounded by physical RAM only; a dirty
   * (CoreML/ONNX image) model is ALSO bounded by real free RAM (os_proc_available)
   * + what evicting our own resident models would free, so it never loads into swap.
   */
  private budgetForSpec(spec: ResidentSpec): number {
    if (this.budgetOverrideMB != null) return this.budgetOverrideMB;
    const physicalCapMB = computeBudgetMB(hardwareService.getTotalMemoryGB() * 1024, { policy: this.loadPolicy });
    // Dirty-memory PRESSURE — the incoming model is dirty, OR a dirty model (CoreML/ONNX
    // image) is already resident. A dirty model's working set/compile spike can't be
    // paged out like clean mmap weights, so while one is present EVERY load (even an
    // mmap sidecar) must also respect real free RAM, or stacking onto the spike jetsams
    // the app. With no dirty pressure, mmap GGUF stays bounded by physical RAM only.
    const dirtyPressure = !!spec.dirtyMemory || [...this.residents.values()].some(r => r.dirtyMemory);
    if (!dirtyPressure) {
      // mmap'd, no dirty pressure: physical RAM is the ceiling (clean, file-backed
      // weights page in even when instantaneous available is low).
      return Math.round(Math.max(MIN_BUDGET_MB, physicalCapMB));
    }
    // Under dirty pressure: also gate on real free RAM (+ evictable residents − OS
    // headroom). This is the single owner of the live os_proc budget.
    const availableMB = hardwareService.getAvailableMemoryGB() * 1024;
    const residentMB = [...this.residents.values()].reduce((sum, r) => sum + r.sizeMB, 0);
    // Aggressive mode holds a smaller real-free-RAM headroom for dirty loads (the
    // lenient safeguard) so e.g. a 3GB LiteRT model the balanced guard rejects on a
    // 12GB phone is allowed through. Still non-zero — never a guaranteed jetsam.
    const dirtyHeadroomMB = this.loadPolicy === 'aggressive'
      ? AGGRESSIVE_DIRTY_HEADROOM_MB
      : DIRTY_AVAILABILITY_HEADROOM_MB;
    const dynamicMB = availableMB + residentMB - dirtyHeadroomMB;
    return Math.round(Math.max(MIN_BUDGET_MB, Math.min(physicalCapMB, dynamicMB)));
  }

  getResidents(): Resident[] {
    return [...this.residents.values()].map(stripUnload);
  }

  isResident(key: string): boolean {
    return this.residents.has(key);
  }

  /**
   * Whether `spec` fits the budget alongside everything already resident,
   * WITHOUT evicting anything. Used by the boot preloader so warming a
   * lower-priority model never kicks out a higher-priority one.
   */
  canLoadWithoutEviction(spec: { key: string; sizeMB: number }): boolean {
    if (this.residents.has(spec.key)) return true;
    const usedMB = [...this.residents.values()].reduce((sum, r) => sum + r.sizeMB, 0);
    return usedMB + spec.sizeMB <= this.getBudgetMB();
  }

  markUsed(key: string, now: number = Date.now()): void {
    const r = this.residents.get(key);
    if (r) r.lastUsedAt = now;
  }

  /**
   * Register a model that's already loaded elsewhere (e.g. a pinned classifier
   * or a model loaded before the manager existed) so it's accounted for.
   */
  register(spec: ResidentSpec, unload: UnloadFn, now: number = Date.now()): void {
    this.residents.set(spec.key, { ...spec, lastUsedAt: now, unload });
  }

  /**
   * Make `spec` resident, evicting others to fit the budget. `load` runs only
   * if the model isn't already resident; `unload` is stored for future eviction.
   */
  /**
   * Evict residents (per the budget + mutual-exclusion policy) to make room for
   * `spec`, WITHOUT loading it. For callers that own the actual load themselves
   * (e.g. activeModelService) but want the manager to enforce memory. Returns
   * the evicted keys.
   */
  async makeRoomFor(
    spec: ResidentSpec,
    opts?: { override?: boolean },
  ): Promise<{ evicted: string[]; fits: boolean }> {
    // Re-read real free RAM so the decision reflects current pressure, not a stale
    // boot-time snapshot (other apps may have grabbed memory since).
    await hardwareService.refreshMemoryInfo().catch(() => {});
    // Session override: an explicit opts.override (from a fresh "Load Anyway") OR this
    // model already approved earlier this session. Remember an explicit one so the user
    // isn't re-prompted when it's evicted and reloaded during model swaps.
    if (opts?.override) this.rememberSessionOverride(spec.modelId);
    const override = !!opts?.override || this.hasSessionOverride(spec.modelId);
    const budgetMB = this.budgetForSpec(spec);
    const residents = this.planningResidents();
    // Aggressive policy (or an override) keeps ONE model at a time: evict every evictable
    // resident instead of co-residing whatever fits, so the incoming model gets the
    // maximum RAM. Balanced mode keeps smart co-residency.
    const singleModel = this.loadPolicy === 'aggressive' || override;
    const plan = planEviction(residents, spec, budgetMB, { singleModel });
    // [MEM-SM] trace (kept forever): the exact numbers behind every fit decision.
    // budgetForSpec already folds in the live os_proc budget under dirty pressure, so
    // there's one owner of the memory math — planEviction enforces it. Also log the raw
    // os_proc figures (available/total) so a refusal is explainable: is real free RAM
    // genuinely low, or is the app footprint bloated?
    const availMB = Math.round(hardwareService.getAvailableMemoryGB() * 1024);
    const totalMB = Math.round(hardwareService.getTotalMemoryGB() * 1024);
    logger.log(`[MEM-SM] makeRoomFor ${spec.key} sizeMB=${spec.sizeMB} dirty=${!!spec.dirtyMemory} budgetMB=${budgetMB} os_procAvailMB=${availMB} totalMB=${totalMB} residents=[${residents.map(r => `${r.key}:${r.sizeMB}${r.pinned ? '(pinned)' : ''}`).join(',')}] fits=${plan.fits} evict=[${plan.evict.map(e => e.key).join(',')}]`);
    // Survival floor: even an override can't cross physics. If, after crediting the RAM
    // the planned evictions free, live free RAM (minus this model's own dirty footprint)
    // would drop below the absolute floor, refuse — the OS would jetsam-kill mid-load
    // (uncatchable SIGKILL) anyway. Catches the "background apps ate the baseline" case.
    if (override) {
      const freedByEvictMB = plan.evict.reduce((s, e) => s + (e.dirtyMemory ? e.sizeMB : 0), 0);
      const incomingDirtyMB = spec.dirtyMemory ? spec.sizeMB : 0;
      const postLoadFreeMB = availMB + freedByEvictMB - incomingDirtyMB;
      if (postLoadFreeMB < OVERRIDE_SURVIVAL_FLOOR_MB) {
        logger.log(`[MEM-SM] makeRoomFor ${spec.key} REFUSED even under override — post-load free ~${postLoadFreeMB}MB < survival floor ${OVERRIDE_SURVIVAL_FLOOR_MB}MB`);
        return { evicted: [], fits: false };
      }
    }
    if (!plan.fits && !override) {
      // Won't fit even after the planned evictions — DON'T evict (otherwise we'd
      // strand the device with nothing). The caller blocks the load.
      return { evicted: [], fits: false };
    }
    // Override ("Load Anyway"): the user explicitly accepted the risk (this call or
    // earlier this session). planEviction already collected every evictable resident when
    // !fits, so evicting plan.evict frees the MAXIMUM room, then we force fits=true. The
    // lenient safeguards remain: we still evicted everything we could, and the native
    // loader keeps its GPU→CPU→smaller-ctx fallback + OOM recovery if it truly can't fit.
    if (!plan.fits && override) {
      logger.log(`[MEM-SM] makeRoomFor ${spec.key} OVERRIDE — forcing load after evicting [${plan.evict.map(e => e.key).join(',')}]`);
    }
    for (const victim of plan.evict) {
      const reg = this.residents.get(victim.key);
      if (!reg) continue;
      await reg.unload().catch(err => logger.log(`[ModelResidency] unload ${victim.key} failed:`, err));
      this.residents.delete(victim.key);
    }
    return { evicted: plan.evict.map(e => e.key), fits: true };
  }

  async ensureResident(
    spec: ResidentSpec,
    handlers: { load: () => Promise<void>; unload: UnloadFn },
    now: number = Date.now(),
  ): Promise<EnsureResult> {
    const { evicted } = await this.makeRoomFor(spec);

    if (this.residents.has(spec.key)) {
      this.markUsed(spec.key, now);
      return { loaded: false, evicted };
    }

    await handlers.load();
    this.residents.set(spec.key, { ...spec, lastUsedAt: now, unload: handlers.unload });
    return { loaded: true, evicted };
  }

  /** Forget a resident the owner has already unloaded (no unload call). */
  release(key: string): void {
    this.residents.delete(key);
  }

  /**
   * A generation turn is starting: the mic (STT/Whisper) model is idle while the
   * LLM runs, and its RAM is better spent on the LLM's inference working set (which
   * the file-size budget doesn't capture). On a memory-tight device, free it so the
   * generation working set doesn't tip the app past the jetsam limit (the 4GB
   * resend OOM). STT reloads on the next record. Roomy devices keep it warm.
   * Centralizes the "evict idle audio sidecar for generation" decision here.
   */
  async reclaimSttForGeneration(): Promise<void> {
    // Best-effort memory optimization in the generation hot path — must NEVER throw
    // into it (e.g. if the hardware service isn't available). Bail quietly instead.
    let totalGB: number;
    try { totalGB = hardwareService.getTotalMemoryGB(); } catch { return; }
    if (totalGB > 6) return; // roomy: keep STT warm
    if (!this.residents.has('whisper')) return;
    // Serialize with load/unload: this fires on the generation hot path (every send /
    // regenerate), so without the lock it can race an in-flight whisper load and desync
    // the residents map. whisper's unload doesn't re-acquire the lock, so no deadlock.
    await this.runExclusive('reclaim:stt', async () => {
      const w = this.residents.get('whisper');
      if (!w) return; // reclaimed by another op while we waited for the lock
      if (w.canEvict && !w.canEvict()) return; // in use (e.g. finalizing a transcription) — owner vetoes
      logger.log('[ModelResidency] reclaiming idle STT for generation turn (memory-tight)');
      await w.unload().catch(err => logger.log('[ModelResidency] STT reclaim failed:', err));
      this.residents.delete('whisper');
    });
  }

  /** Test helper. */
  _reset(): void {
    this.residents.clear();
    this.budgetOverrideMB = null;
    this.opChain = Promise.resolve();
    this.sessionOverrides.clear();
  }
}

export const modelResidencyManager = new ModelResidencyManager();
export type { Resident, ResidentType } from './policy';
