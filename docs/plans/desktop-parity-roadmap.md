# Mobile <- Desktop Parity Roadmap

Status: Planning
Goal: Bring the mobile app to feature parity with the desktop app, plus mobile's own
native bet (offline recordings). This doc is the full picture across epics; sprint
assignment and estimates are decided separately in Jira.

## Two tracks

1. Mobile-native bet: Offline Recordings & Transcriptions
   (see `offline-recordings.md`). Mobile's analog of the desktop meeting recorder.
2. Desktop parity: close the capability gaps where mobile lags desktop.

## Parity status (full map)

### Already at parity - no work
Chat + vision, image generation, voice STT (Whisper), tools/MCP, projects + RAG,
model catalog/downloads, Keygen licensing.

TTS / Audio Mode - BUILT and shipped in the `mobile-pro` submodule
(`pro/audio/`): Kokoro + OuteTTS + Qwen3 engines behind an EngineRegistry, full
`ttsService` lifecycle (download/load/generate/save/speak/stop/cache), streaming
playback, waveforms, and complete audio-mode UI. At polish stage (recent iOS playback
fix). NOTE: the public `TTS_IMPLEMENTATION_PLAN.md` is stale and says "NOT STARTED" -
trust the pro code. Only follow-up: the audio module has no tests yet (quality task,
not a feature gap).

### Gaps - candidate epics
| Desktop capability | Mobile today | Epic |
|--------------------|--------------|------|
| Meeting recorder | none | A: Offline Recordings (planned) |
| Personas (assistants w/ memory + integrations) | none in pro yet | C: Personas |
| Artifacts / canvas (HTML/React/SVG/Mermaid render) | none | D: Artifacts |
| Local OpenAI-compatible gateway (serve over LAN) | none | E: On-phone server (legacy SCRUM-150, SCRUM-157) |
| Clipboard manager | basic copy only | F: Clipboard (low priority) |

### OS-constrained desktop features - kept in-scope for now
Rely on capabilities macOS exposes but iOS/Android restrict. Treated as doable for
planning; the OS constraint is a risk to resolve (research spike) before build, not a
hard exclusion yet.
| Desktop capability | Constraint | Epic |
|--------------------|-----------|------|
| Screen capture -> OCR -> entities | No continuous background screenshot on iOS/Android | G: Capture loop (spike first) |
| Day / Replay / Reflect | Fed by capture; data model ports, input source does not | H: Memory/Reflect (depends on G) |
| System / call-audio capture | OS-restricted; mobile recordings are mic-only | folded into Recordings risk notes |

## Build sequence (active order; not sprint-bound)

A -> G -> H -> C -> D -> E -> F

(B / TTS is already shipped, so it is not in the build sequence - it sits under
"already at parity".)

1. A - Offline Recordings & Transcriptions (mobile-native; in flight / next)
2. G - Capture loop (research spike first to define mobile feasibility)
3. H - Memory / Day / Replay / Reflect (depends on G's outcome)
4. C - Personas
5. D - Artifacts / Canvas
6. E - On-phone OpenAI-compatible server
7. F - Clipboard manager (low priority)

## Epics overview

### Epic A - Offline Recordings & Transcriptions (mobile-native)
Detailed in `offline-recordings.md`. Record (fg + bg) -> chunked Whisper transcription
-> LLM summary + action items. Pro-gated. Reuse note: `pro/audio/recordBridge.ts`
already bridges mic input for audio mode.

### Epic G - Capture loop (research spike first)
Screen/context capture -> OCR -> observations + entities. Desktop-style "sees your
work" loop. Mobile feasibility uncertain (no background screenshot API); start with a
spike to define what is achievable (share-sheet capture, manual screenshots,
accessibility APIs) before committing build stories.

### Epic H - Memory / Day / Replay / Reflect
Journal (Day), timeline (Replay), analytics (Reflect). Data structures port directly
from desktop; the input source depends on Epic G. Sequenced after G.

### Epic C - Personas
Named assistants with system prompt, memory (cross-conversation RAG), capabilities
(text/voice/vision/image/RAG), and skills/integrations. Plan exists
(`PERSONAS_IMPLEMENTATION_PLAN.md`). No personas module in pro yet - genuine gap.

### Epic D - Artifacts / Canvas
Render model output as HTML / React-JSX / SVG / Mermaid / Markdown in a sandboxed
webview. Pure RN, highly portable from desktop.

### Epic E - On-phone OpenAI-compatible server
Expose local models as an OpenAI-compatible API over the home network so other
devices/apps can use the phone's models. Parity with desktop gateway. Maps to legacy
tickets SCRUM-150 (Android server) and SCRUM-157 (OpenAI-compatible API).

### Epic F - Clipboard manager (low priority)
Searchable on-device clipboard history. Desktop has a `@offgrid/clipboard` engine to
reuse. Lower user value on mobile; parked low.

## Notes for the team
- Pro-gating reuses `proLicenseService` (shared Keygen account with desktop; one
  license already spans platforms).
- Reuse-first: desktop packages (`@offgrid/rag`, `@offgrid/models`, `@offgrid/clipboard`),
  the `mobile-pro` audio module, and desktop plan docs are the reference; do not fork.
- Epics G/H carry real OS-feasibility risk - resolve via spike before sizing build work.
- TTS audio module needs test coverage added (repo mandates unit + integration tests).
