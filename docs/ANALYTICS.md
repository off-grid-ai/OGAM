# Opt-in analytics

Off Grid AI Mobile (OGAM) and Off Grid AI Desktop (OGAD) send anonymous stats (counts of what was used and how fast models run) and crash reports to PostHog Cloud EU, only after the user opts in. This file is the single list of what we send. OGAM and OGAD keep an identical copy; change both together.

## Rules

- Off by default. The SDK is not created until the user opts in. Before opt-in the app makes no request to PostHog.
- Opt-out shuts the SDK down, drops anything queued and resets the anonymous ID.
- One random anonymous ID per install, made by the SDK. We never call `identify`, never send an email, license key, account ID or device hardware ID.
- PostHog project: EU Cloud, "discard client IP" on, GeoIP off, no autocapture, no session replay, no feature flags, no remote config, no surveys.
- Debug builds (`__DEV__`, unpackaged Electron) never start the SDK.
- Consent is per device. It never syncs between devices.
- Data retention: 12 months.

## Never send

- Prompts, replies, transcripts, reasoning, tool arguments or tool results.
- File names, document names, paths, URLs, domains, hostnames or IP addresses (including remote server and LAN addresses).
- Search terms.
- Names of imported model files, private Hugging Face repos or custom MCP connectors. Send `custom` instead.
- Error messages or stack frames before scrubbing (see Crashes).

## Properties on every event

| Property | Values |
|---|---|
| `platform` | `ios`, `android`, `macos`, `windows`, `linux` |
| `app_version` | e.g. `0.0.115` |
| `channel` | `stable`, `nightly` |
| `pro` | `true`, `false` |
| `device_class` | `phone`, `tablet`, `desktop` |
| `ram_gb` | total RAM, rounded to whole GB |
| `os_version` | e.g. `18.1`, `15` |
| `locale` | language only, e.g. `en` |

## Shared value rules

- `model`: catalog ID, or public Hugging Face `owner/repo`, or `custom`. Plus `quant` (e.g. `Q4_K_M`) and `size_bucket` (`<1GB`, `1-2GB`, `2-4GB`, `4-8GB`, `>8GB`).
- `engine`: `llama.cpp`, `mlx`, `litert`, `executorch`, `coreml`, `onnx`, `whisper`, `sd.cpp`, `remote`.
- `backend`: `cpu`, `gpu`, `npu`, `remote`.
- `error_code`: a fixed code from our own error classes, never a raw message.
- Durations in milliseconds, rounded. Rates rounded to one decimal.

## Events

### App and screens

| Event | Properties |
|---|---|
| `app_opened` | `cold_start_ms` |
| `app_backgrounded` | `session_ms` |
| `$screen` (OGAM, SDK `screen()`) / `screen_viewed` (OGAD) | `screen`, `prev_screen`, `prev_ms` |

`screen` is a route name in lowercase with dashes (`home`, `project-detail`), never its params. A tab inside a screen is `<screen>:<tab>` (`models:image`). A sheet or modal over a screen is `<screen>:<sheet>` (`chat:model-selector`); when it closes, the screen under it is shown again. Each name matches `^[a-z0-9][a-z0-9:_-]{0,47}$`.

### Session summary

Taps, long-presses, scrolling, errors shown and settings changed are counted on the device, never sent one by one. One `session_summary` goes when the session ends: on `app_backgrounded`, or on the next launch with `recovered: true` when the app was killed or crashed (the counters are kept on disk while the session runs, and only while Anonymous stats is on).

| Property | Values |
|---|---|
| `session_ms` | time in the foreground |
| `screens` | how many different screens were shown |
| `screen_views` | how many times a screen was shown |
| `actions` | `{ "<screen>:<id>": count }`, the 50 most used. `<id>` is the control's test id, never its label or any visible text. A test id with a variable part (`kb-document-remove-${id}`) is sent as its fixed part only (`kb-document-remove`), so ids and names never leave the device. Only ids written in the app's source can be sent; anything else counts as `other`. Each id matches `^[a-z0-9][a-z0-9:_-]{0,63}$`. A switch counts like a tap. |
| `long_press` | OGAM: `{ "<screen>:<id>": count }`, the same ids |
| `max_scroll_pct` | `{ "<screen>": 0 \| 25 \| 50 \| 75 \| 100 }`: how far down the screen's main list the person got, rounded down to a quarter. Up to 50 screens. |
| `errors_shown` | `{ "<key>": count }`. OGAD: an error toast's `error_code`. OGAM: `<screen>:alert` for an alert that reports a failure (only that yes/no is taken from it, never its words). |
| `settings_changed` | `{ "<setting>": count }`: the setting's name, plus `=<value>` only when the value is a switch or one of a fixed list (`theme=dark`, `flash_attn=true`). A number or text the person typed is never sent. |
| `recovered` | `true` when sent on the launch after the session it counts |
| `shortcuts`, `commands`, `error_responses`, `empty_states`, `notifications_clicked`, `chat_inputs` | OGAD only |

Each map is capped: 50 keys sent, 200 held while the session runs.

### Event budget

The PostHog free plan (about 1M events a month) also keeps the 12-month retention promise, so the event count is designed in:

- Per session: `app_opened`, `app_backgrounded`, `session_summary`, plus one `$screen` per screen, tab or sheet shown.
- Per message: `message_sent` and `generation_finished`.
- Once a day: `features_snapshot` and `usage_snapshot`.
- Everything a person does many times a minute (taps, scrolls, errors shown) is inside `session_summary`.

Estimate for an active user: 2 sessions (6), 12 screen views, 5 messages (10), 2 snapshots, 2 other actions: about 30 events a day. The free plan then covers about 33,000 active user-days a month, for example 1,100 people who use the app every day.

### Consent

| Event | Properties |
|---|---|
| `analytics_opted_in` | `source`: `setup`, `settings`, `failure_prompt`, `first_chat_prompt` |

### Models

| Event | Properties |
|---|---|
| `model_download_started` | `model`, `quant`, `size_bucket`, `network` (`wifi`, `cellular`, `ethernet`, `unknown`), `free_storage_gb` |
| `model_download_finished` | same + `duration_ms`, `mb_per_sec` |
| `model_download_failed` | same + `error_code` |
| `model_loaded` | `model`, `quant`, `engine`, `backend`, `soc`, `free_ram_gb`, `load_ms` |
| `model_load_failed` | same + `error_code` |

A video model pack reports downloads once for the whole pack: `model` is its catalog ID and `quant` is empty. A video model loads inside each generation: OGAD sends `model_loaded` / `model_load_failed` for each clip's engine start; OGAM sends none.

### Generation

| Event | Properties |
|---|---|
| `generation_finished` | `modality` (`text`, `vision`, `image`, `video`, `stt`, `tts`, `embedding`), `model`, `engine`, `backend`, `outcome` (`done`, `stopped`, `failed`), `ttft_ms`, `tokens_per_sec`, `context_tokens_bucket` (`<2k`, `2-8k`, `8-32k`, `>32k`), `battery_pct` (rounded to 10), `charging`, `error_code`, `source` (`app`, `api`, `extension`; OGAD only). Video sends `duration_ms` (the whole generation) instead of `ttft_ms`, `tokens_per_sec` and `context_tokens_bucket`, plus `has_init_image` (a start image or a continued shot), `story` (part of a film) and `quality` (`draft`, `final`) for films. |

### Actions

| Event | Properties |
|---|---|
| `chat_created` | none |
| `message_sent` | `has_image`, `has_document`, `tools_enabled` |
| `first_message` | once per launch, at the first message: `since_launch_ms`, `first_ever` (the first message on this install), `since_install_ms` (only when `first_ever`) |
| `message_action` | `action`: `copy`, `edit`, `delete` (OGAM has no message delete) |
| `item_deleted` | `item`: `chat`, `project`, `document` |
| `model_selected` | a model was picked: `modality` (`text`, `image`, `video`), `model`, `source` (`model_picker`, `models_screen`, `setup`, `chat`, `home`, `settings`, `video`, `unknown`) |
| `video_action` | `action`: `extend`, `make_story`, `save` |
| `reply_regenerated` | none |
| `project_created` | none |
| `document_added` | `file_type` (an extension the app opens, else `other`; `none` without one), `size_bucket` |
| `feature_used` | `feature`: `voice_input`, `tts`, `image_generation`, `video_generation`, `vision`, `web_search`, `tools`, `mcp_tool`, `remote_server`, `browser_action`, `clipboard`, `meetings`, `sync` |
| `features_snapshot` | once a day: one `true`/`false` property per feature that is switched on. `video_generation` is true when a local video model is active or a remote video model is picked. |
| `usage_snapshot` | once a day, beside `features_snapshot`: how much the person has. Counts: `chats`, `messages`, `user_messages`, `projects`, `knowledge_documents`, `generated_images`, `generated_videos`, `films`, `models_text`, `models_image`, `models_video`, `models_stt`, `models_tts`, `mcp_servers`, `paired_devices`, `remote_servers`. Each count is rounded down to the nearest of 0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000. Appearance: `theme` (`system`, `light`, `dark`), `font_scale` (OGAM: the system text size, one decimal). Never a name or a word. |
| `problem_reported` | none |

### Flows (funnels)

All multi-step journeys use three events with a `flow` property, so every funnel is built the same way in PostHog.

| Event | Properties |
|---|---|
| `flow_started` | `flow` |
| `flow_step` | `flow`, `step` |
| `flow_finished` | `flow`, `outcome` (`done`, `failed`, `cancelled`), `duration_ms`, `failed_step`, `error_code` |

| `flow` | Steps |
|---|---|
| `onboarding` | `setup_shown`, `download_started`, `download_done`, `model_loaded`, `first_message`. Setup is shown before the person can opt in, so `flow_started` and `setup_shown` are sent when they opt in on that screen. |
| `model_transfer` | `opened`, `device_picked`, `model_picked`, `started` |
| `sync_pairing` | `opened`, `code_shown`, `code_entered`, `paired` |
| `remote_server` | `opened`, `address_entered`, `tested`, `connected` |
| `voice_setup` | `opened`, `model_picked`, `downloaded` |
| `image_setup` | `opened`, `model_picked`, `downloaded` |
| `video_setup` | `opened`, `model_picked`, `downloaded` |
| `video_story` | `storyboard_shown`, `draft_started`, `draft_finished`, `final_started` (`detail`: `now`, `tonight`), `final_finished`, `exported`. A film made on another device reports on the device that rendered it. Never the sentence, shot text or narration. |
| `connector_add` | `opened`, `connector_picked` (`catalog_id` or `custom`), `authorised` |
| `pro_upgrade` | `gate_shown` (`feature`), `paywall_viewed`, `purchased` |

### Crashes

| Event | Properties |
|---|---|
| `$exception` | SDK exception capture. Scrub message and frames before send: replace paths with the file name only, drop any quoted text, keep type, file name, line, function. A file name is kept only for the app's own code (e.g. `index.js`); a person's file, the home folder and the account name become `<file>` / `<user>`. |
| `unclean_exit` | Sent on the next launch when the app died in the foreground during a model load or a generation. `stage` (`load`, `generate`; `generate` includes a video generation), `model`, `engine`, `backend`, `free_ram_gb`, `elapsed_ms`. Not sent after a background kill, an app update or a reboot. |
| `llama_server_crashed` (OGAD) | `model`, `engine`, `backend`, `exit_code`, `classified` |

## Report a problem

- OGAM: shows the debug log, then opens the share sheet addressed to support. iOS attaches the log file; Android puts the log's latest part in the message text.
- OGAD: shows the debug log with Copy, then opens a mail draft to the support address; the user pastes the log into it (a `mailto:` link cannot attach a file).
- The debug log never holds chat content: no log line may include prompts, replies, transcripts or tool output.
- The user sees the log before it is sent.
- It works whether or not analytics is on.
