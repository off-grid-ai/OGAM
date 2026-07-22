# PR #571 Targeted Manual Tests

This is the smallest honest device pass for PR #571. It is intentionally smaller than the
canonical 247-row release checklist, but it is not a tiny smoke test: this PR changes production
code across onboarding, downloads, chat/generation, voice, image/vision, memory residency,
projects, tools/MCP, remote models, settings, persistence, and Pro lifecycle.

Use the matching row in `RELEASE_TEST_CHECKLIST.csv` for the exact device steps and expected
result. Record Android and iOS independently. Any P0 failure, crash, data loss, privacy failure,
stuck state, or regression from production blocks release.

## Pass A — behavior directly changed by this PR

Run every row in this section.

- [ ] 180 — Gemma-4 native-first thinking + tool
- [ ] 181 — Upgrade-over-install keeps data + loading mode
- [ ] 182 — Parse-once thinking + tool + answer on LiteRT
- [ ] 183 — Parse-once thinking + tool + answer on remote
- [ ] 184 — Remote activation frees local heavy
- [ ] 185 — Mid-chat model switch stays coherent
- [ ] 186 — Remote stream interruption recovers
- [ ] 187 — Queued downloads survive app kill
- [ ] 188 — LiteRT download warning is device-aware on both download surfaces
- [ ] 189 — TTS download respects the concurrency cap
- [ ] 190 — Send racing a settings reload keeps thinking
- [ ] 191 — GPU-to-CPU fallback is visibly reported
- [ ] 192 — Mic during a background STT download is not mistaken for a loader
- [ ] 193 — Stale failure card clears when a new attempt starts
- [ ] 194 — Embedded MTP activates only for capable GGUFs
- [ ] 195 — Boot is independent of download-database recovery
- [ ] 196 — Model file-list failure is retryable
- [ ] 197 — Chats > New with no selected model opens Chat after local selection
- [ ] 198 — Interleaved thinking blocks stay isolated
- [ ] 199 — Tool enable and disable persist and affect subsequent turns
- [ ] 200 — MCP OAuth cancel, refresh, and retry remain actionable
- [ ] 201 — Repeated LAN scans keep multiple servers unique
- [ ] 202 — Every Get Pro action opens `https://getoffgridai.co/pro/#buy`

## Pass B — foundational blast-radius checks

These production owners were refactored or fixed and are shared by several journeys. Run these
even when Pass A is green.

### Install, onboarding, model discovery, and downloads

- [ ] 1–2 — Fresh install and complete onboarding without a blank or stuck screen
- [ ] 3 — Complete onboarding with a remote server and model already selected
- [ ] 4, 7, 9, 11, 12, 14 — Download one GGUF, vision/mmproj, STT, TTS, image, and LiteRT model
- [ ] 8, 15–16 — Badge accuracy, delete isolation, and concurrent/queued drain order
- [ ] 17–21 — Offline, kill/relaunch, truncated-file, extraction-kill, and extraction-retry recovery

### Local and remote text generation

- [ ] 23–24 — First-send lazy load and reply for GGUF and LiteRT
- [ ] 25–30 — CPU/GPU/NPU selection, GPU-layer setting, and fallback behavior
- [ ] 31–37 — Temperature, top-p, context, prompt, threads, batch, and flash-attention settings
- [ ] 38–44 — Plain/thinking rendering, failure cleanup, Stop, and queued turns
- [ ] 46–50 — Edit, regenerate, mid-chat settings changes, reset, and context-full recovery
- [ ] 138, 141–147 — Remote reply, reasoning, parallel tools, enhancement, disconnect, timeout, and malformed-response recovery

### Voice, images, and vision

- [ ] 51–60 — Permission allow/deny, GGUF/LiteRT dictation, voice-note transcript, teardown, and full STT-to-TTS journey
- [ ] 61–65 — Voice image/tool routing, Stop behavior, and thinking/tool bubble rendering
- [ ] 66–77 — Image generation settings, preview, routing, regenerate, reset, gallery, and warmup message
- [ ] 78–84 — Photo permission allow/deny, vision answer, combined image/text, overflow, LiteRT affordance, and text-only refusal

### Memory, loading policy, and residency

- [ ] 85–96 — Loading-mode persistence, sidecar residency/reclaim, blocked-STT retry, and OS memory warning
- [ ] 97–111 — Aggressive policy, oversize recovery, Load Anyway/survival floor, model swaps/ejection, and RAM readout

### Projects, tools, MCP, and Pro

- [ ] 112–122 — Project create/edit/delete, KB import/index/preview/retrieval, inheritance, and relaunch continuity
- [ ] 123–137 — Built-in tools, parallel/malformed calls, thinking order, MCP connect/list/execute/error/guide
- [ ] 150–155 — Prompt enhancement and spoken-reply cleanup

### Persistence, security, settings, and lifecycle

- [ ] 156–166 — Theme, empty states, long text, orientation, About, storage, app lock, links, and settings persistence
- [ ] 167–174 — Chat/model/project/download persistence, background/foreground, kill recovery, and offline local use
- [ ] 175 — Long-context thermal soak on a physical device

## Pass C — performance regression comparison

Compare the release candidate with current production on the same device and settings. A repeatable
regression over 15% is a release investigation, not an automatic waiver.

- [ ] 203 — Cold app start
- [ ] 204 — Warm app start
- [ ] 205 — Cold model load and time to first token
- [ ] 206 — Warm decode throughput
- [ ] 207 — Sustained generation and thermal soak
- [ ] 208 — Large-chat render and scrolling
- [ ] 209 — Repeated model-swap memory stability
- [ ] 210 — Download/load UI contention
- [ ] 211 — Background/foreground latency and continuity
- [ ] 212 — Attach evidence and complete the release performance record

## Pass D — retained physical-device gates from PR #558

- [ ] 213 — Slide-to-cancel pill layout
- [ ] 214 — Slide-to-cancel cancellation versus ordinary release
- [ ] 215 — Cold Whisper load has no ghost recording
- [ ] 216 — iOS Debug build name is distinct
- [ ] 217 — SDXL Core ML finalization and first ANE compile
- [ ] 218 — Low-RAM curated LiteRT remains visible with a warning
- [ ] 219 — TTS memory-pressure failure remains actionable

## Pass E — changed-owner and legacy-replacement journeys

- [ ] 220–236 — Changed production-owner blast radius
- [ ] 237–240 — P0 fault-recovery device confirmation
- [ ] 241–244 — Retained PR #558 behavior not covered by the earlier rows
- [ ] 245–247 — Legacy test replacement device gates

## Exit rule

This targeted pass is sufficient for PR-specific manual verification only. The full 247-row list
remains the release checklist because the production diff spans nearly every major app subsystem.
