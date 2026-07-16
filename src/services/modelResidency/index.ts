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
import { AppState, Platform } from 'react-native';
import { hardwareService } from '../hardware';
import logger from '../../utils/logger';
import {
  planEviction,
  computeBudgetMB,
  Resident,
} from './policy';
import { LoadPolicy, effectiveAvailableMB } from '../memoryBudget';
import {
  formatMakeRoomForLine,
  formatOverrideForcingLine,
  formatOverrideForcedLine,
} from './logging';
import {
  UnloadFn,
  MIN_BUDGET_MB,
  DIRTY_AVAILABILITY_HEADROOM_MB,
  AGGRESSIVE_DIRTY_HEADROOM_MB,
  SIDECAR_TYPES,
  RegisteredResident,
  ResidentSpec,
  EnsureResult,
  stripUnload,
} from './residents';

class ModelResidencyManager {
  private readonly residents = new Map<string, RegisteredResident>();
  private budgetOverrideMB: number | null = null;
  /**
   * Current load policy (single owner). The View (settings screen) dispatches an
   * intent via setLoadPolicy; the manager - not a reactive store snapshot - is the
   * authoritative source the memory math reads, so no imperative decision is made
   * off a store value multiple writers can desync.
   */
  private loadPolicy: LoadPolicy = 'balanced';
  /**
   * Model ids the user has approved a memory-override ("Load Anyway") for THIS session.
   * In-memory only (never persisted) so a relaunch starts fresh and asks again. Once a
   * model is in here, its loads skip the gate - the user isn't re-prompted every time it
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
    // It used to be scattered - e.g. the Kokoro bridge had its own memoryWarning
    // listener freeing itself. Now one place reclaims idle models on a warning.
    try {
      AppState.addEventListener('memoryWarning', () => {
        this.handleMemoryWarning().catch(() => {});
      });
    } catch {
      /* non-RN env (some tests) - no AppState */
    }
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
   * Memory-warning response: reclaim idle SIDECAR models (TTS/STT/embedding) -
   * small and cheap to reload - but never one whose owner vetoes via canEvict()
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
        if (r.canEvict && !r.canEvict()) continue; // in use - owner vetoes
        logger.log(
          `[ModelResidency] memory warning → reclaiming idle ${r.type} (${key})`,
        );
        await r
          .unload()
          .catch(err =>
            logger.log(
              `[ModelResidency] memory-warning unload ${key} failed:`,
              err,
            ),
          );
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
   * a held lock, so it must be the NON-locking internal unload - it must never
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
    // (anonymous) memory headroom before jetsam - but llama.cpp mmaps the GGUF, so a
    // model's weights are CLEAN, file-backed pages that the OS pages in/out freely and
    // that do NOT count against the jetsam limit. Budgeting the full model size against
    // the dirty headroom was a category error: it refused an 8GB mmap'd model (whose
    // real dirty cost is ~1-2GB of KV+compute) on a 12GB phone that runs it fine. A
    // GGUF's loadability is bounded by physical RAM (its weights fit as clean pages),
    // which is exactly computeBudgetMB. Floored so a small model always loads.
    const physicalCapMB = computeBudgetMB(
      hardwareService.getTotalMemoryGB() * 1024,
      { policy: this.loadPolicy },
    );
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
    const physicalCapMB = computeBudgetMB(
      hardwareService.getTotalMemoryGB() * 1024,
      { policy: this.loadPolicy },
    );
    // Dirty-memory PRESSURE - the incoming model is dirty, OR a dirty model (CoreML/ONNX
    // image) is already resident. A dirty model's working set/compile spike can't be
    // paged out like clean mmap weights, so while one is present EVERY load (even an
    // mmap sidecar) must also respect real free RAM, or stacking onto the spike jetsams
    // the app. With no dirty pressure, mmap GGUF stays bounded by physical RAM only.
    const dirtyPressure =
      !!spec.dirtyMemory ||
      [...this.residents.values()].some(r => r.dirtyMemory);
    if (!dirtyPressure) {
      // mmap'd, no dirty pressure: physical RAM is the ceiling (clean, file-backed
      // weights page in even when instantaneous available is low).
      return Math.round(Math.max(MIN_BUDGET_MB, physicalCapMB));
    }
    // Under dirty pressure: also gate on real free RAM (+ evictable residents − OS
    // headroom). Use the reclaimable-aware availability (the SAME owner the override
    // survival floor reads) — on Android a foreground load may commit up to the physical
    // budget because the OS reclaims background apps, so a raw availMem snapshot here
    // under-counted and refused a dirty model the override path then loaded fine (B1).
    // iOS gets NO reclaim credit (jetsam kills US, not background apps) so this stays the
    // raw snapshot there — which is what refuses a clean sidecar piled onto a dirty spike.
    const availableMB = effectiveAvailableMB(
      hardwareService.getAvailableMemoryGB() * 1024,
      hardwareService.getTotalMemoryGB() * 1024,
      { platform: Platform.OS, policy: this.loadPolicy },
    );
    const residentMB = [...this.residents.values()].reduce(
      (sum, r) => sum + r.sizeMB,
      0,
    );
    // Aggressive mode holds a smaller real-free-RAM headroom for dirty loads (the
    // lenient safeguard) so e.g. a 3GB LiteRT model the balanced guard rejects on a
    // 12GB phone is allowed through. Still non-zero - never a guaranteed jetsam.
    const dirtyHeadroomMB =
      this.loadPolicy === 'aggressive'
        ? AGGRESSIVE_DIRTY_HEADROOM_MB
        : DIRTY_AVAILABILITY_HEADROOM_MB;
    const dynamicMB = availableMB + residentMB - dirtyHeadroomMB;
    return Math.round(
      Math.max(MIN_BUDGET_MB, Math.min(physicalCapMB, dynamicMB)),
    );
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
    const usedMB = [...this.residents.values()].reduce(
      (sum, r) => sum + r.sizeMB,
      0,
    );
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
  register(
    spec: ResidentSpec,
    unload: UnloadFn,
    now: number = Date.now(),
  ): void {
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
    // Conservative = ONE model at a time (evict everything else). Override ("Load Anyway")
    // also evicts everything to free maximum RAM. Aggressive is NOT single-model — it
    // co-resides like balanced, just with a larger RAM budget.
    const singleModel = this.loadPolicy === 'conservative' || override;
    const plan = planEviction(residents, spec, budgetMB, { singleModel });
    // [MEM-SM] trace (kept forever): the exact numbers behind every fit decision.
    // budgetForSpec already folds in the live os_proc budget under dirty pressure, so
    // there's one owner of the memory math - planEviction enforces it. Also log the raw
    // os_proc figures (available/total) so a refusal is explainable: is real free RAM
    // genuinely low, or is the app footprint bloated?
    const availMB = Math.round(hardwareService.getAvailableMemoryGB() * 1024);
    const totalMB = Math.round(hardwareService.getTotalMemoryGB() * 1024);
    logger.log(
      formatMakeRoomForLine({ spec, budgetMB, availMB, totalMB, residents, plan }),
    );
    // SECOND GATE — the dirty physical ceiling. Aggressive mode's larger RAM fraction is safe for
    // CLEAN (mmap, pageable) weights, but NOT for a DIRTY model whose un-pageable GPU/anonymous
    // pages can't be zram-backed: committing 88% of RAM to dirty pages jetsams. So a dirty model's
    // footprint (the incoming + any dirty residents that STAY) is bounded by the BALANCED physical
    // ceiling regardless of policy — a genuinely-oversized dirty model (9GB on a 12GB phone) is
    // refused even in aggressive (overridable via Load Anyway), while a reasonable dirty model that
    // fits the balanced ceiling still co-resides on aggressive's larger total budget. This is
    // INDEPENDENT of the total-budget check above, so it never changes the clean+dirty swap cases
    // (a large image still evicts a resident text via the total budget).
    const dirtyCeilingMB = computeBudgetMB(totalMB, { policy: 'balanced' });
    const keptDirtyMB = residents
      .filter(r => r.dirtyMemory && !plan.evict.some(e => e.key === r.key))
      .reduce((sum, r) => sum + r.sizeMB, 0);
    const dirtyFootprintMB = (spec.dirtyMemory ? spec.sizeMB : 0) + keptDirtyMB;
    const dirtyCeilingExceeded = !!spec.dirtyMemory && dirtyFootprintMB > dirtyCeilingMB;

    if ((!plan.fits || dirtyCeilingExceeded) && !override) {
      // Won't fit even after the planned evictions (total budget OR the dirty ceiling) - DON'T
      // evict (otherwise we'd strand the device with nothing). The caller blocks the load (overridable).
      return { evicted: [], fits: false };
    }
    // Override ("Load Anyway"): the user explicitly accepted the risk (this call or
    // earlier this session). planEviction already collected every evictable resident
    // when !fits, so evicting plan.evict frees the MAXIMUM room. We evict FIRST, then
    // measure - the old predictive floor refused on a PRE-eviction snapshot that credited
    // 0 for evicting a clean/mmap model (dirtyMemory=false), so it under-counted the RAM
    // iOS actually reclaims on unload and refused loads the device could do. That stale
    // estimate is what users defeated with "load a small model, wait, then load the big
    // one" - and why tapping "Load Anyway" still failed.
    if (!plan.fits && override) {
      logger.log(formatOverrideForcingLine(spec.key, plan.evict));
    }
    const actuallyEvicted: string[] = [];
    let unloadFailed = false;
    for (const victim of plan.evict) {
      const reg = this.residents.get(victim.key);
      if (!reg) continue;
      try {
        await reg.unload();
        this.residents.delete(victim.key);
        actuallyEvicted.push(victim.key);
      } catch (err) {
        // The native unload REJECTED — the victim still holds its RAM. Do NOT delete it
        // from the budget map (counting phantom-freed memory over-commits the incoming
        // load → OOM). Keep it resident and abort the fit.
        logger.log(`[ModelResidency] unload ${victim.key} failed:`, err);
        unloadFailed = true;
        break;
      }
    }
    if (unloadFailed) {
      return { evicted: actuallyEvicted, fits: false };
    }
    // Survival floor: even an override can't cross physics. Now that the evictions have
    // ACTUALLY happened (iOS has reclaimed the unloaded pages), re-read real free RAM and
    // refuse only if the true post-eviction free RAM, minus this model's own dirty
    // footprint, is still below the absolute floor - a load past that point takes a jetsam
    // SIGKILL (uncatchable) mid-load. This is the real physics guard; measuring after the
    // real unload (not predicting) is what stops the false refusals.
    if (override) {
      // Load Anyway is unconditional: the user explicitly accepted the risk, so we evict
      // everything else (via singleModel above) to free maximum RAM and load — NO survival
      // floor, NO refusal. The UI frames it as "not recommended, but you can try".
      logger.log(formatOverrideForcedLine(spec.key, plan.evict));
    }
    return { evicted: actuallyEvicted, fits: true };
  }

  async ensureResident(
    spec: ResidentSpec,
    handlers: { load: () => Promise<void>; unload: UnloadFn },
    now: number = Date.now(),
  ): Promise<EnsureResult> {
    const { evicted, fits } = await this.makeRoomFor(spec);

    if (this.residents.has(spec.key)) {
      this.markUsed(spec.key, now);
      return { loaded: false, evicted };
    }

    // Honor the fit verdict: a model that does not fit must NOT be loaded (the caller
    // used to invoke the gate then load regardless — the STT/OOM bug class).
    if (!fits) {
      return { loaded: false, evicted };
    }

    await handlers.load();
    this.residents.set(spec.key, {
      ...spec,
      lastUsedAt: now,
      unload: handlers.unload,
    });
    return { loaded: true, evicted };
  }

  /** Forget a resident the owner has already unloaded (no unload call). */
  release(key: string): void {
    this.residents.delete(key);
  }

  /** Eject a single resident and ACTUALLY unload it from RAM (unlike release(), which only forgets the
   *  accounting). Used by the model selector's per-model Eject. Runs under the FIFO lock like every other
   *  load/unload. Returns true if a resident was found and ejected. */
  async evictByKey(key: string): Promise<boolean> {
    return this.runExclusive(`evict:${key}`, async () => {
      const r = this.residents.get(key);
      if (!r) return false;
      await r.unload().catch(err => logger.log(`[ModelResidency] evict ${key} unload failed:`, err));
      this.residents.delete(key);
      logger.log(`[ModelResidency] evicted ${r.type} (${key}) by user request`);
      return true;
    });
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
    // Best-effort memory optimization in the generation hot path - must NEVER throw
    // into it (e.g. if the hardware service isn't available). Bail quietly instead.
    let totalGB: number;
    try {
      totalGB = hardwareService.getTotalMemoryGB();
    } catch {
      return;
    }
    if (totalGB > 6) return; // roomy: keep STT warm
    if (!this.residents.has('whisper')) return;
    // Serialize with load/unload: this fires on the generation hot path (every send /
    // regenerate), so without the lock it can race an in-flight whisper load and desync
    // the residents map. whisper's unload doesn't re-acquire the lock, so no deadlock.
    await this.runExclusive('reclaim:stt', async () => {
      const w = this.residents.get('whisper');
      if (!w) return; // reclaimed by another op while we waited for the lock
      if (w.canEvict && !w.canEvict()) return; // in use (e.g. finalizing a transcription) - owner vetoes
      logger.log(
        '[ModelResidency] reclaiming idle STT for generation turn (memory-tight)',
      );
      try {
        await w.unload();
        this.residents.delete('whisper');
      } catch (err) {
        // Native unload REJECTED — whisper still holds its RAM. Keep it counted resident so
        // the next load sizes against real (not phantom-freed) memory rather than OOMing.
        logger.log('[ModelResidency] STT reclaim failed:', err);
      }
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
;
