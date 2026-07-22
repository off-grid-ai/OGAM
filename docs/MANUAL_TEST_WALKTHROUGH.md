# Off Grid Mobile — Prioritized Manual Test Walkthrough

**Release candidate:** PR #571 (`fix/onboarding-analyzing-device-hang` → `main`, ~300 commits, 159 source files — a whole-product release).

Work this list **top to bottom**. It is ordered by release risk: all P0 first, then P1, then P2; and within each priority the **least-automated (riskiest) checks come first**, so your manual effort lands where the safety net is thinnest.

## How to use
- Test each row on **1 current Android + 1 current iPhone**; run memory/perf/thermal rows on a **low-RAM device** too. Record **light and dark**.
- **iOS has no automated signal** — every row needs a real iOS pass.
- Mark A (Android) / i (iOS): `P`ass · `F`ail · `B`locked · `N/A`.

## Confidence key (from automated coverage)
| Level | Auto % | Meaning |
|-------|--------|---------|
| **NONE** | 0% | Manual only — nothing automated covers this |
| **LOW** | 1–49% | Thin automation — verify carefully by hand |
| **PARTIAL** | 50–69% | Core path automated, edges are manual |
| **HIGH** | 70–99% | Strongly automated — manual confirmation |
| **FULL** | 100% | Fully automated — quick manual spot-check only |

## Release-block rule
Any reproducible **P0** failure, any **P1** regression vs current production, or any crash / data-loss / stuck-state / secret-in-logs **blocks the release**. A P2 needs an issue + owner + explicit decision.

**Totals:** 247 checks — P0 37, P1 133, P2 77. Confidence — NONE 13, LOW 1, PARTIAL 54, HIGH 107, FULL 72.

---

## Master priority list (test in this order)

| Order | Pri | Conf | Auto% | Manual? | ID | Area | Check | And | iOS |
|:-:|:-:|:-:|:-:|:-:|:-:|---|---|:-:|:-:|
| 1 | P0 | PARTIAL | 50 | YES | 1 | Install | Fresh install launches | ☐ | ☐ |
| 2 | P0 | PARTIAL | 50 | YES | 18 | Downloads | Interrupted download recovers after relaunch | ☐ | ☐ |
| 3 | P0 | PARTIAL | 50 | YES | 53 | Voice | Chat-mode dictation to composer | ☐ | ☐ |
| 4 | P0 | PARTIAL | 50 | YES | 54 | Voice | Chat-mode dictation on litert | ☐ | ☐ |
| 5 | P0 | PARTIAL | 50 | YES | 55 | Voice | Voice note carries transcript (chat mode) | ☐ | ☐ |
| 6 | P0 | PARTIAL | 50 | YES | 60 | Voice | Full voice-mode journey (STT->reply->TTS) | ☐ | ☐ |
| 7 | P0 | PARTIAL | 50 | YES | 99 | Memory | Oversized model shows a graceful card | ☐ | ☐ |
| 8 | P0 | PARTIAL | 50 | YES | 101 | Memory | Load Anyway bypasses a cautious refusal | ☐ | ☐ |
| 9 | P0 | PARTIAL | 50 | YES | 180 | This-release | Gemma-4 native-first thinking + tool | ☐ | ☐ |
| 10 | P0 | PARTIAL | 50 | YES | 181 | This-release | Upgrade-over-install keeps data + loading mode | ☐ | ☐ |
| 11 | P0 | PARTIAL | 50 | YES | 187 | This-release | Queued downloads survive app kill | ☐ | ☐ |
| 12 | P0 | PARTIAL | 50 | YES | 231 | Changed-owner audit | App Lock blocks background and direct-route bypass | ☐ | ☐ |
| 13 | P0 | HIGH | 75 | YES | 4 | Downloads | Download a text (GGUF) model | ☐ | ☐ |
| 14 | P0 | HIGH | 75 | YES | 9 | Downloads | Download an STT (whisper) model | ☐ | ☐ |
| 15 | P0 | HIGH | 75 | YES | 11 | Downloads | Download a TTS (voice) model | ☐ | ☐ |
| 16 | P0 | HIGH | 75 | YES | 23 | Text gen | First message loads + replies (GGUF) | ☐ | ☐ |
| 17 | P0 | HIGH | 75 | YES | 43 | Text gen | Stop mid-generation keeps partial | ☐ | ☐ |
| 18 | P0 | HIGH | 75 | YES | 66 | Image | Image generates and renders | ☐ | ☐ |
| 19 | P0 | HIGH | 75 | YES | 86 | Memory | Whisper not resident on download | ☐ | ☐ |
| 20 | P0 | HIGH | 75 | YES | 87 | Memory | Conservative = one heavy at a time | ☐ | ☐ |
| 21 | P0 | HIGH | 75 | YES | 88 | Memory | Balanced = co-reside if they fit | ☐ | ☐ |
| 22 | P0 | HIGH | 75 | YES | 93 | Memory | Idle STT reclaimed for a text turn | ☐ | ☐ |
| 23 | P0 | HIGH | 75 | YES | 171 | Polish | Download entries survive relaunch | ☐ | ☐ |
| 24 | P0 | HIGH | 75 | YES | 195 | This-release | Boot is independent of download database recovery | ☐ | ☐ |
| 25 | P0 | HIGH | 75 | YES | 215 | Device-only legacy | Cold Whisper load has no ghost recording | ☐ | ☐ |
| 26 | P0 | HIGH | 75 | YES | 228 | Changed-owner audit | Remote server CRUD authentication and credential secrecy | ☐ | ☐ |
| 27 | P0 | HIGH | 75 | YES | 229 | Changed-owner audit | Live Pro activation revocation and reactivation | ☐ | ☐ |
| 28 | P0 | HIGH | 75 | YES | 234 | Changed-owner audit | Debug Logs view export clear and secret redaction | ☐ | ☐ |
| 29 | P0 | HIGH | 75 | YES | 237 | Fault recovery | Corrupt persisted settings recover without losing unrelated data | ☐ | ☐ |
| 30 | P0 | HIGH | 75 | YES | 238 | Fault recovery | Partial filesystem initialization recovers | ☐ | ☐ |
| 31 | P0 | HIGH | 75 | YES | 239 | Fault recovery | Interrupted storage write preserves the last commit | ☐ | ☐ |
| 32 | P0 | HIGH | 75 | YES | 240 | Fault recovery | Optional Pro extension failure does not break Core | ☐ | ☐ |
| 33 | P0 | FULL | 100 | spot | 42 | Text gen | Failed generation clears the spinner | ☐ | ☐ |
| 34 | P0 | FULL | 100 | spot | 85 | Memory | Loading mode selectable + persists | ☐ | ☐ |
| 35 | P0 | FULL | 100 | spot | 167 | Polish | Chat history survives relaunch | ☐ | ☐ |
| 36 | P0 | FULL | 100 | spot | 168 | Polish | Downloaded models survive relaunch | ☐ | ☐ |
| 37 | P0 | FULL | 100 | spot | 197 | This-release | Chats New with no selected model opens after local selection | ☐ | ☐ |
| 38 | P1 | NONE | 0 | YES | 203 | Performance | Cold app-start comparison | ☐ | ☐ |
| 39 | P1 | NONE | 0 | YES | 205 | Performance | Cold model load and first-token comparison | ☐ | ☐ |
| 40 | P1 | NONE | 0 | YES | 206 | Performance | Warm decode throughput comparison | ☐ | ☐ |
| 41 | P1 | NONE | 0 | YES | 207 | Performance | Sustained generation and thermal soak | ☐ | ☐ |
| 42 | P1 | NONE | 0 | YES | 212 | Performance | Release performance evidence complete | ☐ | ☐ |
| 43 | P1 | NONE | 0 | YES | 213 | Device-only legacy | Slide-to-cancel pill renders correctly | ☐ | ☐ |
| 44 | P1 | NONE | 0 | YES | 214 | Device-only legacy | Slide-to-cancel distinguishes cancel from send | ☐ | ☐ |
| 45 | P1 | NONE | 0 | YES | 217 | Device-only legacy | SDXL Core ML finalization and first compile | ☐ | ☐ |
| 46 | P1 | NONE | 0 | YES | 218 | Device-only legacy | Low-RAM curated LiteRT remains available with warning | ☐ | ☐ |
| 47 | P1 | NONE | 0 | YES | 219 | Device-only legacy | TTS pressure failure remains actionable | ☐ | ☐ |
| 48 | P1 | PARTIAL | 50 | YES | 13 | Downloads | Download a LARGE text model | ☐ | ☐ |
| 49 | P1 | PARTIAL | 50 | YES | 25 | Text gen | GPU/OpenCL backend | ☐ | ☐ |
| 50 | P1 | PARTIAL | 50 | YES | 29 | Text gen | litert CPU backend fails gracefully | ☐ | ☐ |
| 51 | P1 | PARTIAL | 50 | YES | 30 | Text gen | NPU/HTP backend gated or graceful | ☐ | ☐ |
| 52 | P1 | PARTIAL | 50 | YES | 51 | Voice | Mic permission prompt on first record | ☐ | ☐ |
| 53 | P1 | PARTIAL | 50 | YES | 52 | Voice | Mic permission DENIED handled gracefully | ☐ | ☐ |
| 54 | P1 | PARTIAL | 50 | YES | 56 | Voice | Voice note transcript on litert + tool | ☐ | ☐ |
| 55 | P1 | PARTIAL | 50 | YES | 57 | Voice | Mic stops cleanly on leave | ☐ | ☐ |
| 56 | P1 | PARTIAL | 50 | YES | 59 | Voice | Voice-mode transcript renders | ☐ | ☐ |
| 57 | P1 | PARTIAL | 50 | YES | 61 | Voice | Voice draw-request routes to image | ☐ | ☐ |
| 58 | P1 | PARTIAL | 50 | YES | 62 | Voice | Voice calculator journey | ☐ | ☐ |
| 59 | P1 | PARTIAL | 50 | YES | 63 | Voice | Voice-mode Stop button while generating | ☐ | ☐ |
| 60 | P1 | PARTIAL | 50 | YES | 82 | Vision | Big vision model decode handled | ☐ | ☐ |
| 61 | P1 | PARTIAL | 50 | YES | 96 | Memory | OS memory-warning evicts idle sidecars | ☐ | ☐ |
| 62 | P1 | PARTIAL | 50 | YES | 102 | Memory | Survival floor blocks a guaranteed OOM | ☐ | ☐ |
| 63 | P1 | PARTIAL | 50 | YES | 154 | TTS | Speak a reply | ☐ | ☐ |
| 64 | P1 | PARTIAL | 50 | YES | 164 | Polish | App lock passphrase set + enforce | ☐ | ☐ |
| 65 | P1 | PARTIAL | 50 | YES | 172 | Polish | Background -> foreground mid-generation | ☐ | ☐ |
| 66 | P1 | PARTIAL | 50 | YES | 173 | Polish | Kill mid-generation recovers | ☐ | ☐ |
| 67 | P1 | PARTIAL | 50 | YES | 174 | Polish | Airplane mode local-only still works | ☐ | ☐ |
| 68 | P1 | PARTIAL | 50 | YES | 186 | This-release | Remote stream interruption recovers | ☐ | ☐ |
| 69 | P1 | PARTIAL | 50 | YES | 191 | This-release | GPU->CPU fallback is visibly reported | ☐ | ☐ |
| 70 | P1 | PARTIAL | 50 | YES | 209 | Performance | Repeated model-swap memory stability | ☐ | ☐ |
| 71 | P1 | PARTIAL | 50 | YES | 210 | Performance | Download-load UI contention | ☐ | ☐ |
| 72 | P1 | PARTIAL | 50 | YES | 211 | Performance | Background foreground latency and continuity | ☐ | ☐ |
| 73 | P1 | PARTIAL | 50 | YES | 236 | Changed-owner audit | LiteRT vision RAM-clamped context recovery | ☐ | ☐ |
| 74 | P1 | PARTIAL | 50 | YES | 246 | Legacy replacement audit | Queued image model card stays truthful | ☐ | ☐ |
| 75 | P1 | PARTIAL | 50 | YES | 247 | Legacy replacement audit | TTS playback queue and failure recovery | ☐ | ☐ |
| 76 | P1 | HIGH | 75 | YES | 7 | Downloads | Download a vision model (mmproj) | ☐ | ☐ |
| 77 | P1 | HIGH | 75 | YES | 12 | Downloads | Download an image model | ☐ | ☐ |
| 78 | P1 | HIGH | 75 | YES | 14 | Downloads | Download a litert model | ☐ | ☐ |
| 79 | P1 | HIGH | 75 | YES | 15 | Downloads | Delete does not cancel another download | ☐ | ☐ |
| 80 | P1 | HIGH | 75 | YES | 16 | Downloads | Concurrent / queued downloads | ☐ | ☐ |
| 81 | P1 | HIGH | 75 | YES | 17 | Downloads | Download with NO network | ☐ | ☐ |
| 82 | P1 | HIGH | 75 | YES | 19 | Downloads | Truncated file not listed as ready | ☐ | ☐ |
| 83 | P1 | HIGH | 75 | YES | 20 | Downloads | Kill mid-extraction recovers | ☐ | ☐ |
| 84 | P1 | HIGH | 75 | YES | 21 | Downloads | Retry a failed image extraction | ☐ | ☐ |
| 85 | P1 | HIGH | 75 | YES | 24 | Text gen | First message replies (litert) | ☐ | ☐ |
| 86 | P1 | HIGH | 75 | YES | 28 | Text gen | GPU layers slider applies | ☐ | ☐ |
| 87 | P1 | HIGH | 75 | YES | 31 | Text gen | Temperature applies to a generation | ☐ | ☐ |
| 88 | P1 | HIGH | 75 | YES | 33 | Text gen | Context length applies | ☐ | ☐ |
| 89 | P1 | HIGH | 75 | YES | 34 | Text gen | System prompt applies | ☐ | ☐ |
| 90 | P1 | HIGH | 75 | YES | 67 | Image | Image Size + Guidance honored | ☐ | ☐ |
| 91 | P1 | HIGH | 75 | YES | 69 | Image | Image steps applies | ☐ | ☐ |
| 92 | P1 | HIGH | 75 | YES | 80 | Vision | Vision answers about an image | ☐ | ☐ |
| 93 | P1 | HIGH | 75 | YES | 83 | Vision | litert vision affordance consistent | ☐ | ☐ |
| 94 | P1 | HIGH | 75 | YES | 84 | Vision | Non-vision model image is refused gracefully | ☐ | ☐ |
| 95 | P1 | HIGH | 75 | YES | 89 | Memory | Text + whisper co-reside (roomy) | ☐ | ☐ |
| 96 | P1 | HIGH | 75 | YES | 90 | Memory | Sidecars co-reside with a heavy | ☐ | ☐ |
| 97 | P1 | HIGH | 75 | YES | 94 | Memory | Idle STT reclaimed in a voice turn | ☐ | ☐ |
| 98 | P1 | HIGH | 75 | YES | 95 | Memory | Whisper blocked then freed then retried | ☐ | ☐ |
| 99 | P1 | HIGH | 75 | YES | 97 | Memory | Aggressive loads bigger automatically | ☐ | ☐ |
| 100 | P1 | HIGH | 75 | YES | 100 | Memory | Estimators agree (no safe-then-refuse) | ☐ | ☐ |
| 101 | P1 | HIGH | 75 | YES | 103 | Memory | Image->chat swap | ☐ | ☐ |
| 102 | P1 | HIGH | 75 | YES | 104 | Memory | Switch active model mid-chat | ☐ | ☐ |
| 103 | P1 | HIGH | 75 | YES | 105 | Memory | Eject All frees everything | ☐ | ☐ |
| 104 | P1 | HIGH | 75 | YES | 106 | Memory | Eject one resident from In Memory | ☐ | ☐ |
| 105 | P1 | HIGH | 75 | YES | 107 | Memory | Lazy reload after eject | ☐ | ☐ |
| 106 | P1 | HIGH | 75 | YES | 108 | Memory | In Memory shows loaded model RAM | ☐ | ☐ |
| 107 | P1 | HIGH | 75 | YES | 109 | Memory | Stale TTS pressure cleared on delete | ☐ | ☐ |
| 108 | P1 | HIGH | 75 | YES | 113 | KB/Projects | KB indexes a text PDF | ☐ | ☐ |
| 109 | P1 | HIGH | 75 | YES | 117 | KB/Projects | Embedding failure aborts + retry | ☐ | ☐ |
| 110 | P1 | HIGH | 75 | YES | 118 | KB/Projects | KB retrieval in a chat | ☐ | ☐ |
| 111 | P1 | HIGH | 75 | YES | 133 | Tools | Add / connect an MCP server | ☐ | ☐ |
| 112 | P1 | HIGH | 75 | YES | 134 | Tools | MCP server tools listed | ☐ | ☐ |
| 113 | P1 | HIGH | 75 | YES | 135 | Tools | Execute an MCP tool | ☐ | ☐ |
| 114 | P1 | HIGH | 75 | YES | 138 | Remote | Remote model replies | ☐ | ☐ |
| 115 | P1 | HIGH | 75 | YES | 142 | Remote | Remote reasoning renders (LM Studio) | ☐ | ☐ |
| 116 | P1 | HIGH | 75 | YES | 143 | Remote | Remote parallel tool calls | ☐ | ☐ |
| 117 | P1 | HIGH | 75 | YES | 144 | Remote | Remote prompt-enhance runs | ☐ | ☐ |
| 118 | P1 | HIGH | 75 | YES | 145 | Remote | Remote server dies mid-generation | ☐ | ☐ |
| 119 | P1 | HIGH | 75 | YES | 182 | This-release | Parse-once thinking+tool+answer on litert | ☐ | ☐ |
| 120 | P1 | HIGH | 75 | YES | 183 | This-release | Parse-once thinking+tool+answer on remote | ☐ | ☐ |
| 121 | P1 | HIGH | 75 | YES | 184 | This-release | Remote activation frees local heavy | ☐ | ☐ |
| 122 | P1 | HIGH | 75 | YES | 188 | This-release | Litert download warning is device-aware (BOTH screens) | ☐ | ☐ |
| 123 | P1 | HIGH | 75 | YES | 194 | This-release | Embedded MTP activates only for capable GGUFs | ☐ | ☐ |
| 124 | P1 | HIGH | 75 | YES | 202 | This-release | Every Get Pro action opens the new buy anchor | ☐ | ☐ |
| 125 | P1 | HIGH | 75 | YES | 220 | Changed-owner audit | Download cancellation and duplicate-tap lifecycle | ☐ | ☐ |
| 126 | P1 | HIGH | 75 | YES | 222 | Changed-owner audit | Deleting the active resident chooses a coherent fallback | ☐ | ☐ |
| 127 | P1 | HIGH | 75 | YES | 223 | Changed-owner audit | Local GGUF import validation | ☐ | ☐ |
| 128 | P1 | HIGH | 75 | YES | 225 | Changed-owner audit | Sent image attachment survives relaunch and missing-file recovery | ☐ | ☐ |
| 129 | P1 | HIGH | 75 | YES | 226 | Changed-owner audit | LiteRT compaction survives relaunch | ☐ | ☐ |
| 130 | P1 | HIGH | 75 | YES | 227 | Changed-owner audit | Knowledge-base delete replace and reindex integrity | ☐ | ☐ |
| 131 | P1 | HIGH | 75 | YES | 230 | Changed-owner audit | Experimental MTP default toggle and persistence | ☐ | ☐ |
| 132 | P1 | HIGH | 75 | YES | 232 | Changed-owner audit | MCP relaunch reconnect is deduplicated | ☐ | ☐ |
| 133 | P1 | HIGH | 75 | YES | 241 | Retained PR558 | Image download Wi-Fi failure retries and finalizes | ☐ | ☐ |
| 134 | P1 | HIGH | 75 | YES | 245 | Legacy replacement audit | TTS download progress stays consistent across surfaces | ☐ | ☐ |
| 135 | P1 | FULL | 100 | spot | 2 | Install | Complete onboarding | ☐ | ☐ |
| 136 | P1 | FULL | 100 | spot | 8 | Downloads | Downloads badge count matches manager | ☐ | ☐ |
| 137 | P1 | FULL | 100 | spot | 38 | Text gen | Plain reply has no stray think tags | ☐ | ☐ |
| 138 | P1 | FULL | 100 | spot | 39 | Text gen | Thinking renders in block mid-stream | ☐ | ☐ |
| 139 | P1 | FULL | 100 | spot | 44 | Text gen | Queue while generating | ☐ | ☐ |
| 140 | P1 | FULL | 100 | spot | 46 | Text gen | Edit a user message and resend | ☐ | ☐ |
| 141 | P1 | FULL | 100 | spot | 47 | Text gen | Regenerate a reply | ☐ | ☐ |
| 142 | P1 | FULL | 100 | spot | 48 | Text gen | Mid-conversation sampler change takes effect | ☐ | ☐ |
| 143 | P1 | FULL | 100 | spot | 70 | Image | Tap image opens fullscreen preview | ☐ | ☐ |
| 144 | P1 | FULL | 100 | spot | 72 | Image | Non-draw prompt routes to text | ☐ | ☐ |
| 145 | P1 | FULL | 100 | spot | 73 | Image | Resend of an image request re-draws | ☐ | ☐ |
| 146 | P1 | FULL | 100 | spot | 112 | KB/Projects | Create a project | ☐ | ☐ |
| 147 | P1 | FULL | 100 | spot | 119 | KB/Projects | New chat inherits the project | ☐ | ☐ |
| 148 | P1 | FULL | 100 | spot | 122 | KB/Projects | Delete project handles its chats | ☐ | ☐ |
| 149 | P1 | FULL | 100 | spot | 123 | Tools | Calculator tool runs | ☐ | ☐ |
| 150 | P1 | FULL | 100 | spot | 127 | Tools | Parallel tool calls | ☐ | ☐ |
| 151 | P1 | FULL | 100 | spot | 129 | Tools | Messy tool JSON still runs | ☐ | ☐ |
| 152 | P1 | FULL | 100 | spot | 132 | Tools | Empty final turn keeps tool data | ☐ | ☐ |
| 153 | P1 | FULL | 100 | spot | 150 | Enhancement | Enhancement request carries no thinking | ☐ | ☐ |
| 154 | P1 | FULL | 100 | spot | 151 | Enhancement | Enhanced prompt is a clean rewrite | ☐ | ☐ |
| 155 | P1 | FULL | 100 | spot | 155 | TTS | TTS text is markdown-stripped | ☐ | ☐ |
| 156 | P1 | FULL | 100 | spot | 166 | Polish | Settings persist across relaunch | ☐ | ☐ |
| 157 | P1 | FULL | 100 | spot | 169 | Polish | Active model selection survives relaunch | ☐ | ☐ |
| 158 | P1 | FULL | 100 | spot | 170 | Polish | Projects + KB survive relaunch | ☐ | ☐ |
| 159 | P1 | FULL | 100 | spot | 185 | This-release | Mid-chat model switch stays coherent | ☐ | ☐ |
| 160 | P1 | FULL | 100 | spot | 190 | This-release | Send racing a settings reload keeps thinking | ☐ | ☐ |
| 161 | P1 | FULL | 100 | spot | 192 | This-release | Mic during a background STT download is not a loader | ☐ | ☐ |
| 162 | P1 | FULL | 100 | spot | 193 | This-release | Stale failure card cleared when a new attempt starts | ☐ | ☐ |
| 163 | P1 | FULL | 100 | spot | 196 | This-release | Model file-list failure is retryable | ☐ | ☐ |
| 164 | P1 | FULL | 100 | spot | 198 | This-release | Interleaved thinking blocks stay isolated | ☐ | ☐ |
| 165 | P1 | FULL | 100 | spot | 221 | Changed-owner audit | Model browse filter tab and fit-chip lifecycle | ☐ | ☐ |
| 166 | P1 | FULL | 100 | spot | 224 | Changed-owner audit | Conversation create rename open and delete coherence | ☐ | ☐ |
| 167 | P1 | FULL | 100 | spot | 235 | Changed-owner audit | Home and Chat model pickers remain identical | ☐ | ☐ |
| 168 | P1 | FULL | 100 | spot | 242 | Retained PR558 | Tool markup never leaks into visible replies | ☐ | ☐ |
| 169 | P1 | FULL | 100 | spot | 243 | Retained PR558 | Image resend without an image model falls back to text | ☐ | ☐ |
| 170 | P1 | FULL | 100 | spot | 244 | Retained PR558 | Queued forced-image request preserves image mode | ☐ | ☐ |
| 171 | P2 | NONE | 0 | YES | 204 | Performance | Warm app-start comparison | ☐ | ☐ |
| 172 | P2 | NONE | 0 | YES | 208 | Performance | Large-chat render and scroll responsiveness | ☐ | ☐ |
| 173 | P2 | NONE | 0 | YES | 216 | Device-only legacy | iOS Debug build name is distinct | ☐ | ☐ |
| 174 | P2 | LOW | 25 | YES | 175 | Polish | Thermal / long-context stress | ☐ | ☐ |
| 175 | P2 | PARTIAL | 50 | YES | 27 | Text gen | GPU init timeout falls back to CPU | ☐ | ☐ |
| 176 | P2 | PARTIAL | 50 | YES | 58 | Voice | Double-tap mic no collision | ☐ | ☐ |
| 177 | P2 | PARTIAL | 50 | YES | 65 | Voice | Voice thinking block width + alignment | ☐ | ☐ |
| 178 | P2 | PARTIAL | 50 | YES | 78 | Vision | Photo permission prompt on first attach | ☐ | ☐ |
| 179 | P2 | PARTIAL | 50 | YES | 79 | Vision | Photo permission DENIED handled gracefully | ☐ | ☐ |
| 180 | P2 | PARTIAL | 50 | YES | 98 | Memory | Aggressive does not over-commit dirty | ☐ | ☐ |
| 181 | P2 | PARTIAL | 50 | YES | 111 | Memory | Device info memory readout | ☐ | ☐ |
| 182 | P2 | PARTIAL | 50 | YES | 161 | Polish | Orientation behavior | ☐ | ☐ |
| 183 | P2 | PARTIAL | 50 | YES | 177 | Polish | Follow on X opens the profile | ☐ | ☐ |
| 184 | P2 | PARTIAL | 50 | YES | 178 | Polish | Join Slack opens the invite | ☐ | ☐ |
| 185 | P2 | PARTIAL | 50 | YES | 179 | Polish | Share on X prefilled | ☐ | ☐ |
| 186 | P2 | PARTIAL | 50 | YES | 200 | This-release | MCP OAuth cancel refresh and retry | ☐ | ☐ |
| 187 | P2 | PARTIAL | 50 | YES | 201 | This-release | Repeated LAN scan keeps multiple servers unique | ☐ | ☐ |
| 188 | P2 | PARTIAL | 50 | YES | 233 | Changed-owner audit | Support links fail gracefully | ☐ | ☐ |
| 189 | P2 | HIGH | 75 | YES | 3 | Install | Onboarding skip when server+model already set | ☐ | ☐ |
| 190 | P2 | HIGH | 75 | YES | 10 | Downloads | Download a second whisper model | ☐ | ☐ |
| 191 | P2 | HIGH | 75 | YES | 22 | Downloads | Download an embedding model (first KB use) | ☐ | ☐ |
| 192 | P2 | HIGH | 75 | YES | 26 | Text gen | CPU backend (GGUF) | ☐ | ☐ |
| 193 | P2 | HIGH | 75 | YES | 32 | Text gen | Top-P applies to a generation | ☐ | ☐ |
| 194 | P2 | HIGH | 75 | YES | 35 | Text gen | CPU threads applies | ☐ | ☐ |
| 195 | P2 | HIGH | 75 | YES | 36 | Text gen | Batch size applies | ☐ | ☐ |
| 196 | P2 | HIGH | 75 | YES | 37 | Text gen | Flash attention toggle applies | ☐ | ☐ |
| 197 | P2 | HIGH | 75 | YES | 45 | Text gen | Copy a message | ☐ | ☐ |
| 198 | P2 | HIGH | 75 | YES | 50 | Text gen | Context-full new-chat prompt | ☐ | ☐ |
| 199 | P2 | HIGH | 75 | YES | 76 | Image | First-gen warmup notice is accurate | ☐ | ☐ |
| 200 | P2 | HIGH | 75 | YES | 77 | Image | Generated images appear in Gallery | ☐ | ☐ |
| 201 | P2 | HIGH | 75 | YES | 81 | Vision | Image + text in one turn | ☐ | ☐ |
| 202 | P2 | HIGH | 75 | YES | 91 | Memory | TTS co-resident in a voice turn | ☐ | ☐ |
| 203 | P2 | HIGH | 75 | YES | 92 | Memory | Embedding sidecar resident on KB embed | ☐ | ☐ |
| 204 | P2 | HIGH | 75 | YES | 110 | Memory | Delete mid-playback does not kill audio | ☐ | ☐ |
| 205 | P2 | HIGH | 75 | YES | 114 | KB/Projects | Preview a KB document | ☐ | ☐ |
| 206 | P2 | HIGH | 75 | YES | 115 | KB/Projects | Scanned PDF clear message | ☐ | ☐ |
| 207 | P2 | HIGH | 75 | YES | 116 | KB/Projects | >5MB file rejected | ☐ | ☐ |
| 208 | P2 | HIGH | 75 | YES | 125 | Tools | Device info tool runs | ☐ | ☐ |
| 209 | P2 | HIGH | 75 | YES | 126 | Tools | Web search tool runs | ☐ | ☐ |
| 210 | P2 | HIGH | 75 | YES | 136 | Tools | MCP tool error handled | ☐ | ☐ |
| 211 | P2 | HIGH | 75 | YES | 141 | Remote | Remote reasoning renders (Ollama) | ☐ | ☐ |
| 212 | P2 | HIGH | 75 | YES | 146 | Remote | Remote request timeout | ☐ | ☐ |
| 213 | P2 | HIGH | 75 | YES | 147 | Remote | Malformed remote response handled | ☐ | ☐ |
| 214 | P2 | HIGH | 75 | YES | 160 | Polish | Long-text wrapping | ☐ | ☐ |
| 215 | P2 | HIGH | 75 | YES | 162 | Polish | About screen renders | ☐ | ☐ |
| 216 | P2 | HIGH | 75 | YES | 176 | Polish | Stay-in-the-loop card placement | ☐ | ☐ |
| 217 | P2 | FULL | 100 | spot | 5 | Downloads | Downloaded model shows Downloaded indicator | ☐ | ☐ |
| 218 | P2 | FULL | 100 | spot | 6 | Downloads | Model info / credibility shown on the card | ☐ | ☐ |
| 219 | P2 | FULL | 100 | spot | 40 | Text gen | Thinking header reads Thinking while streaming | ☐ | ☐ |
| 220 | P2 | FULL | 100 | spot | 41 | Text gen | Long output cutoff indicator | ☐ | ☐ |
| 221 | P2 | FULL | 100 | spot | 49 | Text gen | Reset to Defaults (text params) | ☐ | ☐ |
| 222 | P2 | FULL | 100 | spot | 64 | Voice | No stray empty bubble in voice tool turn | ☐ | ☐ |
| 223 | P2 | FULL | 100 | spot | 68 | Image | Image size floors at 256 | ☐ | ☐ |
| 224 | P2 | FULL | 100 | spot | 71 | Image | Tap attached (pre-send) image previews | ☐ | ☐ |
| 225 | P2 | FULL | 100 | spot | 74 | Image | Reset to Defaults resets image params | ☐ | ☐ |
| 226 | P2 | FULL | 100 | spot | 75 | Image | Chat-modal vs Model-Settings sliders agree | ☐ | ☐ |
| 227 | P2 | FULL | 100 | spot | 120 | KB/Projects | Context-full new chat keeps project | ☐ | ☐ |
| 228 | P2 | FULL | 100 | spot | 121 | KB/Projects | Edit a project | ☐ | ☐ |
| 229 | P2 | FULL | 100 | spot | 124 | Tools | Datetime tool runs | ☐ | ☐ |
| 230 | P2 | FULL | 100 | spot | 128 | Tools | Thinking + tool + answer render in order | ☐ | ☐ |
| 231 | P2 | FULL | 100 | spot | 130 | Tools | Stringified tool args parsed | ☐ | ☐ |
| 232 | P2 | FULL | 100 | spot | 131 | Tools | Tool router no false positive | ☐ | ☐ |
| 233 | P2 | FULL | 100 | spot | 137 | Tools | MCP guide screen renders | ☐ | ☐ |
| 234 | P2 | FULL | 100 | spot | 139 | Remote | No phantom servers on empty scan | ☐ | ☐ |
| 235 | P2 | FULL | 100 | spot | 140 | Remote | Remote model has a visible indicator | ☐ | ☐ |
| 236 | P2 | FULL | 100 | spot | 148 | Remote | Local select makes the model active | ☐ | ☐ |
| 237 | P2 | FULL | 100 | spot | 149 | Remote | Home Text count truthful with remote active | ☐ | ☐ |
| 238 | P2 | FULL | 100 | spot | 152 | Enhancement | Enhancement shows progress | ☐ | ☐ |
| 239 | P2 | FULL | 100 | spot | 153 | Enhancement | Enhancement rewrites then regenerates | ☐ | ☐ |
| 240 | P2 | FULL | 100 | spot | 156 | Polish | Theme switch applies (System/Light/Dark) | ☐ | ☐ |
| 241 | P2 | FULL | 100 | spot | 157 | Polish | Empty state: no models | ☐ | ☐ |
| 242 | P2 | FULL | 100 | spot | 158 | Polish | Empty state: no chats | ☐ | ☐ |
| 243 | P2 | FULL | 100 | spot | 159 | Polish | Empty state: no KB docs | ☐ | ☐ |
| 244 | P2 | FULL | 100 | spot | 163 | Polish | Storage usage screen | ☐ | ☐ |
| 245 | P2 | FULL | 100 | spot | 165 | Polish | Share/promo sheet once per session | ☐ | ☐ |
| 246 | P2 | FULL | 100 | spot | 189 | This-release | TTS download respects the concurrency cap | ☐ | ☐ |
| 247 | P2 | FULL | 100 | spot | 199 | This-release | Tool enable and disable persist | ☐ | ☐ |

---

## Replication steps (same order)

# ── P0 ──

### 1. [PARTIAL·50%auto] #1 — Fresh install launches
*P0 · 0 Install · Core path automated, edges manual*
- **Do:** Delete the app first then install the fresh build and open it
- **Expect:** App launches with no crash; onboarding appears
- **Result:** Android ☐  ·  iOS ☐

### 2. [PARTIAL·50%auto] #18 — Interrupted download recovers after relaunch
*P0 · 1 Downloads · Core path automated, edges manual*
- **Do:** Start a NEW download -> force-kill the app mid-download -> reopen -> Download Manager
- **Expect:** A retriable/failed entry is shown after a full cold relaunch; NO phantom/stuck entry
- **Result:** Android ☐  ·  iOS ☐

### 3. [PARTIAL·50%auto] #53 — Chat-mode dictation to composer
*P0 · 3 Voice · Core path automated, edges manual*
- **Do:** In a text chat hold the mic and speak (GGUF model active)
- **Expect:** The transcribed words appear in the INPUT BOX to review/send
- **Result:** Android ☐  ·  iOS ☐

### 4. [PARTIAL·50%auto] #54 — Chat-mode dictation on litert
*P0 · 3 Voice · Core path automated, edges manual*
- **Do:** Repeat the hold-to-talk dictation with a litert model active - Android
- **Expect:** Transcript lands in the input box
- **Result:** Android ☐  ·  iOS ☐

### 5. [PARTIAL·50%auto] #55 — Voice note carries transcript (chat mode)
*P0 · 3 Voice · Core path automated, edges manual*
- **Do:** Record a voice note in chat mode -> send
- **Expect:** The note is sent WITH the transcribed text (not empty / not raw audio)
- **Result:** Android ☐  ·  iOS ☐

### 6. [PARTIAL·50%auto] #60 — Full voice-mode journey (STT->reply->TTS)
*P0 · 3 Voice · Core path automated, edges manual*
- **Do:** Voice mode -> speak a question -> let it reply
- **Expect:** Speak -> transcribed -> model replies -> TTS speaks the reply
- **Result:** Android ☐  ·  iOS ☐

### 7. [PARTIAL·50%auto] #99 — Oversized model shows a graceful card
*P0 · 5 Memory · Core path automated, edges manual*
- **Do:** Try to load a model too big for the device
- **Expect:** Not Enough Memory card appears WITH a Load Anyway button (never a crash / dead-end)
- **Result:** Android ☐  ·  iOS ☐

### 8. [PARTIAL·50%auto] #101 — Load Anyway bypasses a cautious refusal
*P0 · 5 Memory · Core path automated, edges manual*
- **Do:** On the Not Enough Memory card tap Load Anyway
- **Expect:** It evicts other models and loads when the post-eviction survival check is safe; the hard survival floor remains authoritative
- **Result:** Android ☐  ·  iOS ☐

### 9. [PARTIAL·50%auto] #180 — Gemma-4 native-first thinking + tool
*P0 · 12 This-release · Core path automated, edges manual*
- **Do:** Select Gemma-4 -> thinking ON + enable a tool -> send one turn that reasons then calls the tool
- **Expect:** Thinking block + tool-result bubble + answer all render correctly and IN ORDER
- **Result:** Android ☐  ·  iOS ☐

### 10. [PARTIAL·50%auto] #181 — Upgrade-over-install keeps data + loading mode
*P0 · 12 This-release · Core path automated, edges manual*
- **Do:** ALT to fresh install: install the CURRENT released build -> set Aggressive loading + download a model + have a chat -> install THIS build OVER it (no delete)
- **Expect:** Models/chats/downloads intact; loading mode reads Aggressive (not blank/default)
- **Result:** Android ☐  ·  iOS ☐

### 11. [PARTIAL·50%auto] #187 — Queued downloads survive app kill
*P0 · 12 This-release · Core path automated, edges manual*
- **Do:** Queue 6+ downloads so several sit Queued past the 3-slot cap -> force-kill the app -> relaunch
- **Expect:** App boots normally (no forever-load); EVERY queued item is back as Queued and auto-starts as slots free; nothing silently vanishes
- **Result:** Android ☐  ·  iOS ☐

### 12. [PARTIAL·50%auto] #231 — App Lock blocks background and direct-route bypass
*P0 · 15 Changed-owner audit · Core path automated, edges manual*
- **Do:** Enable App Lock -> open a private chat -> background and foreground -> try a notification or deep navigation route while locked -> unlock
- **Expect:** Lock covers the whole app before protected navigation; no private content flashes; unlock returns to the same chat with history intact
- **Result:** Android ☐  ·  iOS ☐

### 13. [HIGH·75%auto] #4 — Download a text (GGUF) model
*P0 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** Models -> pick a small text model (Qwen/Gemma) -> Download
- **Expect:** Progress advances -> completes -> shows Downloaded
- **Result:** Android ☐  ·  iOS ☐

### 14. [HIGH·75%auto] #9 — Download an STT (whisper) model
*P0 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** Settings/Models -> download a whisper model (base.en or medium)
- **Expect:** Completes and is selectable for voice; NOT auto-loaded into memory
- **Result:** Android ☐  ·  iOS ☐

### 15. [HIGH·75%auto] #11 — Download a TTS (voice) model
*P0 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** Download the TTS voice model (Kokoro)
- **Expect:** Completes and is usable for spoken replies
- **Result:** Android ☐  ·  iOS ☐

### 16. [HIGH·75%auto] #23 — First message loads + replies (GGUF)
*P0 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Select a text GGUF model -> New chat -> type -> Send
- **Expect:** Reply streams into an assistant bubble (lazy-load on first send)
- **Result:** Android ☐  ·  iOS ☐

### 17. [HIGH·75%auto] #43 — Stop mid-generation keeps partial
*P0 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Start a generation -> tap Stop mid-stream
- **Expect:** Generation halts; partial text retained; input returns to send state; queue advances
- **Result:** Android ☐  ·  iOS ☐

### 18. [HIGH·75%auto] #66 — Image generates and renders
*P0 · 4 Image · Strongly automated — manual confirm*
- **Do:** Select an image model -> toggle image mode ON -> send a prompt (a fox in snow)
- **Expect:** A generated image renders in the chat; details show the backend (MNN GPU / Core ML)
- **Result:** Android ☐  ·  iOS ☐

### 19. [HIGH·75%auto] #86 — Whisper not resident on download
*P0 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Confirm from phase 1: STT downloaded but not transcribed -> open model selector In Memory
- **Expect:** Whisper is NOT auto-resident; no phantom 1.5GB resident before first transcribe
- **Result:** Android ☐  ·  iOS ☐

### 20. [HIGH·75%auto] #87 — Conservative = one heavy at a time
*P0 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Conservative -> load text -> start image gen -> open In Memory
- **Expect:** Only ONE heavy model resident (the other evicted/swapped)
- **Result:** Android ☐  ·  iOS ☐

### 21. [HIGH·75%auto] #88 — Balanced = co-reside if they fit
*P0 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Balanced -> load text -> start image -> open In Memory
- **Expect:** Text AND image BOTH resident when they fit the budget
- **Result:** Android ☐  ·  iOS ☐

### 22. [HIGH·75%auto] #93 — Idle STT reclaimed for a text turn
*P0 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Text + whisper resident on a tight device (<=6GB) -> type + send a text turn
- **Expect:** Reply renders AND whisper drops from In Memory while text stays (idle STT reclaimed)
- **Result:** Android ☐  ·  iOS ☐

### 23. [HIGH·75%auto] #171 — Download entries survive relaunch
*P0 · 11 Polish · Strongly automated — manual confirm*
- **Do:** Have in-flight/failed download entries -> fully relaunch
- **Expect:** Download Manager restores entries correctly (no phantom/stuck; failed are retriable)
- **Result:** Android ☐  ·  iOS ☐

### 24. [HIGH·75%auto] #195 — Boot is independent of download database recovery
*P0 · 12 This-release · Strongly automated — manual confirm*
- **Do:** Launch with the native download database busy or wedged
- **Expect:** The app clears its boot loader and shows the initial screen while download rows recover asynchronously
- **Result:** Android ☐  ·  iOS ☐

### 25. [HIGH·75%auto] #215 — Cold Whisper load has no ghost recording
*P0 · 14 Device-only legacy · Strongly automated — manual confirm*
- **Do:** Evict Whisper or cold-launch with only a downloaded STT model -> press and hold mic -> release while the loading spinner is still visible -> wait -> record normally
- **Expect:** The released cold-load attempt cancels cleanly with no transcript and no background privacy indicator; the next attempt records and stops normally
- **Result:** Android ☐  ·  iOS ☐

### 26. [HIGH·75%auto] #228 — Remote server CRUD authentication and credential secrecy
*P0 · 15 Changed-owner audit · Strongly automated — manual confirm*
- **Do:** Add a server with an API key -> trigger one 401 -> correct credentials -> switch models -> edit endpoint -> delete server -> inspect UI persistence and Debug Logs
- **Expect:** Authentication recovers; active selection stays coherent; delete removes server and active model; the API key never appears in UI persisted JSON exported logs or debug output
- **Result:** Android ☐  ·  iOS ☐

### 27. [HIGH·75%auto] #229 — Live Pro activation revocation and reactivation
*P0 · 15 Changed-owner audit · Strongly automated — manual confirm*
- **Do:** Activate Pro -> use a paid surface -> revoke or expire entitlement while app backgrounds -> foreground -> reactivate twice
- **Expect:** Pro UI appears live then disappears live on revocation; gated clients stop; repeated activation creates no duplicate routes hooks clients or tools
- **Result:** Android ☐  ·  iOS ☐

### 28. [HIGH·75%auto] #234 — Debug Logs view export clear and secret redaction
*P0 · 15 Changed-owner audit · Strongly automated — manual confirm*
- **Do:** Exercise local remote Pro and MCP flows with distinctive fake secrets -> open Debug Logs -> export -> clear -> reopen
- **Expect:** Logs render and export; API keys tokens license keys and authorization headers are redacted; Clear empties the view and file without touching user chats
- **Result:** Android ☐  ·  iOS ☐

### 29. [HIGH·75%auto] #237 — Corrupt persisted settings recover without losing unrelated data
*P0 · 15 Fault recovery · Strongly automated — manual confirm*
- **Do:** In a debug build corrupt only the persisted settings payload while retaining chats and projects -> cold launch
- **Expect:** App reaches a usable onboarding or Home state with safe settings; unrelated chats and projects remain; no boot loop or blank screen
- **Result:** Android ☐  ·  iOS ☐

### 30. [HIGH·75%auto] #238 — Partial filesystem initialization recovers
*P0 · 15 Fault recovery · Strongly automated — manual confirm*
- **Do:** In a debug build fail the first app-directory initialization -> launch -> open Models and retry after restoring filesystem access
- **Expect:** Core UI boots; retry initializes storage; a model can be selected and a chat turn completes; no permanent splash hang
- **Result:** Android ☐  ·  iOS ☐

### 31. [HIGH·75%auto] #239 — Interrupted storage write preserves the last commit
*P0 · 15 Fault recovery · Strongly automated — manual confirm*
- **Do:** Create a chat and project -> force an app kill or injected write failure during the next persistence write -> relaunch
- **Expect:** The last fully committed chat and project restore; partial newer data is discarded; storage remains writable afterward
- **Result:** Android ☐  ·  iOS ☐

### 32. [HIGH·75%auto] #240 — Optional Pro extension failure does not break Core
*P0 · 15 Fault recovery · Strongly automated — manual confirm*
- **Do:** Use a debug build that fails Pro native or JS extension initialization -> cold launch -> download or select a Core model -> chat
- **Expect:** Core onboarding models settings and chat remain usable; paid surfaces stay absent or show a contained error; no boot crash
- **Result:** Android ☐  ·  iOS ☐

### 33. [FULL·100%auto] #42 — Failed generation clears the spinner
*P0 · 2 Text gen · Fully automated — manual spot-check*
- **Do:** Trigger a generation that errors (e.g. vision decode fail on a llama model)
- **Expect:** Spinner CLEARS and an error bubble shows - NOT a spinner stuck for minutes
- **Result:** Android ☐  ·  iOS ☐

### 34. [FULL·100%auto] #85 — Loading mode selectable + persists
*P0 · 5 Memory · Fully automated — manual spot-check*
- **Do:** Settings -> switch Conservative / Balanced / Aggressive (chat + global)
- **Expect:** The choice persists and both surfaces agree
- **Result:** Android ☐  ·  iOS ☐

### 35. [FULL·100%auto] #167 — Chat history survives relaunch
*P0 · 11 Polish · Fully automated — manual spot-check*
- **Do:** Have several chats -> fully relaunch
- **Expect:** All conversations are restored with their messages
- **Result:** Android ☐  ·  iOS ☐

### 36. [FULL·100%auto] #168 — Downloaded models survive relaunch
*P0 · 11 Polish · Fully automated — manual spot-check*
- **Do:** Download models -> fully relaunch
- **Expect:** All downloaded models are still listed as Downloaded (no re-download needed)
- **Result:** Android ☐  ·  iOS ☐

### 37. [FULL·100%auto] #197 — Chats New with no selected model opens after local selection
*P0 · 12 This-release · Fully automated — manual spot-check*
- **Do:** Clear the active text model -> Chats -> New -> choose a downloaded local model from the bottom sheet
- **Expect:** The sheet closes and Chat opens immediately; no inert tap; first Send lazy-loads and replies
- **Result:** Android ☐  ·  iOS ☐

# ── P1 ──

### 38. [NONE·0%auto] #203 — Cold app-start comparison
*P1 · 13 Performance · Manual only — no automated safety net*
- **Do:** Force-stop production and candidate builds -> launch each 5 times on the same device -> time tap-to-usable Home
- **Expect:** No candidate hang; median candidate cold start is no more than 15 percent slower than production; record all five samples
- **Result:** Android ☐  ·  iOS ☐

### 39. [NONE·0%auto] #205 — Cold model load and first-token comparison
*P1 · 13 Performance · Manual only — no automated safety net*
- **Do:** After Eject All select the same GGUF -> send the same short prompt 5 times per build with a cold load
- **Expect:** Median model-load and time-to-first-token are no more than 15 percent slower than production; no fallback surprise
- **Result:** Android ☐  ·  iOS ☐

### 40. [NONE·0%auto] #206 — Warm decode throughput comparison
*P1 · 13 Performance · Manual only — no automated safety net*
- **Do:** Keep the same model resident -> send the same 256+ token prompt 5 times in production and candidate
- **Expect:** Median tokens per second is not more than 15 percent lower than production on the same backend; output completes
- **Result:** Android ☐  ·  iOS ☐

### 41. [NONE·0%auto] #207 — Sustained generation and thermal soak
*P1 · 13 Performance · Manual only — no automated safety net*
- **Do:** Run at least 20 substantial local turns or 30 minutes on external power while watching device temperature and tok/s
- **Expect:** No crash, jetsam, stuck generation, or unbounded slowdown; throttling is recorded with turn number temperature and tok/s; context-full recovery remains actionable
- **Result:** Android ☐  ·  iOS ☐

### 42. [NONE·0%auto] #212 — Release performance evidence complete
*P1 · 13 Performance · Manual only — no automated safety net*
- **Do:** Export Settings -> Debug Logs after the performance phase and attach the filled CSV plus profiler or screen-recording samples
- **Expect:** Every performance row has device/build/backend numbers and evidence; any greater-than-15-percent regression has an owner or blocks release
- **Result:** Android ☐  ·  iOS ☐

### 43. [NONE·0%auto] #213 — Slide-to-cancel pill renders correctly
*P1 · 14 Device-only legacy · Manual only — no automated safety net*
- **Do:** In an empty text-chat composer press and hold the microphone without moving your finger
- **Expect:** The Slide to cancel pill appears to the left of the mic on one unclipped line; it does not wrap smear or overlap the mic
- **Result:** Android ☐  ·  iOS ☐

### 44. [NONE·0%auto] #214 — Slide-to-cancel distinguishes cancel from send
*P1 · 14 Device-only legacy · Manual only — no automated safety net*
- **Do:** Hold the mic and speak; first slide left past the cancel threshold and release; then record again and release without sliding
- **Expect:** The cancelled take produces no composer text; the ordinary release transcribes exactly one take into the composer
- **Result:** Android ☐  ·  iOS ☐

### 45. [NONE·0%auto] #217 — SDXL Core ML finalization and first compile
*P1 · 14 Device-only legacy · Manual only — no automated safety net*
- **Do:** On iPhone download an SDXL Core ML image model -> wait for finalization -> generate the first image
- **Expect:** The model registers without a missing-file error and the first ANE compile/generation finishes without app crash or jetsam; any true device-limit refusal is shown before native load
- **Result:** Android ☐  ·  iOS ☐

### 46. [NONE·0%auto] #218 — Low-RAM curated LiteRT remains available with warning
*P1 · 14 Device-only legacy · Manual only — no automated safety net*
- **Do:** On an Android device where Gemma 4 E4B LiteRT exceeds the normal fit budget open it from onboarding and Models
- **Expect:** The card remains visible on both surfaces and Download shows a may-exceed-memory warning with a deliberate continue action; it is not silently hidden
- **Result:** Android ☐  ·  iOS ☐

### 47. [NONE·0%auto] #219 — TTS pressure failure remains actionable
*P1 · 14 Device-only legacy · Manual only — no automated safety net*
- **Do:** In Voice mode keep a large text model resident and request spoken output on a device where TTS cannot safely fit
- **Expect:** Speech either completes after safe reclaim or shows a visible actionable memory failure with Load Anyway subject to the survival floor; the speaker never silently stops
- **Result:** Android ☐  ·  iOS ☐

### 48. [PARTIAL·50%auto] #13 — Download a LARGE text model
*P1 · 1 Downloads · Core path automated, edges manual*
- **Do:** Download the biggest text model your device can hold
- **Expect:** Completes
- **Result:** Android ☐  ·  iOS ☐

### 49. [PARTIAL·50%auto] #25 — GPU/OpenCL backend
*P1 · 2 Text gen · Core path automated, edges manual*
- **Do:** Model Settings -> Text -> Advanced -> Backend = GPU/OpenCL -> reload -> send
- **Expect:** Reply renders; Generation Details show GPU layers offloaded (e.g. OpenCL 24L) not CPU
- **Result:** Android ☐  ·  iOS ☐

### 50. [PARTIAL·50%auto] #29 — litert CPU backend fails gracefully
*P1 · 2 Text gen · Core path automated, edges manual*
- **Do:** Select litert model -> Advanced -> Backend = CPU -> reload -> send - Android only
- **Expect:** An answer renders OR CPU is not offered for a GPU-compiled model; NEVER a stuck error with no answer
- **Result:** Android ☐  ·  iOS ☐

### 51. [PARTIAL·50%auto] #30 — NPU/HTP backend gated or graceful
*P1 · 2 Text gen · Core path automated, edges manual*
- **Do:** Backend = NPU (Beta)/HTP -> reload -> send - Android device with NPU
- **Expect:** Either a coherent reply OR NPU is gated/blocked; never silently returns gibberish as the answer
- **Result:** Android ☐  ·  iOS ☐

### 52. [PARTIAL·50%auto] #51 — Mic permission prompt on first record
*P1 · 3 Voice · Core path automated, edges manual*
- **Do:** The FIRST time you hold the mic to record, allow the OS mic prompt
- **Expect:** OS mic-permission prompt appears; after Allow, recording proceeds and is remembered
- **Result:** Android ☐  ·  iOS ☐

### 53. [PARTIAL·50%auto] #52 — Mic permission DENIED handled gracefully
*P1 · 3 Voice · Core path automated, edges manual*
- **Do:** Deny the mic permission (or revoke in OS settings) then hold the mic to record
- **Expect:** A clear Microphone permission denied message; no crash; no stuck recording state
- **Result:** Android ☐  ·  iOS ☐

### 54. [PARTIAL·50%auto] #56 — Voice note transcript on litert + tool
*P1 · 3 Voice · Core path automated, edges manual*
- **Do:** litert model + a tool enabled -> record a voice note -> send - Android
- **Expect:** The transcript reaches the model; raw audio is NOT re-sent
- **Result:** Android ☐  ·  iOS ☐

### 55. [PARTIAL·50%auto] #57 — Mic stops cleanly on leave
*P1 · 3 Voice · Core path automated, edges manual*
- **Do:** Chat mode -> hold the mic to record -> navigate away without stopping
- **Expect:** The native mic session STOPS on leave; no lingering recording
- **Result:** Android ☐  ·  iOS ☐

### 56. [PARTIAL·50%auto] #59 — Voice-mode transcript renders
*P1 · 3 Voice · Core path automated, edges manual*
- **Do:** Switch to voice/audio mode -> record a note -> stop
- **Expect:** The correct transcript renders (real whisper segments)
- **Result:** Android ☐  ·  iOS ☐

### 57. [PARTIAL·50%auto] #61 — Voice draw-request routes to image
*P1 · 3 Voice · Core path automated, edges manual*
- **Do:** In voice mode say draw a dog (image model active)
- **Expect:** Routes to IMAGE generation -> image renders -> TTS confirmation
- **Result:** Android ☐  ·  iOS ☐

### 58. [PARTIAL·50%auto] #62 — Voice calculator journey
*P1 · 3 Voice · Core path automated, edges manual*
- **Do:** Voice mode + calculator on -> say use the calculator: 500 x 321
- **Expect:** STT -> routes to TEXT -> calculator tool -> correct answer -> TTS speaks it
- **Result:** Android ☐  ·  iOS ☐

### 59. [PARTIAL·50%auto] #63 — Voice-mode Stop button while generating
*P1 · 3 Voice · Core path automated, edges manual*
- **Do:** Voice mode, start a generation, watch the mic button
- **Expect:** The mic button shows STOP while generating (so you can stop and it does not invite a colliding record)
- **Result:** Android ☐  ·  iOS ☐

### 60. [PARTIAL·50%auto] #82 — Big vision model decode handled
*P1 · 4 Vision · Core path automated, edges manual*
- **Do:** Attach an image to a bigger vision model (SmolVLM / 2B) -> send
- **Expect:** A description renders OR a clear error (spinner clears); never a stuck spinner
- **Result:** Android ☐  ·  iOS ☐

### 61. [PARTIAL·50%auto] #96 — OS memory-warning evicts idle sidecars
*P1 · 5 Memory · Core path automated, edges manual*
- **Do:** Text + whisper (+tts) resident -> trigger an OS memory warning -> open the selector
- **Expect:** Idle sidecars (whisper/tts/embedding) are reclaimed; the active heavy stays
- **Result:** Android ☐  ·  iOS ☐

### 62. [PARTIAL·50%auto] #102 — Survival floor blocks a guaranteed OOM
*P1 · 5 Memory · Core path automated, edges manual*
- **Do:** Load-Anyway a too-big dirty model at very low real free RAM
- **Expect:** The survival floor blocks before native allocation using the fresh REAL free-RAM probe and never offers a second override
- **Result:** Android ☐  ·  iOS ☐

### 63. [PARTIAL·50%auto] #154 — Speak a reply
*P1 · 10 TTS · Core path automated, edges manual*
- **Do:** Open a reply action menu -> tap Speak
- **Expect:** The reply text is spoken (kokoro); no Speak on user messages
- **Result:** Android ☐  ·  iOS ☐

### 64. [PARTIAL·50%auto] #164 — App lock passphrase set + enforce
*P1 · 11 Polish · Core path automated, edges manual*
- **Do:** Settings -> Security -> set a passphrase -> lock -> reopen
- **Expect:** The lock screen requires the passphrase; correct passphrase unlocks; wrong is rejected
- **Result:** Android ☐  ·  iOS ☐

### 65. [PARTIAL·50%auto] #172 — Background -> foreground mid-generation
*P1 · 11 Polish · Core path automated, edges manual*
- **Do:** Start a generation -> background the app -> foreground it
- **Expect:** Generation resumes/completes coherently; no stuck spinner or lost reply
- **Result:** Android ☐  ·  iOS ☐

### 66. [PARTIAL·50%auto] #173 — Kill mid-generation recovers
*P1 · 11 Polish · Core path automated, edges manual*
- **Do:** Force-kill during a generation -> reopen
- **Expect:** App reopens clean; no stuck spinner; the chat is intact
- **Result:** Android ☐  ·  iOS ☐

### 67. [PARTIAL·50%auto] #174 — Airplane mode local-only still works
*P1 · 11 Polish · Core path automated, edges manual*
- **Do:** Turn on airplane mode -> run a local text generation
- **Expect:** Local generation works fully offline (the whole point); only remote/web_search fail gracefully
- **Result:** Android ☐  ·  iOS ☐

### 68. [PARTIAL·50%auto] #186 — Remote stream interruption recovers
*P1 · 12 This-release · Core path automated, edges manual*
- **Do:** Start a remote reply -> kill WiFi / stop the server mid-stream
- **Expect:** Spinner clears + error surfaced + no wedge; queue advances
- **Result:** Android ☐  ·  iOS ☐

### 69. [PARTIAL·50%auto] #191 — GPU->CPU fallback is visibly reported
*P1 · 12 This-release · Core path automated, edges manual*
- **Do:** Backend=GPU + 99 layers on a device whose GPU init times out (Adreno 735 class) -> reload -> wait for load
- **Expect:** A GPU-unavailable and running-on-CPU system message appears in the chat WITHOUT Show Generation Details; meta shows CPU
- **Result:** Android ☐  ·  iOS ☐

### 70. [PARTIAL·50%auto] #209 — Repeated model-swap memory stability
*P1 · 13 Performance · Core path automated, edges manual*
- **Do:** Alternate local text -> image -> remote -> local for 10 cycles; generate once in each mode; inspect In Memory and device info after every cycle
- **Expect:** Resident set matches the active policy; app footprint reaches a stable band instead of growing every cycle; Eject All releases every model
- **Result:** Android ☐  ·  iOS ☐

### 71. [PARTIAL·50%auto] #210 — Download-load UI contention
*P1 · 13 Performance · Core path automated, edges manual*
- **Do:** Queue 6+ downloads -> while three transfer concurrently navigate lists type in chat and run a resident local model
- **Expect:** UI remains responsive; local generation completes; progress updates without duplicate rows; boot and persistence remain independent of download recovery
- **Result:** Android ☐  ·  iOS ☐

### 72. [PARTIAL·50%auto] #211 — Background foreground latency and continuity
*P1 · 13 Performance · Core path automated, edges manual*
- **Do:** Start a long local generation and active downloads -> background for 30 seconds -> foreground; repeat 5 times
- **Expect:** Foreground becomes interactive promptly; reply/download state is coherent; no duplicated callbacks spinner or resident leak
- **Result:** Android ☐  ·  iOS ☐

### 73. [PARTIAL·50%auto] #236 — LiteRT vision RAM-clamped context recovery
*P1 · 15 Changed-owner audit · Core path automated, edges manual*
- **Do:** On Android choose a LiteRT vision model with a context above the device-safe RAM limit -> attach an image and send
- **Expect:** The app clamps or retries at a safe context while keeping the image; a coherent answer renders and the composer returns idle
- **Result:** Android ☐  ·  iOS ☐

### 74. [PARTIAL·50%auto] #246 — Queued image model card stays truthful
*P1 · 15 Legacy replacement audit · Core path automated, edges manual*
- **Do:** Fill the native download concurrency slots -> queue an image model -> inspect Models and Download Manager -> free a slot
- **Expect:** The image card visibly says queued then running then processing then ready; it never offers a duplicate Download action or reports ready before extraction
- **Result:** Android ☐  ·  iOS ☐

### 75. [PARTIAL·50%auto] #247 — TTS playback queue and failure recovery
*P1 · 15 Legacy replacement audit · Core path automated, edges manual*
- **Do:** Speak a long assistant reply -> queue another spoken reply -> interrupt playback -> trigger one transient native audio error -> speak again
- **Expect:** Playback drains in order; Stop clears the active and queued backlog; transient failure returns to idle; the next speak works once with no lock or duplicate audio
- **Result:** Android ☐  ·  iOS ☐

### 76. [HIGH·75%auto] #7 — Download a vision model (mmproj)
*P1 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** Download a vision GGUF that has a projector (mmproj) file
- **Expect:** Both the main + mmproj files download; model shows Downloaded
- **Result:** Android ☐  ·  iOS ☐

### 77. [HIGH·75%auto] #12 — Download an image model
*P1 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** Download an image model (e.g. AnythingV5 / Absolute Reality)
- **Expect:** Completes; zip extraction finishes before it shows usable
- **Result:** Android ☐  ·  iOS ☐

### 78. [HIGH·75%auto] #14 — Download a litert model
*P1 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** Download a .litertlm model (e.g. gemma litert) - Android only
- **Expect:** Completes; selectable
- **Result:** Android ☐  ·  iOS ☐

### 79. [HIGH·75%auto] #15 — Delete does not cancel another download
*P1 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** Start download A (in-flight) -> delete a different downloaded model B
- **Expect:** A keeps downloading; deleting B does not cancel A
- **Result:** Android ☐  ·  iOS ☐

### 80. [HIGH·75%auto] #16 — Concurrent / queued downloads
*P1 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** Start several downloads at once
- **Expect:** Some run concurrently and the rest queue; queue drains in order; no drop
- **Result:** Android ☐  ·  iOS ☐

### 81. [HIGH·75%auto] #17 — Download with NO network
*P1 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** Turn on airplane mode -> start a new download
- **Expect:** A clear no-network / connection error; NO phantom stuck-at-0 entry; retriable when network returns
- **Result:** Android ☐  ·  iOS ☐

### 82. [HIGH·75%auto] #19 — Truncated file not listed as ready
*P1 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** If a download is cut short (below size floor) check the model list
- **Expect:** The truncated file is NOT listed as a completed/loadable model
- **Result:** Android ☐  ·  iOS ☐

### 83. [HIGH·75%auto] #20 — Kill mid-extraction recovers
*P1 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** Force-kill during an image model zip extraction -> reopen
- **Expect:** On next launch it re-extracts or shows a retriable failed card; never a half-ready model
- **Result:** Android ☐  ·  iOS ☐

### 84. [HIGH·75%auto] #21 — Retry a failed image extraction
*P1 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** On an image model whose extraction failed -> tap Retry in Download Manager
- **Expect:** It re-downloads / re-extracts (no Download not found dead-end)
- **Result:** Android ☐  ·  iOS ☐

### 85. [HIGH·75%auto] #24 — First message replies (litert)
*P1 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Select the litert model -> New chat -> send - Android only
- **Expect:** Reply renders (litert GPU works)
- **Result:** Android ☐  ·  iOS ☐

### 86. [HIGH·75%auto] #28 — GPU layers slider applies
*P1 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Advanced -> set n_gpu_layers to a specific value -> reload -> send
- **Expect:** Generation Details reflect the chosen offload count (your value honored)
- **Result:** Android ☐  ·  iOS ☐

### 87. [HIGH·75%auto] #31 — Temperature applies to a generation
*P1 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Set Temperature (Model Settings or chat modal) -> send a prompt
- **Expect:** Output character reflects the value (e.g. very low = deterministic/repeatable)
- **Result:** Android ☐  ·  iOS ☐

### 88. [HIGH·75%auto] #33 — Context length applies
*P1 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Set Context Length in the chat modal -> send a long conversation
- **Expect:** The chosen n_ctx is used (longer context retained up to the value; context-full appears at it)
- **Result:** Android ☐  ·  iOS ☐

### 89. [HIGH·75%auto] #34 — System prompt applies
*P1 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Model Settings -> set a distinctive system prompt -> new chat -> send
- **Expect:** The reply obeys the system prompt (persona/rule visibly applied)
- **Result:** Android ☐  ·  iOS ☐

### 90. [HIGH·75%auto] #67 — Image Size + Guidance honored
*P1 · 4 Image · Strongly automated — manual confirm*
- **Do:** Set image Size (e.g. 256) and Guidance -> generate
- **Expect:** The generated image uses YOUR size + guidance (not clamped/default)
- **Result:** Android ☐  ·  iOS ☐

### 91. [HIGH·75%auto] #69 — Image steps applies
*P1 · 4 Image · Strongly automated — manual confirm*
- **Do:** Set image Steps -> generate
- **Expect:** Generation runs the chosen step count (visible time/quality difference)
- **Result:** Android ☐  ·  iOS ☐

### 92. [HIGH·75%auto] #80 — Vision answers about an image
*P1 · 4 Vision · Strongly automated — manual confirm*
- **Do:** Attach an image to a vision model -> ask what is in this image
- **Expect:** Model answers about the image content
- **Result:** Android ☐  ·  iOS ☐

### 93. [HIGH·75%auto] #83 — litert vision affordance consistent
*P1 · 4 Vision · Strongly automated — manual confirm*
- **Do:** litert vision model -> attach photo; then a non-vision litert model -> attach - Android
- **Expect:** Vision model attaches; non-vision one is walled Vision Not Supported (capability-gated)
- **Result:** Android ☐  ·  iOS ☐

### 94. [HIGH·75%auto] #84 — Non-vision model image is refused gracefully
*P1 · 4 Vision · Strongly automated — manual confirm*
- **Do:** Attach an image to a non-vision model (+ a tool) -> send
- **Expect:** A clear does not support images message; never a raw native crash
- **Result:** Android ☐  ·  iOS ☐

### 95. [HIGH·75%auto] #89 — Text + whisper co-reside (roomy)
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Roomy device (>6GB free) -> text model resident -> select whisper (STT)
- **Expect:** In Memory lists BOTH text and whisper; the STT sidecar co-resides (single-heavy rule evicts heavies not sidecars)
- **Result:** Android ☐  ·  iOS ☐

### 96. [HIGH·75%auto] #90 — Sidecars co-reside with a heavy
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Load a text model -> use voice (STT) -> let TTS speak
- **Expect:** STT + TTS co-reside with the text model (voice does not evict your chat model)
- **Result:** Android ☐  ·  iOS ☐

### 97. [HIGH·75%auto] #94 — Idle STT reclaimed in a voice turn
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Voice mode: whisper + text on a tight device -> record + send a voice note
- **Expect:** After transcription whisper drops from In Memory; reply is an audio bubble spoken via TTS
- **Result:** Android ☐  ·  iOS ☐

### 98. [HIGH·75%auto] #95 — Whisper blocked then freed then retried
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Tight device, whisper downloaded-not-loaded, text resident -> record a voice note
- **Expect:** First whisper load is blocked; the text model is freed; retry loads whisper; transcript + reply render
- **Result:** Android ☐  ·  iOS ☐

### 99. [HIGH·75%auto] #97 — Aggressive loads bigger automatically
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Aggressive -> load the large model Balanced would refuse
- **Expect:** Loads automatically (larger budget) without a Load-Anyway prompt
- **Result:** Android ☐  ·  iOS ☐

### 100. [HIGH·75%auto] #100 — Estimators agree (no safe-then-refuse)
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Attempt to load an image model near the memory edge
- **Expect:** The pre-load advisory and the load gate agree (not safe to load then a hard refuse)
- **Result:** Android ☐  ·  iOS ☐

### 101. [HIGH·75%auto] #103 — Image->chat swap
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Generate an image then go to chat and send text
- **Expect:** Text model loads (image swapped if needed); reply renders
- **Result:** Android ☐  ·  iOS ☐

### 102. [HIGH·75%auto] #104 — Switch active model mid-chat
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Mid-chat open the model selector -> pick a different local model -> send
- **Expect:** The new model becomes active and replies; the previous heavy is swapped if needed
- **Result:** Android ☐  ·  iOS ☐

### 103. [HIGH·75%auto] #105 — Eject All frees everything
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Home -> Eject All (with heavy models + sidecars resident)
- **Expect:** Everything unloads incl. STT/TTS/embedding (In Memory empty)
- **Result:** Android ☐  ·  iOS ☐

### 104. [HIGH·75%auto] #106 — Eject one resident from In Memory
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Reach image + whisper resident -> open the selector -> eject whisper
- **Expect:** Only whisper frees (its real unload runs); image stays
- **Result:** Android ☐  ·  iOS ☐

### 105. [HIGH·75%auto] #107 — Lazy reload after eject
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Eject a text model via In Memory -> send a new message
- **Expect:** The ejected model lazy-reloads on demand and the answer renders (eject frees RAM not disables)
- **Result:** Android ☐  ·  iOS ☐

### 106. [HIGH·75%auto] #108 — In Memory shows loaded model RAM
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Load a text (and image) model -> open the model selector
- **Expect:** The selector shows the loaded model name + RAM consumed (removes the black box)
- **Result:** Android ☐  ·  iOS ☐

### 107. [HIGH·75%auto] #109 — Stale TTS pressure cleared on delete
*P1 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Load TTS -> delete TTS in Download Manager -> load a text/image model
- **Expect:** No phantom TTS memory pressure; the resident set excludes tts after delete
- **Result:** Android ☐  ·  iOS ☐

### 108. [HIGH·75%auto] #113 — KB indexes a text PDF
*P1 · 6 KB/Projects · Strongly automated — manual confirm*
- **Do:** Attach a text-based PDF (<5MB) to the project Knowledge Base
- **Expect:** Doc indexes (chunk/embedding count shown); no error
- **Result:** Android ☐  ·  iOS ☐

### 109. [HIGH·75%auto] #117 — Embedding failure aborts + retry
*P1 · 6 KB/Projects · Strongly automated — manual confirm*
- **Do:** Cause an embedding failure mid-index (hard to force by hand)
- **Expect:** Error card + Retry; the doc is NOT half-added (rolled back)
- **Result:** Android ☐  ·  iOS ☐

### 110. [HIGH·75%auto] #118 — KB retrieval in a chat
*P1 · 6 KB/Projects · Strongly automated — manual confirm*
- **Do:** New chat in the project -> ask a question about the doc (>=2B model)
- **Expect:** Model calls search_knowledge_base -> retrieved chunks -> answer grounded in the doc
- **Result:** Android ☐  ·  iOS ☐

### 111. [HIGH·75%auto] #133 — Add / connect an MCP server
*P1 · 7 Tools · Strongly automated — manual confirm*
- **Do:** Tools -> MCP -> add a server (URL) -> connect
- **Expect:** The server connects and appears in the MCP list (connected state)
- **Result:** Android ☐  ·  iOS ☐

### 112. [HIGH·75%auto] #134 — MCP server tools listed
*P1 · 7 Tools · Strongly automated — manual confirm*
- **Do:** Open a connected MCP server
- **Expect:** Its tools are listed with enable/disable toggles
- **Result:** Android ☐  ·  iOS ☐

### 113. [HIGH·75%auto] #135 — Execute an MCP tool
*P1 · 7 Tools · Strongly automated — manual confirm*
- **Do:** Enable an MCP tool -> send a prompt that uses it
- **Expect:** A tool-result bubble with real MCP data renders
- **Result:** Android ☐  ·  iOS ☐

### 114. [HIGH·75%auto] #138 — Remote model replies
*P1 · 8 Remote · Strongly automated — manual confirm*
- **Do:** PRECONDITION: LM Studio/Ollama on your LAN. Connect -> select a model -> send
- **Expect:** Reply renders from the remote model
- **Result:** Android ☐  ·  iOS ☐

### 115. [HIGH·75%auto] #142 — Remote reasoning renders (LM Studio)
*P1 · 8 Remote · Strongly automated — manual confirm*
- **Do:** LM Studio remote reasoning model + thinking -> send
- **Expect:** The thinking block renders (reasoning_content not dropped)
- **Result:** Android ☐  ·  iOS ☐

### 116. [HIGH·75%auto] #143 — Remote parallel tool calls
*P1 · 8 Remote · Strongly automated — manual confirm*
- **Do:** Connect remote -> send a prompt that triggers parallel tool calls
- **Expect:** Correct replies; parallel tool_calls render (accumulate by index)
- **Result:** Android ☐  ·  iOS ☐

### 117. [HIGH·75%auto] #144 — Remote prompt-enhance runs
*P1 · 8 Remote · Strongly automated — manual confirm*
- **Do:** Remote model active -> image gen with enhance prompt on
- **Expect:** Enhancement runs via the REMOTE model (not skipped)
- **Result:** Android ☐  ·  iOS ☐

### 118. [HIGH·75%auto] #145 — Remote server dies mid-generation
*P1 · 8 Remote · Strongly automated — manual confirm*
- **Do:** Start a remote generation -> kill the LAN server mid-stream
- **Expect:** Generation ends with a clear connection error; spinner clears; no stuck state
- **Result:** Android ☐  ·  iOS ☐

### 119. [HIGH·75%auto] #182 — Parse-once thinking+tool+answer on litert
*P1 · 12 This-release · Strongly automated — manual confirm*
- **Do:** litert model (Android) -> thinking + a tool in one turn
- **Expect:** Thinking block + tool result + answer in the SAME correct order as llama
- **Result:** Android ☐  ·  iOS ☐

### 120. [HIGH·75%auto] #183 — Parse-once thinking+tool+answer on remote
*P1 · 12 This-release · Strongly automated — manual confirm*
- **Do:** Remote reasoning model -> thinking + a tool in one turn
- **Expect:** Same render order as llama/litert
- **Result:** Android ☐  ·  iOS ☐

### 121. [HIGH·75%auto] #184 — Remote activation frees local heavy
*P1 · 12 This-release · Strongly automated — manual confirm*
- **Do:** Local heavy text model resident -> activate a remote model -> open In Memory
- **Expect:** Local heavy is freed / not growing; switch back to local -> it lazy-reloads and replies
- **Result:** Android ☐  ·  iOS ☐

### 122. [HIGH·75%auto] #188 — Litert download warning is device-aware (BOTH screens)
*P1 · 12 This-release · Strongly automated — manual confirm*
- **Do:** On a high-RAM (11GB+) device tap Download on Gemma 4 E4B litert from (a) onboarding Set Up Your AI and (b) Models tab
- **Expect:** NO may-exceed-your-device-memory sheet on either screen - it just downloads; the card shows Recommended
- **Result:** Android ☐  ·  iOS ☐

### 123. [HIGH·75%auto] #194 — Embedded MTP activates only for capable GGUFs
*P1 · 12 This-release · Strongly automated — manual confirm*
- **Do:** Select an MTP GGUF -> send -> inspect Generation Details; repeat with an ordinary GGUF and with an MTP runtime rejection
- **Expect:** MTP metadata enables draft-mtp and shows accepted-token metrics; ordinary GGUFs stay standard; rejection retries once without MTP
- **Result:** Android ☐  ·  iOS ☐

### 124. [HIGH·75%auto] #202 — Every Get Pro action opens the new buy anchor
*P1 · 12 This-release · Strongly automated — manual confirm*
- **Do:** Open Settings -> Off Grid AI PRO -> tap Get Pro; repeat from I have a license key -> Not a member yet Get Pro
- **Expect:** Both actions open https://getoffgridai.co/pro/#buy with UTM parameters before the #buy fragment
- **Result:** Android ☐  ·  iOS ☐

### 125. [HIGH·75%auto] #220 — Download cancellation and duplicate-tap lifecycle
*P1 · 15 Changed-owner audit · Strongly automated — manual confirm*
- **Do:** Start one running and one queued download -> rapidly tap Download twice on a third model -> cancel the queued model -> cancel the running model
- **Expect:** Repeated taps create one row only; queued cancel removes it immediately and after relaunch; running cancel stops only that transfer and restores Download
- **Result:** Android ☐  ·  iOS ☐

### 126. [HIGH·75%auto] #222 — Deleting the active resident chooses a coherent fallback
*P1 · 15 Changed-owner audit · Strongly automated — manual confirm*
- **Do:** Keep two local text models downloaded -> load model A -> delete A from its real model action
- **Expect:** Model A unloads and disappears; model B becomes the coherent selected fallback or the app shows no selection; no stale A settings or resident row remains
- **Result:** Android ☐  ·  iOS ☐

### 127. [HIGH·75%auto] #223 — Local GGUF import validation
*P1 · 15 Changed-owner audit · Strongly automated — manual confirm*
- **Do:** Import one valid GGUF then try a wrong extension and a deliberately partial or corrupt GGUF
- **Expect:** The valid model appears once and can load; invalid files are rejected with clear reasons and never become phantom loadable models
- **Result:** Android ☐  ·  iOS ☐

### 128. [HIGH·75%auto] #225 — Sent image attachment survives relaunch and missing-file recovery
*P1 · 15 Changed-owner audit · Strongly automated — manual confirm*
- **Do:** Attach a photo -> send it -> cold relaunch -> reopen the chat -> then remove the app-owned image file in a debug build and reopen
- **Expect:** The attachment is copied into durable app storage and survives relaunch; a later missing file shows a recovery state without crashing or losing the text turn
- **Result:** Android ☐  ·  iOS ☐

### 129. [HIGH·75%auto] #226 — LiteRT compaction survives relaunch
*P1 · 15 Changed-owner audit · Strongly automated — manual confirm*
- **Do:** Use a small LiteRT context until compaction occurs -> continue for several turns -> cold relaunch -> reopen and send again
- **Expect:** The summary cutoff and recent transcript persist; recent turns are not duplicated or dropped; the next answer remains coherent
- **Result:** Android ☐  ·  iOS ☐

### 130. [HIGH·75%auto] #227 — Knowledge-base delete replace and reindex integrity
*P1 · 15 Changed-owner audit · Strongly automated — manual confirm*
- **Do:** Add and query document A -> delete it -> add replacement document B with distinct facts -> query both facts -> relaunch
- **Expect:** Deleted A never returns stale chunks; B returns only its own indexed content; retry and relaunch do not mix or duplicate indexes
- **Result:** Android ☐  ·  iOS ☐

### 131. [HIGH·75%auto] #230 — Experimental MTP default toggle and persistence
*P1 · 15 Changed-owner audit · Strongly automated — manual confirm*
- **Do:** Fresh install -> verify MTP off -> enable it in Experimental Features -> relaunch -> use a capable GGUF then an ordinary GGUF
- **Expect:** MTP defaults off and persists only after explicit opt-in; capable model uses it; ordinary model stays on standard decoding; rejection retries once without MTP
- **Result:** Android ☐  ·  iOS ☐

### 132. [HIGH·75%auto] #232 — MCP relaunch reconnect is deduplicated
*P1 · 15 Changed-owner audit · Strongly automated — manual confirm*
- **Do:** Connect two MCP servers with tools -> cold relaunch twice -> open Tools and run one tool from each server
- **Expect:** Each server reconnects once; one row and one route exist per server/tool; execution happens once with no duplicate client callbacks
- **Result:** Android ☐  ·  iOS ☐

### 133. [HIGH·75%auto] #241 — Image download Wi-Fi failure retries and finalizes
*P1 · 15 Retained PR558 · Strongly automated — manual confirm*
- **Do:** Start a large image-model download -> disable Wi-Fi mid-transfer until it fails -> restore network -> tap Retry
- **Expect:** The same card becomes active and finalizes extraction; exactly one ready model appears; no stuck failed or half-ready artifact remains
- **Result:** Android ☐  ·  iOS ☐

### 134. [HIGH·75%auto] #245 — TTS download progress stays consistent across surfaces
*P1 · 15 Legacy replacement audit · Strongly automated — manual confirm*
- **Do:** Start Kokoro from Voice Models -> while downloading compare Voice Models Download Manager and any progress badge -> background and foreground
- **Expect:** Every surface shows one matching running or queued transfer and terminal state; no stale 100 percent ghost duplicate row or premature usable state
- **Result:** Android ☐  ·  iOS ☐

### 135. [FULL·100%auto] #2 — Complete onboarding
*P1 · 0 Install · Fully automated — manual spot-check*
- **Do:** Tap through onboarding to the end
- **Expect:** Lands on Home; no stuck/blank screen
- **Result:** Android ☐  ·  iOS ☐

### 136. [FULL·100%auto] #8 — Downloads badge count matches manager
*P1 · 1 Downloads · Fully automated — manual spot-check*
- **Do:** While the mmproj is mid-flight read the downloads icon badge then open Download Manager
- **Expect:** Badge number == running + queued count in Download Manager (they agree)
- **Result:** Android ☐  ·  iOS ☐

### 137. [FULL·100%auto] #38 — Plain reply has no stray think tags
*P1 · 2 Text gen · Fully automated — manual spot-check*
- **Do:** Thinking off tools off -> send a plain prompt
- **Expect:** Reply text renders cleanly; NO literal think block atop the answer
- **Result:** Android ☐  ·  iOS ☐

### 138. [FULL·100%auto] #39 — Thinking renders in block mid-stream
*P1 · 2 Text gen · Fully automated — manual spot-check*
- **Do:** Thinking ON -> send a reasoning prompt (Qwen-style inline think)
- **Expect:** Reasoning tokens render in the THINKING block from token 1; answer bubble stays empty until the answer
- **Result:** Android ☐  ·  iOS ☐

### 139. [FULL·100%auto] #44 — Queue while generating
*P1 · 2 Text gen · Fully automated — manual spot-check*
- **Do:** Send msg 1 (still streaming) -> type + send msg 2 before it finishes
- **Expect:** Both replies render in order; neither dropped or collided
- **Result:** Android ☐  ·  iOS ☐

### 140. [FULL·100%auto] #46 — Edit a user message and resend
*P1 · 2 Text gen · Fully automated — manual spot-check*
- **Do:** On a user message open the action menu -> Edit -> change text -> resend
- **Expect:** The edited prompt is re-sent and a fresh reply generates from it
- **Result:** Android ☐  ·  iOS ☐

### 141. [FULL·100%auto] #47 — Regenerate a reply
*P1 · 2 Text gen · Fully automated — manual spot-check*
- **Do:** On an assistant reply open the action menu -> Regenerate/Resend
- **Expect:** A fresh reply is generated for the same prompt
- **Result:** Android ☐  ·  iOS ☐

### 142. [FULL·100%auto] #48 — Mid-conversation sampler change takes effect
*P1 · 2 Text gen · Fully automated — manual spot-check*
- **Do:** Mid-chat drag Temperature / Top-P in Chat Settings -> send another message
- **Expect:** The NEW sampler value takes effect on the next send (both llama and litert)
- **Result:** Android ☐  ·  iOS ☐

### 143. [FULL·100%auto] #70 — Tap image opens fullscreen preview
*P1 · 4 Image · Fully automated — manual spot-check*
- **Do:** Tap a generated image thumbnail
- **Expect:** Fullscreen viewer opens with Save/Close; Close dismisses; Save writes the file
- **Result:** Android ☐  ·  iOS ☐

### 144. [FULL·100%auto] #72 — Non-draw prompt routes to text
*P1 · 4 Image · Fully automated — manual spot-check*
- **Do:** With an image model active send what is the capital of France
- **Expect:** Routes to TEXT (answer renders); image generator NOT called
- **Result:** Android ☐  ·  iOS ☐

### 145. [FULL·100%auto] #73 — Resend of an image request re-draws
*P1 · 4 Image · Fully automated — manual spot-check*
- **Do:** Send draw a dog (draws) -> open action menu -> Regenerate/Resend
- **Expect:** Resend re-runs the IMAGE pipeline (re-draws); does NOT fall through to the text model
- **Result:** Android ☐  ·  iOS ☐

### 146. [FULL·100%auto] #112 — Create a project
*P1 · 6 KB/Projects · Fully automated — manual spot-check*
- **Do:** Projects -> create a new project (fill the form)
- **Expect:** Project is created and appears in the list
- **Result:** Android ☐  ·  iOS ☐

### 147. [FULL·100%auto] #119 — New chat inherits the project
*P1 · 6 KB/Projects · Fully automated — manual spot-check*
- **Do:** In a project -> New chat -> send
- **Expect:** The chat is filed under the project and the KB tool is available
- **Result:** Android ☐  ·  iOS ☐

### 148. [FULL·100%auto] #122 — Delete project handles its chats
*P1 · 6 KB/Projects · Fully automated — manual spot-check*
- **Do:** Create a project with chats -> delete the project
- **Expect:** Its chats are handled cleanly (no dangling projectId); KB tool removed from those chats
- **Result:** Android ☐  ·  iOS ☐

### 149. [FULL·100%auto] #123 — Calculator tool runs
*P1 · 7 Tools · Fully automated — manual spot-check*
- **Do:** Enable calculator (Tools screen) -> new chat -> use the calculator: 500 x 321
- **Expect:** A tool-result bubble + correct answer (160500) render
- **Result:** Android ☐  ·  iOS ☐

### 150. [FULL·100%auto] #127 — Parallel tool calls
*P1 · 7 Tools · Fully automated — manual spot-check*
- **Do:** Calculator on -> send two calculations in one prompt
- **Expect:** Two tool-result bubbles render; both correct
- **Result:** Android ☐  ·  iOS ☐

### 151. [FULL·100%auto] #129 — Messy tool JSON still runs
*P1 · 7 Tools · Fully automated — manual spot-check*
- **Do:** Enable a tool -> a model that emits unquoted keys / trailing comma / single quotes
- **Expect:** A tool-result bubble renders with real data (tolerant parse)
- **Result:** Android ☐  ·  iOS ☐

### 152. [FULL·100%auto] #132 — Empty final turn keeps tool data
*P1 · 7 Tools · Fully automated — manual spot-check*
- **Do:** Tool returns data but the final model turn is empty
- **Expect:** The assistant bubble shows the tool data / a non-empty reply (data not discarded)
- **Result:** Android ☐  ·  iOS ☐

### 153. [FULL·100%auto] #150 — Enhancement request carries no thinking
*P1 · 9 Enhancement · Fully automated — manual spot-check*
- **Do:** Enable Enhance Image Prompts + thinking ON -> send draw a cat
- **Expect:** The enhancement request carries no thinking; the enhanced prompt has NO reasoning markers
- **Result:** Android ☐  ·  iOS ☐

### 154. [FULL·100%auto] #151 — Enhanced prompt is a clean rewrite
*P1 · 9 Enhancement · Fully automated — manual spot-check*
- **Do:** Enhance + thinking ON -> send draw a cat
- **Expect:** The prompt reaching the user is the clean rewrite not the reasoning chain
- **Result:** Android ☐  ·  iOS ☐

### 155. [FULL·100%auto] #155 — TTS text is markdown-stripped
*P1 · 10 TTS · Fully automated — manual spot-check*
- **Do:** Chat mode -> tap the speaker on an assistant bubble with markdown
- **Expect:** The text fed to TTS has no markdown (bold, headings, backticks, pipes)
- **Result:** Android ☐  ·  iOS ☐

### 156. [FULL·100%auto] #166 — Settings persist across relaunch
*P1 · 11 Polish · Fully automated — manual spot-check*
- **Do:** Change several settings -> fully relaunch the app
- **Expect:** All settings persist (mode, backend, sampler, image params, system prompt, threads/batch/flash-attn, GPU layers, theme, loading mode)
- **Result:** Android ☐  ·  iOS ☐

### 157. [FULL·100%auto] #169 — Active model selection survives relaunch
*P1 · 11 Polish · Fully automated — manual spot-check*
- **Do:** Select an active model -> fully relaunch -> new chat
- **Expect:** The previously active model is still the active selection
- **Result:** Android ☐  ·  iOS ☐

### 158. [FULL·100%auto] #170 — Projects + KB survive relaunch
*P1 · 11 Polish · Fully automated — manual spot-check*
- **Do:** Create projects with KB docs -> fully relaunch
- **Expect:** Projects and their indexed KB documents are restored
- **Result:** Android ☐  ·  iOS ☐

### 159. [FULL·100%auto] #185 — Mid-chat model switch stays coherent
*P1 · 12 This-release · Fully automated — manual spot-check*
- **Do:** Mid-conversation switch the active text model -> send again
- **Expect:** The NEW model answers and chat state is coherent with NO manual remount
- **Result:** Android ☐  ·  iOS ☐

### 160. [FULL·100%auto] #190 — Send racing a settings reload keeps thinking
*P1 · 12 This-release · Fully automated — manual spot-check*
- **Do:** Thinking ON -> change Backend in Chat Settings -> tap the reload banner -> send IMMEDIATELY while the loader is still up
- **Expect:** The reply renders WITH its thinking block; meta shows the selected backend; no silent capability loss
- **Result:** Android ☐  ·  iOS ☐

### 161. [FULL·100%auto] #192 — Mic during a background STT download is not a loader
*P1 · 12 This-release · Fully automated — manual spot-check*
- **Do:** With no STT model downloaded tap the mic -> Download (base.en 142 MB) -> while it downloads type and send a chat message
- **Expect:** Chat send works during the whole download; the mic shows the mic-off glyph with a small determinate progress ring (fills by quarter) - NEVER the rotating busy spinner; spinner appears only on a tap-triggered model load or live transcription
- **Result:** Android ☐  ·  iOS ☐

### 162. [FULL·100%auto] #193 — Stale failure card cleared when a new attempt starts
*P1 · 12 This-release · Fully automated — manual spot-check*
- **Do:** Trigger the No response failure card (model emits 0 tokens; e.g. a K-quant on an incompatible backend) -> send a NEW message
- **Expect:** The failure card disappears as soon as the new attempt starts; no dead card sits next to the live stream; the new reply renders
- **Result:** Android ☐  ·  iOS ☐

### 163. [FULL·100%auto] #196 — Model file-list failure is retryable
*P1 · 12 This-release · Fully automated — manual spot-check*
- **Do:** Models -> search -> open a model while its Hugging Face file-list request fails -> tap Retry
- **Expect:** A connection-specific retry state appears; Retry fetches and renders the available files; no false empty-model message
- **Result:** Android ☐  ·  iOS ☐

### 164. [FULL·100%auto] #198 — Interleaved thinking blocks stay isolated
*P1 · 12 This-release · Fully automated — manual spot-check*
- **Do:** Thinking ON -> use a model that reasons -> calls a tool -> reasons again -> answers
- **Expect:** While the second thinking block streams it shows ONLY second-round reasoning; after completion both blocks remain separate and ordered around the tool result
- **Result:** Android ☐  ·  iOS ☐

### 165. [FULL·100%auto] #221 — Model browse filter tab and fit-chip lifecycle
*P1 · 15 Changed-owner audit · Fully automated — manual spot-check*
- **Do:** Search a model -> change organization size and type filters -> switch Text Image and Voice tabs -> download then delete one result
- **Expect:** Results and fit chips stay truthful on every tab; loadable Tight models remain visible; downloaded state updates once and deletion restores the correct action
- **Result:** Android ☐  ·  iOS ☐

### 166. [FULL·100%auto] #224 — Conversation create rename open and delete coherence
*P1 · 15 Changed-owner audit · Fully automated — manual spot-check*
- **Do:** Create two chats -> rename the first -> open the second -> delete it -> reopen the renamed chat -> relaunch
- **Expect:** Only the intended chat is renamed or deleted; the active route never points at deleted data; the surviving chat and messages persist
- **Result:** Android ☐  ·  iOS ☐

### 167. [FULL·100%auto] #235 — Home and Chat model pickers remain identical
*P1 · 15 Changed-owner audit · Fully automated — manual spot-check*
- **Do:** Download two models -> load one -> compare Home picker Chat picker and In Memory -> complete a turn -> compare again
- **Expect:** Active downloaded and resident identity is the same on every surface before and after generation; no stale badge count or selection
- **Result:** Android ☐  ·  iOS ☐

### 168. [FULL·100%auto] #242 — Tool markup never leaks into visible replies
*P1 · 15 Retained PR558 · Fully automated — manual spot-check*
- **Do:** Use a tool-capable local and remote model that emits function or channel markup around a calculator call
- **Expect:** The tool result and clean answer render in order; no literal function tags channel markers or raw JSON appear in user-visible text
- **Result:** Android ☐  ·  iOS ☐

### 169. [FULL·100%auto] #243 — Image resend without an image model falls back to text
*P1 · 15 Retained PR558 · Fully automated — manual spot-check*
- **Do:** Open an old image-request turn after deleting or unloading every image model -> tap Regenerate
- **Expect:** The app produces a coherent text response or an actionable model-selection state; it never crashes or claims a missing image runtime as a completed generation
- **Result:** Android ☐  ·  iOS ☐

### 170. [FULL·100%auto] #244 — Queued forced-image request preserves image mode
*P1 · 15 Retained PR558 · Fully automated — manual spot-check*
- **Do:** Start a long text generation -> force Image mode -> send an image prompt while the first turn runs -> let the queue drain
- **Expect:** The queued turn runs the image pipeline and renders an image; it does not silently fall back to text or lose its force-image flag
- **Result:** Android ☐  ·  iOS ☐

# ── P2 ──

### 171. [NONE·0%auto] #204 — Warm app-start comparison
*P2 · 13 Performance · Manual only — no automated safety net*
- **Do:** Background then swipe away production and candidate after one completed boot -> relaunch each 5 times
- **Expect:** Median candidate warm start is no more than 15 percent slower than production; no blank frame or delayed navigation
- **Result:** Android ☐  ·  iOS ☐

### 172. [NONE·0%auto] #208 — Large-chat render and scroll responsiveness
*P2 · 13 Performance · Manual only — no automated safety net*
- **Do:** Open a chat with 200+ mixed messages including markdown images thinking and tool blocks -> rapidly scroll end-to-end and open older blocks
- **Expect:** Scrolling remains responsive; no missing or duplicated rows; composer input latency stays acceptable; memory does not climb on each pass
- **Result:** Android ☐  ·  iOS ☐

### 173. [NONE·0%auto] #216 — iOS Debug build name is distinct
*P2 · 14 Device-only legacy · Manual only — no automated safety net*
- **Do:** Install the Debug ai.offgridmobile.dev build on an iPhone and inspect its home-screen icon label
- **Expect:** The label is Off Grid AI Debug; it is not blank literal variable text or the release-app name
- **Result:** Android ☐  ·  iOS ☐

### 174. [LOW·25%auto] #175 — Thermal / long-context stress
*P2 · 11 Polish · Thin automation — verify carefully*
- **Do:** Push a very long/runaway context and keep sending (observational)
- **Expect:** Degrades gracefully or warns; note if it throttles to unusable then crashes
- **Result:** Android ☐  ·  iOS ☐

### 175. [PARTIAL·50%auto] #27 — GPU init timeout falls back to CPU
*P2 · 2 Text gen · Core path automated, edges manual*
- **Do:** Pick GPU/OpenCL and reload; if GPU init times out
- **Expect:** Model still loads on CPU and a reply renders; no silent hang; details show CPU
- **Result:** Android ☐  ·  iOS ☐

### 176. [PARTIAL·50%auto] #58 — Double-tap mic no collision
*P2 · 3 Voice · Core path automated, edges manual*
- **Do:** Double-tap the chat-mode mic quickly
- **Expect:** ONE clean recording; no second colliding session
- **Result:** Android ☐  ·  iOS ☐

### 177. [PARTIAL·50%auto] #65 — Voice thinking block width + alignment
*P2 · 3 Voice · Core path automated, edges manual*
- **Do:** Voice mode -> a reply that thinks
- **Expect:** Thinking block width == voice-note bubble width and left-aligned (not full-width edge-to-edge)
- **Result:** Android ☐  ·  iOS ☐

### 178. [PARTIAL·50%auto] #78 — Photo permission prompt on first attach
*P2 · 4 Vision · Core path automated, edges manual*
- **Do:** The FIRST time you attach an image, allow the OS photo prompt
- **Expect:** OS photo-permission prompt appears; after Allow, the picker opens and the image attaches
- **Result:** Android ☐  ·  iOS ☐

### 179. [PARTIAL·50%auto] #79 — Photo permission DENIED handled gracefully
*P2 · 4 Vision · Core path automated, edges manual*
- **Do:** Deny photo access (or revoke in OS settings) then try to attach an image
- **Expect:** A clear cannot access photos message; attach aborts cleanly; no crash. Revoke-then-reopen re-prompts or shows the message
- **Result:** Android ☐  ·  iOS ☐

### 180. [PARTIAL·50%auto] #98 — Aggressive does not over-commit dirty
*P2 · 5 Memory · Core path automated, edges manual*
- **Do:** Aggressive -> Load-Anyway a very large dirty (litert/image) model at low free RAM
- **Expect:** Refused / not resident (never green-lights a guaranteed OOM for dirty pages)
- **Result:** Android ☐  ·  iOS ☐

### 181. [PARTIAL·50%auto] #111 — Device info memory readout
*P2 · 5 Memory · Core path automated, edges manual*
- **Do:** Settings -> Device Info
- **Expect:** Total RAM, available memory, app footprint, and process limit render truthfully
- **Result:** Android ☐  ·  iOS ☐

### 182. [PARTIAL·50%auto] #161 — Orientation behavior
*P2 · 11 Polish · Core path automated, edges manual*
- **Do:** Rotate the phone during a chat
- **Expect:** App stays portrait on phone (locked); iPad may rotate - no broken layout either way
- **Result:** Android ☐  ·  iOS ☐

### 183. [PARTIAL·50%auto] #177 — Follow on X opens the profile
*P2 · 11 Polish · Core path automated, edges manual*
- **Do:** Settings -> Stay in the loop -> tap 'Follow @alichherawalla on X'
- **Expect:** Opens the X profile in the browser/app
- **Result:** Android ☐  ·  iOS ☐

### 184. [PARTIAL·50%auto] #178 — Join Slack opens the invite
*P2 · 11 Polish · Core path automated, edges manual*
- **Do:** Settings -> Stay in the loop -> tap 'Join the Slack community'
- **Expect:** Opens the Slack invite link
- **Result:** Android ☐  ·  iOS ☐

### 185. [PARTIAL·50%auto] #179 — Share on X prefilled
*P2 · 11 Polish · Core path automated, edges manual*
- **Do:** Settings -> Community -> tap 'Share on X'
- **Expect:** Opens X compose prefilled with the Off Grid share text
- **Result:** Android ☐  ·  iOS ☐

### 186. [PARTIAL·50%auto] #200 — MCP OAuth cancel refresh and retry
*P2 · 12 This-release · Core path automated, edges manual*
- **Do:** Add an OAuth MCP preset -> cancel the system-browser sign-in -> retry and approve; then expire/revoke the access token or use a server that returns one 401
- **Expect:** Cancel returns to an inactive actionable card; retry opens sign-in; expired/401 token refreshes once and the server becomes Active with tools listed
- **Result:** Android ☐  ·  iOS ☐

### 187. [PARTIAL·50%auto] #201 — Repeated LAN scan keeps multiple servers unique
*P2 · 12 This-release · Core path automated, edges manual*
- **Do:** Run Ollama and LM Studio or Gateway on two LAN endpoints -> Settings -> Remote Servers -> Scan Network twice
- **Expect:** First scan adds every reachable server once; second says Already Added; exactly one row per endpoint
- **Result:** Android ☐  ·  iOS ☐

### 188. [PARTIAL·50%auto] #233 — Support links fail gracefully
*P2 · 15 Changed-owner audit · Core path automated, edges manual*
- **Do:** Disable network or make the OS reject URL opening -> tap Follow on X Join Slack Share on X and the desktop/support link
- **Expect:** The app remains usable and shows or logs an actionable failure; no crash stuck sheet or repeated support prompt occurs
- **Result:** Android ☐  ·  iOS ☐

### 189. [HIGH·75%auto] #3 — Onboarding skip when server+model already set
*P2 · 0 Install · Strongly automated — manual confirm*
- **Do:** Configure a remote server + model during onboarding then tap Continue
- **Expect:** Routes straight into the app (Home); remaining onboarding skipped
- **Result:** Android ☐  ·  iOS ☐

### 190. [HIGH·75%auto] #10 — Download a second whisper model
*P2 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** Download a second whisper size (e.g. small.en) alongside base.en
- **Expect:** Completes; both listed
- **Result:** Android ☐  ·  iOS ☐

### 191. [HIGH·75%auto] #22 — Download an embedding model (first KB use)
*P2 · 1 Downloads · Strongly automated — manual confirm*
- **Do:** First KB attach will download the embedding model - do it now or allow it in phase 6
- **Expect:** Embedding model downloads and is available for indexing
- **Result:** Android ☐  ·  iOS ☐

### 192. [HIGH·75%auto] #26 — CPU backend (GGUF)
*P2 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Backend = CPU -> reload -> send
- **Expect:** Reply renders on CPU; details show CPU
- **Result:** Android ☐  ·  iOS ☐

### 193. [HIGH·75%auto] #32 — Top-P applies to a generation
*P2 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Set Top-P -> send a prompt
- **Expect:** Generation runs with the chosen top-p (no error; sampler honored)
- **Result:** Android ☐  ·  iOS ☐

### 194. [HIGH·75%auto] #35 — CPU threads applies
*P2 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Advanced -> change CPU Threads -> reload -> send
- **Expect:** Reply renders; no crash with the chosen thread count
- **Result:** Android ☐  ·  iOS ☐

### 195. [HIGH·75%auto] #36 — Batch size applies
*P2 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Advanced -> change Batch Size -> reload -> send
- **Expect:** Reply renders; no crash with the chosen batch (32-512)
- **Result:** Android ☐  ·  iOS ☐

### 196. [HIGH·75%auto] #37 — Flash attention toggle applies
*P2 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Advanced -> toggle Flash Attention On -> reload -> send
- **Expect:** Reply renders with flash attention on; no crash
- **Result:** Android ☐  ·  iOS ☐

### 197. [HIGH·75%auto] #45 — Copy a message
*P2 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** On an assistant reply open the action menu -> Copy
- **Expect:** The message text is copied to the clipboard (paste to confirm)
- **Result:** Android ☐  ·  iOS ☐

### 198. [HIGH·75%auto] #50 — Context-full new-chat prompt
*P2 · 2 Text gen · Strongly automated — manual confirm*
- **Do:** Fill the context window then keep sending
- **Expect:** A context-full state / New chat prompt appears; not a silent hang or crash
- **Result:** Android ☐  ·  iOS ☐

### 199. [HIGH·75%auto] #76 — First-gen warmup notice is accurate
*P2 · 4 Image · Strongly automated — manual confirm*
- **Do:** First image gen on a fresh model
- **Expect:** The one-time warmup notice roughly matches actual time (not a misleading 120s for a 10s gen)
- **Result:** Android ☐  ·  iOS ☐

### 200. [HIGH·75%auto] #77 — Generated images appear in Gallery
*P2 · 4 Image · Strongly automated — manual confirm*
- **Do:** Generate one or more images -> open the Gallery screen
- **Expect:** The generated images appear in the gallery grid; tap opens fullscreen; delete/save work
- **Result:** Android ☐  ·  iOS ☐

### 201. [HIGH·75%auto] #81 — Image + text in one turn
*P2 · 4 Vision · Strongly automated — manual confirm*
- **Do:** Attach an image AND type a question in the same turn -> send
- **Expect:** The model answers about BOTH the image and the text prompt in one reply
- **Result:** Android ☐  ·  iOS ☐

### 202. [HIGH·75%auto] #91 — TTS co-resident in a voice turn
*P2 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Voice mode -> complete a turn that speaks the reply -> open In Memory
- **Expect:** In Memory lists tts with its RAM co-resident with text (reclaimable sidecar)
- **Result:** Android ☐  ·  iOS ☐

### 203. [HIGH·75%auto] #92 — Embedding sidecar resident on KB embed
*P2 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Attach a doc to a project KB (phase 6) then open In Memory
- **Expect:** The embedding model lazy-loads and co-resides as a sidecar (resident-item-embedding)
- **Result:** Android ☐  ·  iOS ☐

### 204. [HIGH·75%auto] #110 — Delete mid-playback does not kill audio
*P2 · 5 Memory · Strongly automated — manual confirm*
- **Do:** Voice turn speaking (TTS playing) -> delete the Voice model in Download Manager
- **Expect:** Playback stays intact (Stop control remains); does not snap to idle mic
- **Result:** Android ☐  ·  iOS ☐

### 205. [HIGH·75%auto] #114 — Preview a KB document
*P2 · 6 KB/Projects · Strongly automated — manual confirm*
- **Do:** Open an indexed KB doc
- **Expect:** The document preview renders its content (no crash / blank)
- **Result:** Android ☐  ·  iOS ☐

### 206. [HIGH·75%auto] #115 — Scanned PDF clear message
*P2 · 6 KB/Projects · Strongly automated — manual confirm*
- **Do:** Attach a scanned/image-only PDF (no text layer)
- **Expect:** A clear scanned PDF / no text layer message (not a vague error)
- **Result:** Android ☐  ·  iOS ☐

### 207. [HIGH·75%auto] #116 — >5MB file rejected
*P2 · 6 KB/Projects · Strongly automated — manual confirm*
- **Do:** Attach a file larger than 5MB
- **Expect:** Maximum size 5MB message; file not added
- **Result:** Android ☐  ·  iOS ☐

### 208. [HIGH·75%auto] #125 — Device info tool runs
*P2 · 7 Tools · Strongly automated — manual confirm*
- **Do:** Enable get_device_info -> ask about the device
- **Expect:** A tool-result bubble with device info renders
- **Result:** Android ☐  ·  iOS ☐

### 209. [HIGH·75%auto] #126 — Web search tool runs
*P2 · 7 Tools · Strongly automated — manual confirm*
- **Do:** Enable web_search -> ask a question needing a lookup
- **Expect:** A tool-result bubble with search results renders (or a clear no-network error)
- **Result:** Android ☐  ·  iOS ☐

### 210. [HIGH·75%auto] #136 — MCP tool error handled
*P2 · 7 Tools · Strongly automated — manual confirm*
- **Do:** Trigger an MCP tool error (server down / bad params)
- **Expect:** A clear error / graceful message; no stuck spinner; no crash
- **Result:** Android ☐  ·  iOS ☐

### 211. [HIGH·75%auto] #141 — Remote reasoning renders (Ollama)
*P2 · 8 Remote · Strongly automated — manual confirm*
- **Do:** Ollama remote reasoning model + tools -> send
- **Expect:** A thinking block shows the reasoning AND tool-result bubbles render
- **Result:** Android ☐  ·  iOS ☐

### 212. [HIGH·75%auto] #146 — Remote request timeout
*P2 · 8 Remote · Strongly automated — manual confirm*
- **Do:** Point at an unresponsive/slow remote endpoint -> send
- **Expect:** A clear timeout error surfaces; spinner clears; retriable
- **Result:** Android ☐  ·  iOS ☐

### 213. [HIGH·75%auto] #147 — Malformed remote response handled
*P2 · 8 Remote · Strongly automated — manual confirm*
- **Do:** Connect to an endpoint that returns non-JSON / malformed SSE -> send
- **Expect:** A clear error (not a crash / not garbage rendered as the answer)
- **Result:** Android ☐  ·  iOS ☐

### 214. [HIGH·75%auto] #160 — Long-text wrapping
*P2 · 11 Polish · Strongly automated — manual confirm*
- **Do:** Send a prompt that yields a very long unbroken string / wide code block
- **Expect:** Text wraps / scrolls inside its bubble; no horizontal overflow off-screen
- **Result:** Android ☐  ·  iOS ☐

### 215. [HIGH·75%auto] #162 — About screen renders
*P2 · 11 Polish · Strongly automated — manual confirm*
- **Do:** Settings -> About
- **Expect:** Version, description, and links (GitHub/X/Slack) render; links open
- **Result:** Android ☐  ·  iOS ☐

### 216. [HIGH·75%auto] #176 — Stay-in-the-loop card placement
*P2 · 11 Polish · Strongly automated — manual confirm*
- **Do:** Settings -> scroll to the community area
- **Expect:** 'Stay in the loop' card sits directly BELOW 'Off Grid AI PRO' and ABOVE 'Star on GitHub'
- **Result:** Android ☐  ·  iOS ☐

### 217. [FULL·100%auto] #5 — Downloaded model shows Downloaded indicator
*P2 · 1 Downloads · Fully automated — manual spot-check*
- **Do:** After the text download completes open Models
- **Expect:** The model card shows a Downloaded mark; count matches what you downloaded
- **Result:** Android ☐  ·  iOS ☐

### 218. [FULL·100%auto] #6 — Model info / credibility shown on the card
*P2 · 1 Downloads · Fully automated — manual spot-check*
- **Do:** Open Models and read a model card / open its details
- **Expect:** Model size, quant, and credibility/source info render (not a blank card)
- **Result:** Android ☐  ·  iOS ☐

### 219. [FULL·100%auto] #40 — Thinking header reads Thinking while streaming
*P2 · 2 Text gen · Fully automated — manual spot-check*
- **Do:** Use a litert or remote reasoning turn and watch the thinking-box header
- **Expect:** Header reads Thinking... while reasoning streams (not the DONE label prematurely)
- **Result:** Android ☐  ·  iOS ☐

### 220. [FULL·100%auto] #41 — Long output cutoff indicator
*P2 · 2 Text gen · Fully automated — manual spot-check*
- **Do:** Ask for a very long output that hits the token cap
- **Expect:** A visible cut-off / continue indicator appears (not silently truncated)
- **Result:** Android ☐  ·  iOS ☐

### 221. [FULL·100%auto] #49 — Reset to Defaults (text params)
*P2 · 2 Text gen · Fully automated — manual spot-check*
- **Do:** Chat Settings sheet -> change text params -> tap Reset to Defaults
- **Expect:** The text sampler params return to defaults
- **Result:** Android ☐  ·  iOS ☐

### 222. [FULL·100%auto] #64 — No stray empty bubble in voice tool turn
*P2 · 3 Voice · Fully automated — manual spot-check*
- **Do:** Voice mode + calculator -> a tool turn whose post-tool content is a stray marker
- **Expect:** No empty / hash-only bubble renders; the tool-result bubble is present
- **Result:** Android ☐  ·  iOS ☐

### 223. [FULL·100%auto] #68 — Image size floors at 256
*P2 · 4 Image · Fully automated — manual spot-check*
- **Do:** In image settings drag the size to minimum
- **Expect:** Size floors at 256; you cannot select 128
- **Result:** Android ☐  ·  iOS ☐

### 224. [FULL·100%auto] #71 — Tap attached (pre-send) image previews
*P2 · 4 Image · Fully automated — manual spot-check*
- **Do:** Attach an image then tap its thumbnail in the input box before sending
- **Expect:** A fullscreen preview opens
- **Result:** Android ☐  ·  iOS ☐

### 225. [FULL·100%auto] #74 — Reset to Defaults resets image params
*P2 · 4 Image · Fully automated — manual spot-check*
- **Do:** Change image params -> Chat Settings -> Reset to Defaults
- **Expect:** Image steps/size/guidance/threads ALSO reset (not only text params)
- **Result:** Android ☐  ·  iOS ☐

### 226. [FULL·100%auto] #75 — Chat-modal vs Model-Settings sliders agree
*P2 · 4 Image · Fully automated — manual spot-check*
- **Do:** Compare the image size/steps sliders in the chat modal vs Model Settings
- **Expect:** Same mins/fallbacks (both floor at 256)
- **Result:** Android ☐  ·  iOS ☐

### 227. [FULL·100%auto] #120 — Context-full new chat keeps project
*P2 · 6 KB/Projects · Fully automated — manual spot-check*
- **Do:** Project chat -> fill context -> tap New chat in the alert
- **Expect:** The continuation chat inherits the project
- **Result:** Android ☐  ·  iOS ☐

### 228. [FULL·100%auto] #121 — Edit a project
*P2 · 6 KB/Projects · Fully automated — manual spot-check*
- **Do:** Open a project -> edit its name/details -> save
- **Expect:** The edited details persist and show in the list
- **Result:** Android ☐  ·  iOS ☐

### 229. [FULL·100%auto] #124 — Datetime tool runs
*P2 · 7 Tools · Fully automated — manual spot-check*
- **Do:** Enable get_current_datetime -> ask what time is it
- **Expect:** A tool-result bubble with the current date/time renders
- **Result:** Android ☐  ·  iOS ☐

### 230. [FULL·100%auto] #128 — Thinking + tool + answer render in order
*P2 · 7 Tools · Fully automated — manual spot-check*
- **Do:** Thinking + calculator on -> send a reason+compute prompt
- **Expect:** Thinking block, tool-result bubble, and final answer all render in order
- **Result:** Android ☐  ·  iOS ☐

### 231. [FULL·100%auto] #130 — Stringified tool args parsed
*P2 · 7 Tools · Fully automated — manual spot-check*
- **Do:** Tool on -> model emits arguments as a stringified JSON string
- **Expect:** Tool runs with parsed params -> result bubble
- **Result:** Android ☐  ·  iOS ☐

### 232. [FULL·100%auto] #131 — Tool router no false positive
*P2 · 7 Tools · Fully automated — manual spot-check*
- **Do:** Several tools; router prose contains a tool name as a substring or says none
- **Expect:** Correct/no tool selected (no wrong-tool force-select; none branch respected)
- **Result:** Android ☐  ·  iOS ☐

### 233. [FULL·100%auto] #137 — MCP guide screen renders
*P2 · 7 Tools · Fully automated — manual spot-check*
- **Do:** Open the MCP guide/help screen
- **Expect:** The guide renders with instructions; no blank/crash
- **Result:** Android ☐  ·  iOS ☐

### 234. [FULL·100%auto] #139 — No phantom servers on empty scan
*P2 · 8 Remote · Fully automated — manual spot-check*
- **Do:** Scan for servers with none configured
- **Expect:** No Servers Found message AND empty state persist and agree; no phantom entry
- **Result:** Android ☐  ·  iOS ☐

### 235. [FULL·100%auto] #140 — Remote model has a visible indicator
*P2 · 8 Remote · Fully automated — manual spot-check*
- **Do:** Add a remote server -> open the model selector
- **Expect:** The remote model is marked (wifi/server header + Remote badge) distinct from local
- **Result:** Android ☐  ·  iOS ☐

### 236. [FULL·100%auto] #148 — Local select makes the model active
*P2 · 8 Remote · Fully automated — manual spot-check*
- **Do:** Load a local model -> send a NEW message (not a resend)
- **Expect:** The generation uses the LOCAL model (isRemote=false)
- **Result:** Android ☐  ·  iOS ☐

### 237. [FULL·100%auto] #149 — Home Text count truthful with remote active
*P2 · 8 Remote · Fully automated — manual spot-check*
- **Do:** Home with a remote model active -> read the Text count
- **Expect:** Count reads the LOCAL count (e.g. 0) truthfully; the Text type shows the active remote model
- **Result:** Android ☐  ·  iOS ☐

### 238. [FULL·100%auto] #152 — Enhancement shows progress
*P2 · 9 Enhancement · Fully automated — manual spot-check*
- **Do:** Watch the screen during the enhancement step
- **Expect:** The partial enhanced text streams / a real progress indicator shows (not a frozen static card)
- **Result:** Android ☐  ·  iOS ☐

### 239. [FULL·100%auto] #153 — Enhancement rewrites then regenerates
*P2 · 9 Enhancement · Fully automated — manual spot-check*
- **Do:** Enhancement on, thinking OFF -> generate
- **Expect:** Prompt rewritten -> image regenerated from it
- **Result:** Android ☐  ·  iOS ☐

### 240. [FULL·100%auto] #156 — Theme switch applies (System/Light/Dark)
*P2 · 11 Polish · Fully automated — manual spot-check*
- **Do:** Settings -> Appearance -> pick Light, then Dark, then System
- **Expect:** The whole app recolors to the chosen theme immediately (emerald accent shifts light/dark)
- **Result:** Android ☐  ·  iOS ☐

### 241. [FULL·100%auto] #157 — Empty state: no models
*P2 · 11 Polish · Fully automated — manual spot-check*
- **Do:** Fresh app with no models downloaded -> open Home / model selector
- **Expect:** A clear no-models empty state (not a blank screen)
- **Result:** Android ☐  ·  iOS ☐

### 242. [FULL·100%auto] #158 — Empty state: no chats
*P2 · 11 Polish · Fully automated — manual spot-check*
- **Do:** With no conversations -> open the Chats list
- **Expect:** A clear no-chats empty state
- **Result:** Android ☐  ·  iOS ☐

### 243. [FULL·100%auto] #159 — Empty state: no KB docs
*P2 · 11 Polish · Fully automated — manual spot-check*
- **Do:** Open a project with no documents
- **Expect:** A clear No documents yet empty state
- **Result:** Android ☐  ·  iOS ☐

### 244. [FULL·100%auto] #163 — Storage usage screen
*P2 · 11 Polish · Fully automated — manual spot-check*
- **Do:** Settings -> Storage
- **Expect:** Storage usage + per-model sizes render; orphaned files section works; clear cache works
- **Result:** Android ☐  ·  iOS ☐

### 245. [FULL·100%auto] #165 — Share/promo sheet once per session
*P2 · 11 Polish · Fully automated — manual spot-check*
- **Do:** Trigger several generations in one session
- **Expect:** The Support/Share sheet appears at MOST once per app session and dismisses without re-nagging
- **Result:** Android ☐  ·  iOS ☐

### 246. [FULL·100%auto] #189 — TTS download respects the concurrency cap
*P2 · 12 This-release · Fully automated — manual spot-check*
- **Do:** With 3 downloads running start the Kokoro TTS download
- **Expect:** Kokoro QUEUES (does not start a 4th parallel transfer)
- **Result:** Android ☐  ·  iOS ☐

### 247. [FULL·100%auto] #199 — Tool enable and disable persist
*P2 · 12 This-release · Fully automated — manual spot-check*
- **Do:** Enable calculator -> cold relaunch -> confirm enabled -> run it -> disable -> cold relaunch -> confirm disabled -> send again
- **Expect:** Enable and disable choices survive relaunch; calculator schema is available only on turns sent while enabled
- **Result:** Android ☐  ·  iOS ☐
