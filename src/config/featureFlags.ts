/**
 * App feature flags — SINGLE source of truth. Import from here; never re-declare a
 * local copy (four separate `HTP_ENABLED`/`HTP_UI_ENABLED` consts had drifted, so
 * NPU showed in one settings screen but not the chat one).
 */

/**
 * HTP / Hexagon NPU acceleration (Qualcomm Snapdragon, text LLMs via llama.rn's
 * `devices:['HTP0']`). Enabled: llama.rn ships the prebuilt hexagon DSP libs
 * (librnllama_..._hexagon_opencl.so + libggml-htp-v*.so). Gates BOTH the runtime
 * routing and the UI option (they must always agree — one flag).
 */
export const HTP_ENABLED = true;
