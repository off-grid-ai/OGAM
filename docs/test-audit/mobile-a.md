# Mobile tests without mocks of our code: half A

Ali: "i want proper non mockist tests", "Every test, all repos".

## The rule

A test runs our code for real and fakes only the device boundary.

- **May be faked (the device boundary):** native modules (llama.rn, whisper.rn, the video bridge,
  `NativeModules.*`), `react-native-fs` and the disk, `@react-native-async-storage/async-storage`, the
  network (a local fake server or `fetch`/`XMLHttpRequest` at the edge), the clock, RAM and other device
  readings.
- **May not be faked (ours):** anything under `src/` or `pro/`, a relative import, `@/…`, `@offgrid/…`,
  and `@react-navigation/native` (stubbing it fakes our routes, focus and `navigate`).
- **Seeding:** through the app's own write paths (store actions, services, what a previous launch saved
  to the fake disk), never by setting a store's state by hand.

## The guard

`__tests__/scripts/noMocksOfOurCode.test.ts` runs in PR CI with every Jest test. It fails when a test file
calls `jest.mock` / `jest.doMock` on our code, or `jest.spyOn` on an object imported from our code.
Files written before the rule are listed in `__tests__/mockBaseline.json` with their count. A listed
file may not gain a mock; a file that drops to zero must leave the list. So the list only shrinks.

After fixing a file: `UPDATE_MOCK_BASELINE=1 npx jest __tests__/scripts/noMocksOfOurCode`, and commit the
baseline change with the fix.

## The split

The baseline (368 files, 857 mocks at the split) is divided with no overlap:

- **Half A (this lane):** `docs/test-audit/mobile-a-files.txt`: `__tests__/integration/`,
  `__tests__/hardening/`, `__tests__/pro/`, `__tests__/App.test.tsx`, and the release files from the
  Android lane's audit list. 242 files, 418 mocks.
- **Half B (iOS lane):** `docs/test-audit/mobile-b-files.txt`: `__tests__/unit/` and `__tests__/rntl/`.
  126 files, 439 mocks.

## Real navigation

156 test files use `chatHarness`, which rendered each screen on its own and faked `useRoute` through a
shared `routeHolder`. `setupChatScreen({ navigation: 'real' })` instead mounts the app's own
`NavigationContainer` and `AppNavigator`:

- Onboarding is finished with the store action Onboarding calls, and the downloaded model is learned the
  way Home learns it, so the app opens on Home as a returning person's does.
- The model is picked on the real Home picker; New Chat opens the real Chat route.
- `openConversation` hands Chat new params on the same mounted screen; `newChatViaHome` leaves with the
  chat's own Back button and taps Home's New Chat; `openScreen(name)` opens one of the app's routes.

The test file calls `jest.unmock('@react-navigation/native')` and declares no navigation mock.

## Progress

| Batch | Files | Notes |
|---|---|---|
| 1 | 13 chat tests on real navigation | smart budgeting, image disk-full and out-of-memory cards, image intent routing, the memory refusals, enhance-prompt streaming, draw failure title, stop unanswered desktop, load params per device |
| 2 | useFastestSettings | Model Settings opened on its own route |

## Findings

- **Back does nothing after an MTP or OpenCL model load** (`kvSessionOnChatSwitch`, cases "MTP on" and
  "GPU (OpenCL)"). On real navigation, pressing the chat header's Back leaves the stack at
  `[Main, Chat]`; the button's handler never runs, while `goBack` on the container works and the same
  Back works in the file's other cases. Not yet explained; the file stays on its old stub until it is.
- **Still failing on real navigation, to explain:** `qwen3AsrTranscription`, `slowDesktopNoDeadline`,
  `chatDeleteImageFailure`, `desktopImageStopCancelsJob`, `queuedVideoIsItsOwnTurn`, `imageBackends`.
