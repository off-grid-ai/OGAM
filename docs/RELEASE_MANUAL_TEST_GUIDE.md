# Off Grid Mobile release test guide

Use RELEASE_TEST_CHECKLIST.csv as the single runnable checklist. It contains
247 end-to-end checks across fresh install, downloads, text/image/voice, memory,
projects and knowledge base, tools/MCP, remote models, persistence, current-release
regressions, and performance. Fill the Android and iOS cells with PASS, FAIL,
BLOCKED, or N/A, and put evidence or a short reason in Notes / annotations.

## Release decision

- Any reproducible P0 failure blocks the release.
- Any P1 regression versus the current production build blocks the release.
- A P2 failure needs an issue, owner, and explicit release decision; a stability
  regression should be fixed before release.
- A crash, OS kill, data loss, secret in logs/UI, stuck boot, stuck generation,
  or unrecoverable model/download state blocks the release regardless of row priority.
- BLOCKED is not a pass. Record the missing device, model, server, account, or
  reproduction condition so it can be completed.

## Device matrix

Run the complete sheet on at least one current Android phone and one current
iPhone. Run the memory, survival-floor, thermal, and performance phases on the
lowest-RAM supported Android and iPhone available as well. Add an Android device
with LiteRT support, and an iPad/tablet for the layout rows, when available.

For every run record:

- candidate commit/build number, production comparison version, date, and tester;
- device model, OS version, physical RAM/free storage, battery/charging state,
  and network type;
- model file, quantization, engine, backend, context size, loading mode, and
  enabled tools used by generation/performance rows;
- remote/MCP server name and version where applicable.

## Preparation

1. Keep both the current production build and candidate available for the same
   device, or capture the production baseline before installing the candidate.
2. Prepare a small GGUF, a tool-capable/reasoning GGUF, a vision GGUF plus
   projector, a LiteRT model on Android, an image model, Whisper, Kokoro, an
   embedding model, a large near-memory-limit model, and text/scanned/oversized PDFs.
3. Prepare Ollama or LM Studio, an Off Grid AI Gateway if available, and an OAuth
   MCP server/account. Keep a controllable bad endpoint for timeout/malformed tests.
4. Start with Debug Logs cleared. Enable Generation Details for backend, layer,
   token-rate, and timing evidence.
5. Run rows in numeric order: later phases intentionally reuse downloads, projects,
   chats, and resident models created earlier.

## How to record a failure

Do not retry silently. First preserve the state, then record:

- checklist row and exact last gesture;
- expected versus observed UI;
- whether it reproduces after one ordinary retry and after a cold relaunch;
- screen recording/screenshot and exported offgrid-debug.log timestamps;
- device/build/model/backend/loading mode/free-memory/network details;
- whether production on the same device behaves differently.

Continue testing unrelated rows unless the failure risks data loss, device safety,
or contaminates later preconditions. New findings should be added as new rows so
the regression becomes repeatable and can receive automated coverage where the
environment is controllable.

## Performance method

Use the same device, model files, prompts, backend, settings, persisted dataset,
network, and charging/thermal state for production and candidate. Take at least
five samples for startup/load/throughput rows and compare medians. Treat a candidate
regression greater than 15% as a release failure until explained and accepted.
For memory swaps and thermal soak, look for trends rather than one noisy sample:
monotonic growth, an OS kill, a stuck turn, or loss of recoverability is a failure.

At the end, export Debug Logs and attach the filled CSV plus recordings/profiler
captures. The release is ready for merge only when all P0/P1 rows pass, every P2
result is dispositioned, and the performance comparison has no unexplained regression.
