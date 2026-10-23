# Opt-in analytics

Off Grid AI Mobile (OGAM) and Off Grid AI Desktop (OGAD) send anonymous usage data and crash reports to PostHog Cloud EU, only after the user opts in. This file is the single list of what we send. OGAM and OGAD keep an identical copy; change both together.

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
- `engine`: `llama.cpp`, `mlx`, `litert`, `executorch`, `coreml`, `onnx`, `whisper`, `remote`.
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

### Generation

| Event | Properties |
|---|---|
| `generation_finished` | `modality` (`text`, `vision`, `image`, `stt`, `tts`, `embedding`), `model`, `engine`, `backend`, `outcome` (`done`, `stopped`, `failed`), `ttft_ms`, `tokens_per_sec`, `context_tokens_bucket` (`<2k`, `2-8k`, `8-32k`, `>32k`), `battery_pct` (rounded to 10), `charging`, `error_code`, `source` (`app`, `api`, `extension`; OGAD only) |

### Actions

| Event | Properties |
|---|---|
| `chat_created` | none |
| `message_sent` | `has_image`, `has_document`, `tools_enabled` |
| `reply_regenerated` | none |
| `project_created` | none |
| `document_added` | `file_type` (extension only), `size_bucket` |
| `feature_used` | `feature`: `voice_input`, `tts`, `image_generation`, `vision`, `web_search`, `tools`, `mcp_tool`, `remote_server`, `browser_action`, `clipboard`, `meetings`, `sync` |
| `features_snapshot` | once a day: one `true`/`false` property per feature that is switched on |
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
| `onboarding` | `setup_shown`, `download_started`, `download_done`, `model_loaded`, `first_message` |
| `model_transfer` | `opened`, `device_picked`, `model_picked`, `started` |
| `sync_pairing` | `opened`, `code_shown`, `code_entered`, `paired` |
| `remote_server` | `opened`, `address_entered`, `tested`, `connected` |
| `voice_setup` | `opened`, `model_picked`, `downloaded` |
| `image_setup` | `opened`, `model_picked`, `downloaded` |
| `connector_add` | `opened`, `connector_picked` (`catalog_id` or `custom`), `authorised` |
| `pro_upgrade` | `gate_shown` (`feature`), `paywall_viewed`, `trial_started`, `purchased` |

### Crashes

| Event | Properties |
|---|---|
| `$exception` | SDK exception capture. Scrub message and frames before send: replace paths with the file name only, drop any quoted text, keep type, file name, line, function. A file name is kept only for the app's own code (e.g. `index.js`); a person's file, the home folder and the account name become `<file>` / `<user>`. |
| `unclean_exit` | Sent on the next launch when the app died in the foreground during a model load or a generation. `stage` (`load`, `generate`), `model`, `engine`, `backend`, `free_ram_gb`, `elapsed_ms`. Not sent after a background kill, an app update or a reboot. |
| `llama_server_crashed` (OGAD) | `model`, `engine`, `backend`, `exit_code`, `classified` |

## Report a problem

- Opens the mail composer to the support address with the debug log attached. If no mail app is set up, use the share sheet.
- The debug log never holds chat content: no log line may include prompts, replies, transcripts or tool output.
- The user sees the log before it is sent.
- It works whether or not analytics is on.
