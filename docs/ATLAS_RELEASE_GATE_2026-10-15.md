# Atlas — Release Gate and Stability Audit

**Date:** 2026-10-15
**Audit branch:** audit/atlas-stability-c20261014
**PR:** https://github.com/coolchan03/Atlas/pull/7
**Release branch:** atlas-voice

## Verified locally

- Full Jest regression run: **496 suites passed, 0 failed; 7,076 tests passed, 0 failed; 2 suites / 21 tests skipped**.
- TypeScript \`tsc --noEmit\`: PASS.
- The failed-model-load regression now preserves selection for retry, clears loaded/resident state, and no longer reports an unloaded model as loaded.
- A genuine memory refusal is propagated so the UI can offer **Load Anyway** instead of a generic dead-end message.
- Resident model accounting does not report a successful eviction when native unload rejects.
- Large-model integration fixtures use sparse fake files with realistic reported sizes; no multi-gigabyte JS heap allocation.
- Explicit GPU/NPU requests do not silently fall back to CPU.
- GitHub workflow YAML and signing PowerShell syntax have been parsed successfully.

## CI changes

- Added **Atlas Core Audit** workflow: pull requests and audit branches must run TypeScript and all available Jest tests on GitHub.
- Official **Build Atlas APK** workflow now has blocking TypeScript and Jest checks instead of informational TS warnings.
- Official release APK build requires four GitHub secrets and a persistent release keystore. Gradle no longer silently falls back to debug signing when the release-signing requirement is enabled.
- APK verification includes signature verification and checks for ARM64 native llama.rn runtime.
- Publishing a public latest GitHub release is restricted to the stable \`atlas-voice\` branch; audit branches upload CI artifacts only.
- On Windows, \`scripts/release/setup-atlas-signing.bat\` configures the secrets using Git for Windows' OpenSSL or JDK \`keytool\`. The keystore is generated locally, not uploaded in source control. The user must securely back it up.

## Remaining external and historical risks

1. **Signing credentials are configured in GitHub.** Four generic KEYSTORE_* secret names are present. Their values are private and cannot be inspected. Preserve the existing keystore and password offline. The audit-branch APK build must still verify the final signature.
2. **Physical-device testing:** Moto Razr Ultra and tablet must validate actual NPU/GPU model loading, app lock, encrypted backup restore, project file sync, peer pairing, disconnect/reconnect, and same-device updates.
3. **Offline transports:** local Wi-Fi/hotspot peer sync exists; forming Wi-Fi Direct networks and Bluetooth fallback are not implemented. No background sync while Atlas is closed.
5. **Repository-wide lint:** the latest full lint audit reports **970 errors and 267 warnings** (1,237 issues). Many are pre-existing complexity/file-length/style violations and remain an explicit cleanup backlog. Passing TypeScript/Jest does not mean repository-wide lint is clean.
6. **Signature migration:** a new release-signing key may not install over a previously debug-signed Atlas APK. Preserve chats and verify backups before changing signing identities; device-bound PIN data may not export portably.
7. **No stable release or PR merge is authorized until CI and device gates are independently verified.**

## Signing locally

GitHub already lists all four signing secrets. The setup command `scripts\release\setup-atlas-signing.bat` is provided only for initial setup or recovery. Preserve the current signing key; do not generate a replacement unnecessarily.
