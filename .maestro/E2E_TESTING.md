# E2E Testing with Maestro

This directory contains end-to-end tests using [Maestro](https://maestro.mobile.dev/).

## Prerequisites

1. **Install Maestro CLI**
   ```bash
   curl -Ls "https://get.maestro.mobile.dev" | bash
   ```

2. **Android Setup**
   - Android device connected via USB with USB debugging enabled
   - OR Android emulator running
   - Verify with: `adb devices`

3. **iOS Setup** (macOS only)
   - iOS simulator running
   - OR physical device with developer mode enabled

4. **App Installed**
   - Build and install the app on your device:
     ```bash
     # Android
     npm run android

     # iOS
     npm run ios
     ```

## Running Tests

### Run All P0 Tests
```bash
maestro test .maestro/flows/p0/
```

### Run Single Test
```bash
maestro test .maestro/flows/p0/02-text-generation.yaml
```

### Run with Specific Device
```bash
# List devices
adb devices  # Android
xcrun simctl list devices  # iOS

# Run on specific device
maestro test --device <deviceId> .maestro/flows/p0/
```

### Run in CI Mode (no UI, headless)
```bash
maestro test --format junit .maestro/flows/p0/
```

## Test Structure

```
.maestro/
├── config.yaml           # Global configuration
├── E2E_TESTING.md        # This file
├── flows/
│   ├── p0/               # Critical path tests (run always)
│   │   ├── 01-app-launch.yaml
│   │   ├── 02-text-generation.yaml
│   │   ├── 03-stop-generation.yaml
│   │   ├── 04-model-loading.yaml
│   │   ├── 05-model-download.yaml
│   │   ├── 06-conversation-management.yaml
│   │   ├── 07-image-generation.yaml
│   │   └── 08-app-lifecycle.yaml
│   └── p1/               # Important tests (run on release)
└── utils/                # Reusable flow utilities
    └── wait-for-app-ready.yaml
```

## Test Priorities

- **P0 (Critical)**: App is unusable if broken. Run on every PR.
- **P1 (Important)**: Users notice if broken. Run on release builds.
- **P2 (Nice-to-have)**: Edge cases. Run weekly.

## Test IDs

These tests rely on `testID` props being set on React Native components.
Required test IDs:

### Core Navigation
- `home-screen`
- `chat-screen`
- `models-screen`
- `tab-bar`
- `new-chat-button`
- `models-tab`

### Chat Screen
- `chat-input`
- `send-button`
- `stop-button`
- `thinking-indicator`
- `streaming-message`
- `assistant-message`
- `model-selector`
- `model-loaded-indicator`

### Model Management
- `model-list`
- `model-item-{index}`
- `model-loading-indicator`
- `unload-model-button`
- `download-button`
- `download-progress`
- `download-complete`

### Conversation Management
- `conversation-list-button`
- `conversation-list`
- `conversation-item-{index}`

### Image Generation
- `image-model-loaded-indicator`
- `image-mode-toggle`
- `image-generation-progress`
- `generated-image-<index>` (e.g. `generated-image-0`; index-scoped per attachment)
- `image-message`
- `image-viewer`

## Writing New Tests

### Basic Structure
```yaml
appId: ai.offgridmobile
name: "Test Name"
tags:
  - p0
  - category
---

# Test steps
- launchApp
- assertVisible:
    id: "some-test-id"
- tapOn:
    id: "button-id"
```

### Common Patterns

**Wait for element**
```yaml
- assertVisible:
    id: "element-id"
    timeout: 10000
```

**Input text**
```yaml
- tapOn:
    id: "input-field"
- inputText: "Hello world"
```

**Conditional (optional) steps**
```yaml
- tapOn:
    id: "might-not-exist"
    optional: true
```

**Delays (use sparingly)**
```yaml
- delay: 2000
```

## Debugging

### Interactive Mode
```bash
maestro studio
```
Opens Maestro Studio for interactive test writing.

### View Logs
```bash
maestro test --debug .maestro/flows/p0/02-text-generation.yaml
```

### Screenshots
Screenshots are automatically saved on failure. Find them in:
```
~/.maestro/tests/<timestamp>/
```

## CI Integration

### GitHub Actions Example
```yaml
- name: Run E2E Tests
  run: |
    maestro test --format junit --output test-results.xml .maestro/flows/p0/

- name: Upload Results
  uses: actions/upload-artifact@v3
  with:
    name: e2e-results
    path: test-results.xml
```

## Required TestIDs to Add

The following testIDs need to be added to screen components for E2E tests to work:

### High Priority (P0 tests depend on these)

**HomeScreen.tsx**
```tsx
<View testID="home-screen">
<TouchableOpacity testID="new-chat-button">
```

**ChatScreen.tsx**
```tsx
<View testID="chat-screen">
<TouchableOpacity testID="model-selector">
<View testID="model-loaded-indicator">  // When model is loaded
<View testID="model-loading-indicator">  // During model load
<TouchableOpacity testID="conversation-list-button">
<View testID="assistant-message">  // On assistant message bubbles
<View testID="image-generation-progress">  // During image gen
<View testID="generated-image-0">  // On generated images (index-scoped: -0, -1, ...)
```

**ModelsScreen.tsx**
```tsx
<View testID="models-screen">
<TextInput testID="search-input">
<FlatList testID="models-list">
<TouchableOpacity testID="model-card-{index}">
<TouchableOpacity testID="download-button">
<View testID="download-progress">
<View testID="download-complete">
<TouchableOpacity testID="downloaded-tab">
```

**Navigation**
```tsx
<View testID="tab-bar">
<TouchableOpacity testID="models-tab">
```

**ConversationList (drawer or modal)**
```tsx
<View testID="conversation-list">
<TouchableOpacity testID="conversation-item-{index}">
```

### Existing TestIDs (Already in Place)

- `chat-input` - ChatInput component
- `send-button` - Send message button
- `stop-button` - Stop generation button
- `camera-button` - Camera/attachment button
- `image-mode-toggle` - Image generation toggle
- `thinking-indicator` - ThinkingIndicator component
- `streaming-cursor` - Cursor during streaming
- `message-text` - Message content
- `action-menu` - Message action menu

## Troubleshooting

### "No devices found"
- Ensure device/emulator is running
- Check `adb devices` output
- Restart ADB: `adb kill-server && adb start-server`

### "Element not found"
- Verify testID is set on the component
- Check spelling and case sensitivity
- Increase timeout value
- Use Maestro Studio to inspect element hierarchy

### "Timeout waiting for element"
- App might be slow on first launch
- Model loading takes time
- Increase timeout or add explicit delay
