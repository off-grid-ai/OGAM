# Atlas — Project Knowledge Files and Regression Follow-up
Date: October 14, 2026
Working branch: audit/atlas-stability-c20261014
Base: PR #7 / previously audited commit 5f7f24d

## Project document backup and restore
- Password-encrypted portable backups now carry a v2 projectFiles manifest alongside ordinary chats, project settings, agents and other included stores.
- Each knowledge-base file includes the original file bytes (base64), filename, original project ID, stored indexed text chunks, creation timestamp, and enabled/disabled status.
- Import validates project membership, filename/path safety, file size and content length, and duplicate entries before creating any files.
- Files are written to a durable project-specific directory and the project KB index is updated in one SQLite transaction; a failed transaction cleans up staged file copies.
- Existing v1 encrypted backups and plain v1 settings-only backups remain importable.
- Plain JSON backups continue to exclude project file bytes and chats. PIN-protected chat/project vault data is intentionally excluded from portable backup because Android Keystore keys cannot transfer to a new phone.
- A v2 backup is limited to 25 MB of original knowledge-base file bytes in total (maximum 25 MB per individual file), with the outer encrypted JSON size limit. Oversized or inaccessible documents fail with an error; they are never silently omitted.
- Some old indexed paths are picker-cache paths: export can locate the unique persistent attachments copy by filename, otherwise fails and asks user to reattach.
- New document imports now index their durable copied location rather than the transient picker URL.
- A completed restore recreates file associations and saved text chunks. Semantic embedding vectors are not portable in this format and must be regenerated for full semantic quality. Search has a no-embeddings fallback.

## Regression work completed
- 10 project-file unit tests PASS; 3 encrypted backup round-trip integration tests PASS.
- Four deliberately skipped app-bug checks enabled and PASS (decoded document filename and malformed URI, LiteRT resident unload, server tool-capability filter).
- Image generation lifecycle suite: 61/61 PASS after the no-GPU test fixture explicitly chooses CPU and checks truthful backend metadata.
- QNN compiled-variant compatibility suites PASS with exact variant matching, not unsupported assumptions that every high-end chip runs every compiled model.
- Focused ProjectEditScreen, SecuritySettingsScreen, image metadata, project RAG and HomeScreen privacy-choice suites PASS; old expectations were corrected to current requirements.
- TypeScript `tsc --noEmit` PASS after these changes.

## Overall suite and outstanding work
- Initial baseline before this work: 6,973 passing; 66 failing; 25 skipped.
- Full post-backup initial scan (before the last targeted test updates): 6,987 passing; 69 failing; 21 skipped; 32 failing suites / 461 passing suites / 2 skipped suites. These numbers are not a green release gate.
- Multiple older UI and GPU tests still fail, including removed marketing elements, model selection, residency, native acceleration, downloads and tool handlers. Keep addressing them; do NOT claim all 66 baseline failures resolved.
- Native Android compilation / phone and tablet restore / filesystem durability across reinstall are NOT verified. No Android SDK was installed on the user's Surface.
- Re-run the entire regression suite and the GitHub native Android APK workflow for final release qualification. Until then, keep PR #7 in draft.
