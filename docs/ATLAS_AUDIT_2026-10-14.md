# Atlas follow-up stability audit — 2026-10-14

**Repository:** coolchan03/Atlas
**Source branch / audited baseline:** atlas-audit-20261012 at `717c2fc94abc42cf9c2f8615aadee0d5d2ac84d7`
**Fix branch:** audit/atlas-stability-c20261014
**Scope:** React Native/TypeScript application, selective chat/project encryption, agent default, image accelerator policy, existing unit/integration/UI coverage.
**Release verdict:** **NOT READY**; no native APK/device verification and broad regression debt remains.

## Verified regressions and changes

| Severity | Reproduction / impact | Fix | Verification |
|---|---|---|---|
| Critical | Unlock protected chat A, unprotect chat B: replacement storage write re-encrypts A's placeholder, corrupting its original messages. | `encryptedChatStorage.ts`: only re-encrypt unlocked payload during hydrated live-store writes; preserve ciphertext on disk reads/replacements. | New regression fails on baseline, passes after fix. |
| Critical | Unlock project A, unprotect project B: metadata ciphertext becomes an encrypted `Locked project` stub. | `protectedProjectStorage.ts`: keep sealed disk records opaque during replacement/migration. | New regression fails on baseline, passes after fix. |
| Critical | Android background event before chat-store hydration writes empty initial chat list over saved chats. | `relockProtectedChats` checks Zustand persist hydration before saving. | New regression fails before fix, passes after. |
| Critical | Android background event before project-store hydration writes empty initial projects over persisted projects. | `relockProjects` checks Zustand persist hydration before saving. | New regression fails before fix, passes after. |
| High | Native image Auto mode silently falls back to CPU on unavailable Vulkan/OpenCL contrary to user's explicit CPU fallback opt-in. | `imageAcceleratorSelection.ts` now fails with actionable backend error unless CPU is explicitly selected. | Existing accelerator unit tests pass. |
| Requirement | Newly created chats use Atlas persona even though No agent should be default. | New chats and initial agent state default to no agent; ChatScreen no longer restores Atlas by default; existing conversations with explicit Atlas retain it. | Updated chat-store test passes; device verification still needed. |
| Test debt | LiteRT readiness mocks omitted the real `getLoadedModelPath` API, so engine-specific routing tests crashed. | Complete the mocked native-service interface with matching test model path. | Focused model tests pass. |

## Measured tests

- TypeScript `tsc --noEmit`: pass on Windows using existing dependencies.
- Targeted Jest verification: **6 suites, 242 tests passed** after fixes (encryption, projects, chat store, agent default, LiteRT routes, image acceleration).
- Full baseline JS Jest (run before the last fixes): **459 suites passed; 32 suites failed; 2 skipped; 6973 tests passed; 66 tests failed; 25 skipped**. The runner leaked a low-power monitoring timer and required manual termination after reporting results.
- Existing failing suites include image generation flow and metadata, model picker/UI snapshots/text, image downloads, model RAM residency, GPU backend indicators, hardware probes, tool error handling, and some stale UI expectations. **Do not infer all were resolved by the targeted fixes.**
- Native image source-contract script: **13/13 static checks passed**. This is not equivalent to a compiled or installed APK.
- Dependency-cruiser: **51 architecture violations** across 692 modules and 3,063 dependencies, including circular imports and UI-to-concrete-engine dependencies. Existing push-hook threshold is 33; this branch currently exceeds it.
- Native APK CI build dispatched for this fix commit: https://github.com/coolchan03/Atlas/actions/runs/38656151364 (still unverified at time of audit).
- Native Android compile, APK smoke testing, app migration on devices, live Vulkan/OpenCL/NPU/QNN and long-running image generation: **NOT TESTED** in this audit. No Android SDK installed.

## Known requested requirements / remaining release blockers

1. **Shared project knowledge:** project-level readable/writable knowledge documents are not validated end-to-end in this branch. `protectProject` explicitly **rejects** projects already containing chats, study artifacts, or knowledge-base documents: only metadata can currently be PIN-protected. This is not full project vaulting.
2. **Chat protection:** individually protected chat metadata and message bodies are encrypted at rest using Android Keystore keys; tests pass for simple cycles, two-item isolation, and prehydration. On-device migration and corruption/reinstall recovery remain unverified.
3. **Portable backups and sync:** `atlasTools/backup.ts` explicitly excludes protected chats and project blobs plus all KB documents; it is not a full encrypted cross-device restore. End-to-end device sync remains unverified.
4. **Default agent:** no agent for new conversations is now implemented in the fix branch. Validate opening, restoring, switching, and sending against real installed models on phone.
5. **Image generation:** explicit CPU policy is repaired. Check import formats, support files (LoRA/ESRGAN/JSON), diffuser model metadata, Vulkan/OpenCL/NPU actual runtime, cancel and timeouts on hardware.
6. **LLM stability:** no reproducible native Qwen NPU repeated-`@` incident was available. Validate runtime repetition detection, correct model/tokenizer pairing, and model-switch isolation on-device; no claim of resolution.
7. **Other requested features:** deep research, model nicknames, project chat grouping, file access, study games, voice, and UI flows need branch-level acceptance verification. This audit does **not** certify those as completed.
8. Full broad Jest failures and background timer leaks need resolution or individually documented risk acceptance before a stable release.

## Safeguards and release gate

- Original `P:\AI Projects\Atlas-Finishing-Touches` working tree with uncommitted changes was **not altered**.
- Isolated Windows worktree: `C:\Users\coolc\Atlas-Audit-20261014`, based on the actual latest audit commit.
- Do not merge or label as stable until broad regressions, native CI build, APK signing/install, encrypted storage migration/tamper/key-loss, privacy, model inference and phone/tablet device tests pass.
- No SDK, JDK, or Flutter was installed on the Surface during this audit.
