# TODO: Image Generation over a Remote Server

**Status:** planned, NOT this release. Roadmap item.

## Goal
Let the mobile app generate images on a **remote server** — the same way it already talks to remote LLMs — instead of only on-device (Core ML on iOS, ONNX/QNN/MNN on Android). The user picks a local *or* remote image backend; the UI and routing don't care which.

## Why now
- **Off Grid AI Desktop now does server-side image generation** → use it as the **first trial ground** (we control both ends, same gateway/discovery infra the app already uses for remote LLMs).
- **ComfyUI** exposes an HTTP + WebSocket server API → the second target, and the de-facto standard many users already run.

## Architecture — mirror the remote-LLM seam (don't invent a parallel path)
Remote LLM already works this way and is the template:
- Providers live behind one interface (`src/services/providers/` — `openAICompatibleProvider.ts`, `registry.ts`), and remote connection/discovery is owned by the remote-servers infra (`RemoteServersScreen`, gateway discovery, `remoteServerStore`).
- Image generation is already service-owned (`src/services/imageGenerationService.ts` dispatches to `localDreamGenerator` / Core ML). It has a phase state machine and `_saveResult`.

So the shape:
1. **Add a remote image provider behind `ImageGenerationService`** — a new backend the service dispatches to, alongside the local generators. UI/routing keep dispatching one intent; the service picks local vs remote. **No `if (remote)` in the View** (per CLAUDE.md — capability/route decided once in the service).
2. **Reuse the remote-servers connection layer** for discovery/auth/health (don't build a second server list). An image-capable remote server is a capability flag on the existing server record.
3. **Model the async job lifecycle as data** — this is the key difference from local gen:
   - Off Grid Desktop gateway: (TBD — likely a submit → progress → result endpoint set; align with what Desktop exposes).
   - ComfyUI: `POST /prompt` (queue) → subscribe `WS /ws` for progress/executed → `GET /view` to fetch the image. Queue position, per-node progress, and preview frames map onto the existing `IMG-SM` phase machine (`enhancing`/`loading`/`generating`/`done`) + `previewPath`.
4. **Normalize the gaps** — a remote server may not support prompt-enhancement, may return multiple images, may not stream previews. Model these as capabilities, not scattered branches.

## Open questions (resolve before building)
- What image API does **Off Grid AI Desktop** expose today? (submit/poll vs streaming; auth; model selection.) Confirm against the desktop repo before designing the provider contract.
- ComfyUI is **workflow-graph** based (not a simple prompt string). Do we ship a fixed default workflow template and only vary prompt/seed/size, or expose workflow selection? (Start fixed.)
- Result transport: image comes back as base64 vs a URL to fetch. Persist to the same `Documents/generated_images` path + Gallery as local gen, so downstream (chat attachment, gallery, `resolveDocumentPath`) is identical.
- Privacy framing: remote image gen sends the prompt (and any input image) off-device — must be explicit opt-in with clear UI, consistent with the remote-LLM disclosure. On-device stays the default.
- Progress/preview: ComfyUI streams previews over WS; map to the existing Android-style preview path (and note iOS local gen has no preview — parity as data).

## Rough sizing
- Provider + service dispatch + capability flag: **M**
- ComfyUI async/WS client (queue → progress → fetch): **M-L** (the WS job model is the bulk)
- UI: backend picker (local/remote) + opt-in disclosure + reuse remote-server list: **M**
- Tests: provider contract (both a fake Desktop gateway and a fake ComfyUI), job-lifecycle state machine, capability gating: **M**

**Sequence when we pick it up:** (1) confirm the Desktop image API, (2) remote provider behind `ImageGenerationService` against Desktop (trial ground), (3) ComfyUI client, (4) UI + opt-in, (5) tests. Ship behind the existing remote-server opt-in; on-device remains default.
