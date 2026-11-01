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

Every `chatHarness` test now runs on real navigation. `setupChatScreen({ navigation: 'real' })` mounts the
app's own `NavigationContainer` and `AppNavigator` in one root View, as App.tsx does:

- Onboarding is finished with the store action Onboarding calls, and the downloaded model is learned the
  way Home learns it, so the app opens on Home as a returning person's does.
- The model is picked on the real Home picker. The app then waits on Home; `render()` taps New Chat, so
  the chat mounts when the test opens it, after the test has set up the device (a denied mic, a stored chat).
- `openConversation` hands Chat new params on the same mounted screen; `newChatViaHome` leaves with the
  chat's own Back button and taps Home's New Chat; `openScreen(name)` opens one of the app's routes and
  `openTab(tab)` one of Home's tabs; `mountBeside(element)` mounts a test-only reader beside the app.
- `renderAside(element)` renders a settings section on its own, inside a real stack. RNTL fires events only
  into its current screen (the last render), so unmounting the section makes the app the screen again.
- `relaunchApp()` mounts the relaunched app on the Chats tab; tapping a row opens that chat.

A screen rendered on its own uses `harness/realNavigation`: `withNavigator(element, params)` puts it in a
real stack, and `withNavigatorRoutes` adds the screen it was opened from and the routes it can
go to, so a test reads where Back or a press really led instead of spying on `navigate` / `goBack`.

The test file calls `jest.unmock('@react-navigation/native')` and declares no navigation mock. The global
navigation stub in `jest.setup.ts` goes last, once no test leans on it.

## Progress

| Batch | Files | Notes |
|---|---|---|
| 1 | 13 chat tests on real navigation | smart budgeting, image disk-full and out-of-memory cards, image intent routing, the memory refusals, enhance-prompt streaming, draw failure title, stop unanswered desktop, load params per device |
| 2 | useFastestSettings | Model Settings opened on its own route |
| 3 | 22 chat tests | the chat opens when the test opens it; relaunch opens the real app on the Chats tab |
| 4 | 27 files | project, model, server and settings screens in a real stack; deleting a chat from every surface in the real app; the residency probe beside the app; Pro tools screens; the Voice row opens Models on the Voice tab |
| 5 | ProDetailScreen, GalleryScreen, DownloadManagerScreen, 6 TTS files, companionTaskRouting, runtimeDeactivation, App.test | half A at zero; App.test was in testPathIgnorePatterns and now runs |

## Status

The mobile mock baseline is `{}`. The guard holds one named, reviewed exception (EXCEPTIONS in
`__tests__/scripts/noMocksOfOurCode.test.ts`): the global `@react-navigation/native` stub in `jest.setup.ts`.
It is a third-party navigation library stubbed for screen-render tests; flows that depend on navigation use
the real-navigation harness.

## After-release follow-ups

1. **Remove the global navigation stub** in `jest.setup.ts` (about 197 render test files may rely on it).
   Render each of those screens in a real navigator (`withNavigator` / `withNavigatorRoutes`), then delete
   the stub and its guard exception.

## Findings

- **Explained, not a product bug:** presses that "did nothing" on real navigation (the chat's Back after an
  MTP or OpenCL load, and the files once listed here) were RNTL dropping events into a tree that was not
  its current screen, after the test rendered a section on its own. `renderAside` fixes it; all of those
  files now pass on real navigation.
- **Tests that were wrong about the app:** `stopDuringPromptEnhancement` tapped image mode once to turn it
  "off", but the composer resets Force to Auto after every send, so the tap turned Force on again. The old
  stub hid it because the tap was dropped. The test now checks the Auto state the send leaves.
- **Possible flake to watch:** `stopDuringPromptEnhancement` once saw the stop button still shown right
  after the enhancement card cleared (1 run in 5, under 2 parallel workers). Not reproduced since.
- **Fixed on -fixes, found by the real-code tests:**
  - A model whose files the disk refused to remove was dropped from the list anyway, and came back on the
    next launch. It now stays listed, and the Download Manager says "Couldn't remove the model files. Try
    again." with Retry.
  - Every speak turn passed residency's Load Anyway override, so the voice model skipped the memory budget.
    A speak turn is now budgeted (TTS is a sidecar beside the text model); only Load Anyway sets it aside.
  - Deleting the voice model during a voice switch left the previous voice's file on disk. Every voice's
    files are removed now.
