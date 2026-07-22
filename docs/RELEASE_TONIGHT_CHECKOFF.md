# Off Grid Mobile — Release Tonight Check-Off Sheet

Release candidate: PR #571 (`fix/onboarding-analyzing-device-hang` → `main`, 300 commits, whole-product diff).
Run on 1 current Android + 1 current iPhone + 1 low-RAM device. Record light **and** dark. iOS has no prior signal.

**Block release on:** any reproducible P0, any P1 regression vs production, or any crash / data-loss / stuck-state / secret-in-logs.

Legend — **PassA** = behavior changed by this PR · **P0-gap** = P0 correctness only partly automated · **0%auto** = nothing automated covers it.

| # | Pri | Auto% | Tags | Check | Android | iOS |
|---|-----|-------|------|-------|---------|-----|
| 1 | P0 | 50 | P0-gap | Fresh install launches | ☐ | ☐ |
| 4 | P0 | 75 | P0-gap | Download a text (GGUF) model | ☐ | ☐ |
| 9 | P0 | 75 | P0-gap | Download an STT (whisper) model | ☐ | ☐ |
| 11 | P0 | 75 | P0-gap | Download a TTS (voice) model | ☐ | ☐ |
| 18 | P0 | 50 | P0-gap | Interrupted download recovers after relaunch | ☐ | ☐ |
| 23 | P0 | 75 | P0-gap | First message loads + replies (GGUF) | ☐ | ☐ |
| 43 | P0 | 75 | P0-gap | Stop mid-generation keeps partial | ☐ | ☐ |
| 53 | P0 | 50 | P0-gap | Chat-mode dictation to composer | ☐ | ☐ |
| 54 | P0 | 50 | P0-gap | Chat-mode dictation on litert | ☐ | ☐ |
| 55 | P0 | 50 | P0-gap | Voice note carries transcript (chat mode) | ☐ | ☐ |
| 60 | P0 | 50 | P0-gap | Full voice-mode journey (STT->reply->TTS) | ☐ | ☐ |
| 66 | P0 | 75 | P0-gap | Image generates and renders | ☐ | ☐ |
| 86 | P0 | 75 | P0-gap | Whisper not resident on download | ☐ | ☐ |
| 87 | P0 | 75 | P0-gap | Conservative = one heavy at a time | ☐ | ☐ |
| 88 | P0 | 75 | P0-gap | Balanced = co-reside if they fit | ☐ | ☐ |
| 93 | P0 | 75 | P0-gap | Idle STT reclaimed for a text turn | ☐ | ☐ |
| 99 | P0 | 50 | P0-gap | Oversized model shows a graceful card | ☐ | ☐ |
| 101 | P0 | 50 | P0-gap | Load Anyway bypasses a cautious refusal | ☐ | ☐ |
| 171 | P0 | 75 | P0-gap | Download entries survive relaunch | ☐ | ☐ |
| 180 | P0 | 50 | PassA/P0-gap | Gemma-4 native-first thinking + tool | ☐ | ☐ |
| 181 | P0 | 50 | PassA/P0-gap | Upgrade-over-install keeps data + loading mode | ☐ | ☐ |
| 182 | P1 | 75 | PassA | Parse-once thinking+tool+answer on litert | ☐ | ☐ |
| 183 | P1 | 75 | PassA | Parse-once thinking+tool+answer on remote | ☐ | ☐ |
| 184 | P1 | 75 | PassA | Remote activation frees local heavy | ☐ | ☐ |
| 185 | P1 | 100 | PassA | Mid-chat model switch stays coherent | ☐ | ☐ |
| 186 | P1 | 50 | PassA | Remote stream interruption recovers | ☐ | ☐ |
| 187 | P0 | 50 | PassA/P0-gap | Queued downloads survive app kill | ☐ | ☐ |
| 188 | P1 | 75 | PassA | Litert download warning is device-aware (BOTH screens) | ☐ | ☐ |
| 189 | P2 | 100 | PassA | TTS download respects the concurrency cap | ☐ | ☐ |
| 190 | P1 | 100 | PassA | Send racing a settings reload keeps thinking | ☐ | ☐ |
| 191 | P1 | 50 | PassA | GPU->CPU fallback is visibly reported | ☐ | ☐ |
| 192 | P1 | 100 | PassA | Mic during a background STT download is not a loader | ☐ | ☐ |
| 193 | P1 | 100 | PassA | Stale failure card cleared when a new attempt starts | ☐ | ☐ |
| 194 | P1 | 75 | PassA | Embedded MTP activates only for capable GGUFs | ☐ | ☐ |
| 195 | P0 | 75 | PassA/P0-gap | Boot is independent of download database recovery | ☐ | ☐ |
| 196 | P1 | 100 | PassA | Model file-list failure is retryable | ☐ | ☐ |
| 197 | P0 | 100 | PassA | Chats New with no selected model opens after local selection | ☐ | ☐ |
| 198 | P1 | 100 | PassA | Interleaved thinking blocks stay isolated | ☐ | ☐ |
| 199 | P2 | 100 | PassA | Tool enable and disable persist | ☐ | ☐ |
| 200 | P2 | 50 | PassA | MCP OAuth cancel refresh and retry | ☐ | ☐ |
| 201 | P2 | 50 | PassA | Repeated LAN scan keeps multiple servers unique | ☐ | ☐ |
| 202 | P1 | 75 | PassA | Every Get Pro action opens the new buy anchor | ☐ | ☐ |
| 203 | P1 | 0 | 0%auto | Cold app-start comparison | ☐ | ☐ |
| 204 | P2 | 0 | 0%auto | Warm app-start comparison | ☐ | ☐ |
| 205 | P1 | 0 | 0%auto | Cold model load and first-token comparison | ☐ | ☐ |
| 206 | P1 | 0 | 0%auto | Warm decode throughput comparison | ☐ | ☐ |
| 207 | P1 | 0 | 0%auto | Sustained generation and thermal soak | ☐ | ☐ |
| 208 | P2 | 0 | 0%auto | Large-chat render and scroll responsiveness | ☐ | ☐ |
| 212 | P1 | 0 | 0%auto | Release performance evidence complete | ☐ | ☐ |
| 213 | P1 | 0 | 0%auto | Slide-to-cancel pill renders correctly | ☐ | ☐ |
| 214 | P1 | 0 | 0%auto | Slide-to-cancel distinguishes cancel from send | ☐ | ☐ |
| 215 | P0 | 75 | P0-gap | Cold Whisper load has no ghost recording | ☐ | ☐ |
| 216 | P2 | 0 | 0%auto | iOS Debug build name is distinct | ☐ | ☐ |
| 217 | P1 | 0 | 0%auto | SDXL Core ML finalization and first compile | ☐ | ☐ |
| 218 | P1 | 0 | 0%auto | Low-RAM curated LiteRT remains available with warning | ☐ | ☐ |
| 219 | P1 | 0 | 0%auto | TTS pressure failure remains actionable | ☐ | ☐ |
| 228 | P0 | 75 | P0-gap | Remote server CRUD authentication and credential secrecy | ☐ | ☐ |
| 229 | P0 | 75 | P0-gap | Live Pro activation revocation and reactivation | ☐ | ☐ |
| 231 | P0 | 50 | P0-gap | App Lock blocks background and direct-route bypass | ☐ | ☐ |
| 234 | P0 | 75 | P0-gap | Debug Logs view export clear and secret redaction | ☐ | ☐ |
| 237 | P0 | 75 | P0-gap | Corrupt persisted settings recover without losing unrelated data | ☐ | ☐ |
| 238 | P0 | 75 | P0-gap | Partial filesystem initialization recovers | ☐ | ☐ |
| 239 | P0 | 75 | P0-gap | Interrupted storage write preserves the last commit | ☐ | ☐ |
| 240 | P0 | 75 | P0-gap | Optional Pro extension failure does not break Core | ☐ | ☐ |

---

## Steps & expected result (same order)

### 1 — Fresh install launches  _(P0, 50% auto, P0-gap)_
- **Do:** Delete the app first then install the fresh build and open it
- **Expect:** App launches with no crash; onboarding appears

### 4 — Download a text (GGUF) model  _(P0, 75% auto, P0-gap)_
- **Do:** Models -> pick a small text model (Qwen/Gemma) -> Download
- **Expect:** Progress advances -> completes -> shows Downloaded

### 9 — Download an STT (whisper) model  _(P0, 75% auto, P0-gap)_
- **Do:** Settings/Models -> download a whisper model (base.en or medium)
- **Expect:** Completes and is selectable for voice; NOT auto-loaded into memory

### 11 — Download a TTS (voice) model  _(P0, 75% auto, P0-gap)_
- **Do:** Download the TTS voice model (Kokoro)
- **Expect:** Completes and is usable for spoken replies

### 18 — Interrupted download recovers after relaunch  _(P0, 50% auto, P0-gap)_
- **Do:** Start a NEW download -> force-kill the app mid-download -> reopen -> Download Manager
- **Expect:** A retriable/failed entry is shown after a full cold relaunch; NO phantom/stuck entry

### 23 — First message loads + replies (GGUF)  _(P0, 75% auto, P0-gap)_
- **Do:** Select a text GGUF model -> New chat -> type -> Send
- **Expect:** Reply streams into an assistant bubble (lazy-load on first send)

### 43 — Stop mid-generation keeps partial  _(P0, 75% auto, P0-gap)_
- **Do:** Start a generation -> tap Stop mid-stream
- **Expect:** Generation halts; partial text retained; input returns to send state; queue advances

### 53 — Chat-mode dictation to composer  _(P0, 50% auto, P0-gap)_
- **Do:** In a text chat hold the mic and speak (GGUF model active)
- **Expect:** The transcribed words appear in the INPUT BOX to review/send

### 54 — Chat-mode dictation on litert  _(P0, 50% auto, P0-gap)_
- **Do:** Repeat the hold-to-talk dictation with a litert model active - Android
- **Expect:** Transcript lands in the input box

### 55 — Voice note carries transcript (chat mode)  _(P0, 50% auto, P0-gap)_
- **Do:** Record a voice note in chat mode -> send
- **Expect:** The note is sent WITH the transcribed text (not empty / not raw audio)

### 60 — Full voice-mode journey (STT->reply->TTS)  _(P0, 50% auto, P0-gap)_
- **Do:** Voice mode -> speak a question -> let it reply
- **Expect:** Speak -> transcribed -> model replies -> TTS speaks the reply

### 66 — Image generates and renders  _(P0, 75% auto, P0-gap)_
- **Do:** Select an image model -> toggle image mode ON -> send a prompt (a fox in snow)
- **Expect:** A generated image renders in the chat; details show the backend (MNN GPU / Core ML)

### 86 — Whisper not resident on download  _(P0, 75% auto, P0-gap)_
- **Do:** Confirm from phase 1: STT downloaded but not transcribed -> open model selector In Memory
- **Expect:** Whisper is NOT auto-resident; no phantom 1.5GB resident before first transcribe

### 87 — Conservative = one heavy at a time  _(P0, 75% auto, P0-gap)_
- **Do:** Conservative -> load text -> start image gen -> open In Memory
- **Expect:** Only ONE heavy model resident (the other evicted/swapped)

### 88 — Balanced = co-reside if they fit  _(P0, 75% auto, P0-gap)_
- **Do:** Balanced -> load text -> start image -> open In Memory
- **Expect:** Text AND image BOTH resident when they fit the budget

### 93 — Idle STT reclaimed for a text turn  _(P0, 75% auto, P0-gap)_
- **Do:** Text + whisper resident on a tight device (<=6GB) -> type + send a text turn
- **Expect:** Reply renders AND whisper drops from In Memory while text stays (idle STT reclaimed)

### 99 — Oversized model shows a graceful card  _(P0, 50% auto, P0-gap)_
- **Do:** Try to load a model too big for the device
- **Expect:** Not Enough Memory card appears WITH a Load Anyway button (never a crash / dead-end)

### 101 — Load Anyway bypasses a cautious refusal  _(P0, 50% auto, P0-gap)_
- **Do:** On the Not Enough Memory card tap Load Anyway
- **Expect:** It evicts other models and loads when the post-eviction survival check is safe; the hard survival floor remains authoritative

### 171 — Download entries survive relaunch  _(P0, 75% auto, P0-gap)_
- **Do:** Have in-flight/failed download entries -> fully relaunch
- **Expect:** Download Manager restores entries correctly (no phantom/stuck; failed are retriable)

### 180 — Gemma-4 native-first thinking + tool  _(P0, 50% auto, PassA/P0-gap)_
- **Do:** Select Gemma-4 -> thinking ON + enable a tool -> send one turn that reasons then calls the tool
- **Expect:** Thinking block + tool-result bubble + answer all render correctly and IN ORDER

### 181 — Upgrade-over-install keeps data + loading mode  _(P0, 50% auto, PassA/P0-gap)_
- **Do:** ALT to fresh install: install the CURRENT released build -> set Aggressive loading + download a model + have a chat -> install THIS build OVER it (no delete)
- **Expect:** Models/chats/downloads intact; loading mode reads Aggressive (not blank/default)

### 182 — Parse-once thinking+tool+answer on litert  _(P1, 75% auto, PassA)_
- **Do:** litert model (Android) -> thinking + a tool in one turn
- **Expect:** Thinking block + tool result + answer in the SAME correct order as llama

### 183 — Parse-once thinking+tool+answer on remote  _(P1, 75% auto, PassA)_
- **Do:** Remote reasoning model -> thinking + a tool in one turn
- **Expect:** Same render order as llama/litert

### 184 — Remote activation frees local heavy  _(P1, 75% auto, PassA)_
- **Do:** Local heavy text model resident -> activate a remote model -> open In Memory
- **Expect:** Local heavy is freed / not growing; switch back to local -> it lazy-reloads and replies

### 185 — Mid-chat model switch stays coherent  _(P1, 100% auto, PassA)_
- **Do:** Mid-conversation switch the active text model -> send again
- **Expect:** The NEW model answers and chat state is coherent with NO manual remount

### 186 — Remote stream interruption recovers  _(P1, 50% auto, PassA)_
- **Do:** Start a remote reply -> kill WiFi / stop the server mid-stream
- **Expect:** Spinner clears + error surfaced + no wedge; queue advances

### 187 — Queued downloads survive app kill  _(P0, 50% auto, PassA/P0-gap)_
- **Do:** Queue 6+ downloads so several sit Queued past the 3-slot cap -> force-kill the app -> relaunch
- **Expect:** App boots normally (no forever-load); EVERY queued item is back as Queued and auto-starts as slots free; nothing silently vanishes

### 188 — Litert download warning is device-aware (BOTH screens)  _(P1, 75% auto, PassA)_
- **Do:** On a high-RAM (11GB+) device tap Download on Gemma 4 E4B litert from (a) onboarding Set Up Your AI and (b) Models tab
- **Expect:** NO may-exceed-your-device-memory sheet on either screen - it just downloads; the card shows Recommended

### 189 — TTS download respects the concurrency cap  _(P2, 100% auto, PassA)_
- **Do:** With 3 downloads running start the Kokoro TTS download
- **Expect:** Kokoro QUEUES (does not start a 4th parallel transfer)

### 190 — Send racing a settings reload keeps thinking  _(P1, 100% auto, PassA)_
- **Do:** Thinking ON -> change Backend in Chat Settings -> tap the reload banner -> send IMMEDIATELY while the loader is still up
- **Expect:** The reply renders WITH its thinking block; meta shows the selected backend; no silent capability loss

### 191 — GPU->CPU fallback is visibly reported  _(P1, 50% auto, PassA)_
- **Do:** Backend=GPU + 99 layers on a device whose GPU init times out (Adreno 735 class) -> reload -> wait for load
- **Expect:** A GPU-unavailable and running-on-CPU system message appears in the chat WITHOUT Show Generation Details; meta shows CPU

### 192 — Mic during a background STT download is not a loader  _(P1, 100% auto, PassA)_
- **Do:** With no STT model downloaded tap the mic -> Download (base.en 142 MB) -> while it downloads type and send a chat message
- **Expect:** Chat send works during the whole download; the mic shows the mic-off glyph with a small determinate progress ring (fills by quarter) - NEVER the rotating busy spinner; spinner appears only on a tap-triggered model load or live transcription

### 193 — Stale failure card cleared when a new attempt starts  _(P1, 100% auto, PassA)_
- **Do:** Trigger the No response failure card (model emits 0 tokens; e.g. a K-quant on an incompatible backend) -> send a NEW message
- **Expect:** The failure card disappears as soon as the new attempt starts; no dead card sits next to the live stream; the new reply renders

### 194 — Embedded MTP activates only for capable GGUFs  _(P1, 75% auto, PassA)_
- **Do:** Select an MTP GGUF -> send -> inspect Generation Details; repeat with an ordinary GGUF and with an MTP runtime rejection
- **Expect:** MTP metadata enables draft-mtp and shows accepted-token metrics; ordinary GGUFs stay standard; rejection retries once without MTP

### 195 — Boot is independent of download database recovery  _(P0, 75% auto, PassA/P0-gap)_
- **Do:** Launch with the native download database busy or wedged
- **Expect:** The app clears its boot loader and shows the initial screen while download rows recover asynchronously

### 196 — Model file-list failure is retryable  _(P1, 100% auto, PassA)_
- **Do:** Models -> search -> open a model while its Hugging Face file-list request fails -> tap Retry
- **Expect:** A connection-specific retry state appears; Retry fetches and renders the available files; no false empty-model message

### 197 — Chats New with no selected model opens after local selection  _(P0, 100% auto, PassA)_
- **Do:** Clear the active text model -> Chats -> New -> choose a downloaded local model from the bottom sheet
- **Expect:** The sheet closes and Chat opens immediately; no inert tap; first Send lazy-loads and replies

### 198 — Interleaved thinking blocks stay isolated  _(P1, 100% auto, PassA)_
- **Do:** Thinking ON -> use a model that reasons -> calls a tool -> reasons again -> answers
- **Expect:** While the second thinking block streams it shows ONLY second-round reasoning; after completion both blocks remain separate and ordered around the tool result

### 199 — Tool enable and disable persist  _(P2, 100% auto, PassA)_
- **Do:** Enable calculator -> cold relaunch -> confirm enabled -> run it -> disable -> cold relaunch -> confirm disabled -> send again
- **Expect:** Enable and disable choices survive relaunch; calculator schema is available only on turns sent while enabled

### 200 — MCP OAuth cancel refresh and retry  _(P2, 50% auto, PassA)_
- **Do:** Add an OAuth MCP preset -> cancel the system-browser sign-in -> retry and approve; then expire/revoke the access token or use a server that returns one 401
- **Expect:** Cancel returns to an inactive actionable card; retry opens sign-in; expired/401 token refreshes once and the server becomes Active with tools listed

### 201 — Repeated LAN scan keeps multiple servers unique  _(P2, 50% auto, PassA)_
- **Do:** Run Ollama and LM Studio or Gateway on two LAN endpoints -> Settings -> Remote Servers -> Scan Network twice
- **Expect:** First scan adds every reachable server once; second says Already Added; exactly one row per endpoint

### 202 — Every Get Pro action opens the new buy anchor  _(P1, 75% auto, PassA)_
- **Do:** Open Settings -> Off Grid AI PRO -> tap Get Pro; repeat from I have a license key -> Not a member yet Get Pro
- **Expect:** Both actions open https://getoffgridai.co/pro/#buy with UTM parameters before the #buy fragment

### 203 — Cold app-start comparison  _(P1, 0% auto, 0%auto)_
- **Do:** Force-stop production and candidate builds -> launch each 5 times on the same device -> time tap-to-usable Home
- **Expect:** No candidate hang; median candidate cold start is no more than 15 percent slower than production; record all five samples

### 204 — Warm app-start comparison  _(P2, 0% auto, 0%auto)_
- **Do:** Background then swipe away production and candidate after one completed boot -> relaunch each 5 times
- **Expect:** Median candidate warm start is no more than 15 percent slower than production; no blank frame or delayed navigation

### 205 — Cold model load and first-token comparison  _(P1, 0% auto, 0%auto)_
- **Do:** After Eject All select the same GGUF -> send the same short prompt 5 times per build with a cold load
- **Expect:** Median model-load and time-to-first-token are no more than 15 percent slower than production; no fallback surprise

### 206 — Warm decode throughput comparison  _(P1, 0% auto, 0%auto)_
- **Do:** Keep the same model resident -> send the same 256+ token prompt 5 times in production and candidate
- **Expect:** Median tokens per second is not more than 15 percent lower than production on the same backend; output completes

### 207 — Sustained generation and thermal soak  _(P1, 0% auto, 0%auto)_
- **Do:** Run at least 20 substantial local turns or 30 minutes on external power while watching device temperature and tok/s
- **Expect:** No crash, jetsam, stuck generation, or unbounded slowdown; throttling is recorded with turn number temperature and tok/s; context-full recovery remains actionable

### 208 — Large-chat render and scroll responsiveness  _(P2, 0% auto, 0%auto)_
- **Do:** Open a chat with 200+ mixed messages including markdown images thinking and tool blocks -> rapidly scroll end-to-end and open older blocks
- **Expect:** Scrolling remains responsive; no missing or duplicated rows; composer input latency stays acceptable; memory does not climb on each pass

### 212 — Release performance evidence complete  _(P1, 0% auto, 0%auto)_
- **Do:** Export Settings -> Debug Logs after the performance phase and attach the filled CSV plus profiler or screen-recording samples
- **Expect:** Every performance row has device/build/backend numbers and evidence; any greater-than-15-percent regression has an owner or blocks release

### 213 — Slide-to-cancel pill renders correctly  _(P1, 0% auto, 0%auto)_
- **Do:** In an empty text-chat composer press and hold the microphone without moving your finger
- **Expect:** The Slide to cancel pill appears to the left of the mic on one unclipped line; it does not wrap smear or overlap the mic

### 214 — Slide-to-cancel distinguishes cancel from send  _(P1, 0% auto, 0%auto)_
- **Do:** Hold the mic and speak; first slide left past the cancel threshold and release; then record again and release without sliding
- **Expect:** The cancelled take produces no composer text; the ordinary release transcribes exactly one take into the composer

### 215 — Cold Whisper load has no ghost recording  _(P0, 75% auto, P0-gap)_
- **Do:** Evict Whisper or cold-launch with only a downloaded STT model -> press and hold mic -> release while the loading spinner is still visible -> wait -> record normally
- **Expect:** The released cold-load attempt cancels cleanly with no transcript and no background privacy indicator; the next attempt records and stops normally

### 216 — iOS Debug build name is distinct  _(P2, 0% auto, 0%auto)_
- **Do:** Install the Debug ai.offgridmobile.dev build on an iPhone and inspect its home-screen icon label
- **Expect:** The label is Off Grid AI Debug; it is not blank literal variable text or the release-app name

### 217 — SDXL Core ML finalization and first compile  _(P1, 0% auto, 0%auto)_
- **Do:** On iPhone download an SDXL Core ML image model -> wait for finalization -> generate the first image
- **Expect:** The model registers without a missing-file error and the first ANE compile/generation finishes without app crash or jetsam; any true device-limit refusal is shown before native load

### 218 — Low-RAM curated LiteRT remains available with warning  _(P1, 0% auto, 0%auto)_
- **Do:** On an Android device where Gemma 4 E4B LiteRT exceeds the normal fit budget open it from onboarding and Models
- **Expect:** The card remains visible on both surfaces and Download shows a may-exceed-memory warning with a deliberate continue action; it is not silently hidden

### 219 — TTS pressure failure remains actionable  _(P1, 0% auto, 0%auto)_
- **Do:** In Voice mode keep a large text model resident and request spoken output on a device where TTS cannot safely fit
- **Expect:** Speech either completes after safe reclaim or shows a visible actionable memory failure with Load Anyway subject to the survival floor; the speaker never silently stops

### 228 — Remote server CRUD authentication and credential secrecy  _(P0, 75% auto, P0-gap)_
- **Do:** Add a server with an API key -> trigger one 401 -> correct credentials -> switch models -> edit endpoint -> delete server -> inspect UI persistence and Debug Logs
- **Expect:** Authentication recovers; active selection stays coherent; delete removes server and active model; the API key never appears in UI persisted JSON exported logs or debug output

### 229 — Live Pro activation revocation and reactivation  _(P0, 75% auto, P0-gap)_
- **Do:** Activate Pro -> use a paid surface -> revoke or expire entitlement while app backgrounds -> foreground -> reactivate twice
- **Expect:** Pro UI appears live then disappears live on revocation; gated clients stop; repeated activation creates no duplicate routes hooks clients or tools

### 231 — App Lock blocks background and direct-route bypass  _(P0, 50% auto, P0-gap)_
- **Do:** Enable App Lock -> open a private chat -> background and foreground -> try a notification or deep navigation route while locked -> unlock
- **Expect:** Lock covers the whole app before protected navigation; no private content flashes; unlock returns to the same chat with history intact

### 234 — Debug Logs view export clear and secret redaction  _(P0, 75% auto, P0-gap)_
- **Do:** Exercise local remote Pro and MCP flows with distinctive fake secrets -> open Debug Logs -> export -> clear -> reopen
- **Expect:** Logs render and export; API keys tokens license keys and authorization headers are redacted; Clear empties the view and file without touching user chats

### 237 — Corrupt persisted settings recover without losing unrelated data  _(P0, 75% auto, P0-gap)_
- **Do:** In a debug build corrupt only the persisted settings payload while retaining chats and projects -> cold launch
- **Expect:** App reaches a usable onboarding or Home state with safe settings; unrelated chats and projects remain; no boot loop or blank screen

### 238 — Partial filesystem initialization recovers  _(P0, 75% auto, P0-gap)_
- **Do:** In a debug build fail the first app-directory initialization -> launch -> open Models and retry after restoring filesystem access
- **Expect:** Core UI boots; retry initializes storage; a model can be selected and a chat turn completes; no permanent splash hang

### 239 — Interrupted storage write preserves the last commit  _(P0, 75% auto, P0-gap)_
- **Do:** Create a chat and project -> force an app kill or injected write failure during the next persistence write -> relaunch
- **Expect:** The last fully committed chat and project restore; partial newer data is discarded; storage remains writable afterward

### 240 — Optional Pro extension failure does not break Core  _(P0, 75% auto, P0-gap)_
- **Do:** Use a debug build that fails Pro native or JS extension initialization -> cold launch -> download or select a Core model -> chat
- **Expect:** Core onboarding models settings and chat remain usable; paid surfaces stay absent or show a contained error; no boot crash
