<div align="center">

<img src="src/assets/logo.png" alt="Off Grid AI Logo" width="120" />

# Off Grid AI

### The Swiss Army Knife of On-Device AI

**Chat. Generate images. Use tools. See. Listen. All on your phone or Mac. All offline. Zero data leaves your device.**

[![GitHub stars](https://img.shields.io/github/stars/alichherawalla/off-grid-mobile?style=social)](https://github.com/alichherawalla/off-grid-mobile)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Google Play](https://img.shields.io/badge/Google%20Play-Download-brightgreen?logo=google-play)](https://play.google.com/store/apps/details?id=ai.offgridmobile)
[![App Store](https://img.shields.io/badge/App%20Store-Download-blue?logo=apple)](https://apps.apple.com/us/app/off-grid-local-ai/id6759299882)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20iOS%20%7C%20macOS-green.svg)](#install)
[![codecov](https://codecov.io/gh/alichherawalla/off-grid-mobile/graph/badge.svg)](https://codecov.io/gh/alichherawalla/off-grid-mobile)
[![Slack](https://img.shields.io/badge/Slack-Join%20Community-4A154B?logo=slack)](https://join.slack.com/t/off-grid-mobile/shared_invite/zt-411pbtz7r-lcOK4YCeY40vh_~FUdcvLA)
[![Pro](https://img.shields.io/badge/Off%20Grid%20Pro-%2469%20lifetime%20and%20%2449%20annual-000000?style=flat)](https://offgridmobileai.co/pay/)

</div>

---

<div align="center">

<sub><b>BUILT BY</b></sub>

<a href="https://wednesday.is/?utm_source=github&utm_medium=offgrid-readme&utm_content=logo"><picture><source media="(prefers-color-scheme: dark)" srcset="src/assets/wednesday-logo-dark.svg" /><img src="src/assets/wednesday-logo.svg" alt="Wednesday Solutions" height="160" /></picture></a>

</div>

---

<br />

<div align="center">

## Off Grid AI Pro

**A voice, personas, and actions. $69 for life, or $49/year.**

</div>

<br />

Pro is an optional, additive tier. It gives the assistant a voice that talks back, personas you shape, and the tools to draft real actions you approve. One license covers your phone and your Mac. All on-device.

### What Pro adds

- **Voice mode** - the free app transcribes your speech; Pro adds on-device Kokoro text-to-speech, so it talks back and you run the whole thing hands-free. The voice runs in your phone's RAM.
- **Custom personas** - give each assistant its own system prompt, voice, and persistent memory, so it stays in character across conversations.
- **Draft, then approve** - connect Calendar, email, and MCP servers like Linear, Notion, and GitHub. It drafts the reply or files the ticket and waits. Nothing sends without your tap.
- **Sync, landing through July** - your phone and your Mac merge into one picture over your own network, never a relay. Your license includes it the day it ships.

**[→ Get Pro access](https://offgridmobileai.co/pay/)** - $69 once and it is yours forever (the price climbs as more people join, never down), or $49/year.

Pair it with **[Off Grid AI Desktop](https://github.com/off-grid-ai/desktop/releases/latest)** on your Mac. One Pro license covers both.

---

## Not just another chat app

Most "local LLM" apps give you a text chatbot and call it a day. Off Grid AI is a **complete offline AI suite** — text generation, image generation, vision AI, voice transcription, tool calling, and document analysis, all running natively on your phone's or Mac's hardware.

---

## What can it do?

<div align="center">
<table>
  <tr>
    <td align="center"><img src="demo-gifs/onboarding.gif" width="200" /><br /><b>Onboarding</b></td>
    <td align="center"><img src="demo-gifs/text-gen.gif" width="200" /><br /><b>Text Generation</b></td>
    <td align="center"><img src="demo-gifs/image-gen.gif" width="200" /><br /><b>Image Generation</b></td>
  </tr>
  <tr>
    <td align="center"><img src="demo-gifs/vision.gif" width="200" /><br /><b>Vision AI</b></td>
    <td align="center"><img src="demo-gifs/attachments.gif" width="200" /><br /><b>Attachments</b></td>
    <td align="center"><img src="demo-gifs/tool-calling.gif" width="200" /><br /><b>Tool Calling</b></td>
</tr>
</table>
</div>

**Text Generation** — Run Qwen 3, Llama 3.2, Gemma 3, Phi-4, and any GGUF model. Streaming responses, thinking mode, markdown rendering, 15-30 tok/s on flagship devices. Bring your own `.gguf` files too.

**Remote LLM Servers** — Connect to any OpenAI-compatible server on your local network (Ollama, LM Studio, LocalAI). Discover models automatically, stream responses via SSE, store API keys securely in the system keychain. Switch seamlessly between local and remote models.

**Tool Calling** — Models that support function calling can use built-in tools: web search, calculator, date/time, device info, and knowledge base search. Automatic tool loop with runaway prevention. Clickable links in search results.

**Project Knowledge Base** — Upload PDFs and text documents to a project's knowledge base. Documents are chunked, embedded on-device with a bundled MiniLM model, and retrieved via cosine similarity — all stored locally in SQLite. The `search_knowledge_base` tool is automatically available in project conversations.

**Image Generation** — On-device Stable Diffusion with real-time preview. NPU-accelerated on Snapdragon (5-10s per image), Core ML on iOS. 20+ models including Absolute Reality, DreamShaper, Anything V5.

**Vision AI** — Point your camera at anything and ask questions. SmolVLM, Qwen3-VL, Gemma 3n — analyze documents, describe scenes, read receipts. ~7s on flagship devices.

**Voice Input** — On-device Whisper speech-to-text. Hold to record, auto-transcribe. No audio ever leaves your phone.

**Document Analysis** — Attach PDFs, code files, CSVs, and more to your conversations. Native PDF text extraction on both platforms.

**AI Prompt Enhancement** — Simple prompt in, detailed Stable Diffusion prompt out. Your text model automatically enhances image generation prompts.

---

## Performance

| Task | Flagship | Mid-range |
|------|----------|-----------|
| Text generation | 15-30 tok/s | 5-15 tok/s |
| Image gen (NPU) | 5-10s | — |
| Image gen (CPU) | ~15s | ~30s |
| Vision inference | ~7s | ~15s |
| Voice transcription | Real-time | Real-time |

Tested on Snapdragon 8 Gen 2/3, Apple A17 Pro. Results vary by model size and quantization.

---

<a name="install"></a>
## Install

<div align="center">
<table><tr>
<td align="center"><a href="https://apps.apple.com/us/app/off-grid-local-ai/id6759299882"><img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="Download on the App Store" width="180" /></a></td>
<td align="center"><a href="https://play.google.com/store/apps/details?id=ai.offgridmobile"><img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" alt="Get it on Google Play" width="220" /></a></td>
</tr></table>
</div>

Or grab the latest APK from [**GitHub Releases**](https://github.com/alichherawalla/off-grid-mobile/releases/latest).

> **macOS**: The iOS App Store version runs natively on Apple Silicon Macs via Mac Catalyst / iPad compatibility.

### Build from source

```bash
git clone https://github.com/alichherawalla/off-grid-mobile.git
cd off-grid-mobile
npm install

# Android
cd android && ./gradlew clean && cd ..
npm run android

# iOS
cd ios && pod install && cd ..
npm run ios
```

> Requires Node.js 20+, JDK 17 / Android SDK 36 (Android), Xcode 15+ (iOS). See [full build guide](docs/ARCHITECTURE.md#building-from-source).

---

## Testing

[![CI](https://github.com/alichherawalla/off-grid-mobile/actions/workflows/ci.yml/badge.svg)](https://github.com/alichherawalla/off-grid-mobile/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/alichherawalla/off-grid-mobile/graph/badge.svg)](https://codecov.io/gh/alichherawalla/off-grid-mobile)

For deterministic physical Android and iOS runs with UIAutomator and XCTest/WebDriverAgent, see
[Physical-device UI automation](docs/E2E_DEVICE_AUTOMATION.md).

Tests run across three platforms on every PR:

| Platform | Framework | What's covered |
|----------|-----------|----------------|
| React Native | Jest + RNTL | Stores, services, components, screens, contracts |
| Android | JUnit | LocalDream, DownloadManager, BroadcastReceiver |
| iOS | XCTest | PDFExtractor, CoreMLDiffusion, DownloadManager |

```bash
npm test              # Run all tests (Jest + Android + iOS)
```

This project is tested with BrowserStack.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture & Technical Reference](docs/ARCHITECTURE.md) | System architecture, design patterns, native modules, performance tuning |
| [Codebase Guide](docs/standards/CODEBASE_GUIDE.md) | Comprehensive code walkthrough |
| [Design System](docs/design/DESIGN_PHILOSOPHY_SYSTEM.md) | Brutalist design philosophy, theme system, tokens |
| [Visual Hierarchy Standard](docs/design/VISUAL_HIERARCHY_STANDARD.md) | Visual hierarchy and layout standards |

---

## Community

Join the conversation on [**Slack**](https://join.slack.com/t/off-grid-mobile/shared_invite/zt-411pbtz7r-lcOK4YCeY40vh_~FUdcvLA) — ask questions, share feedback, and connect with other Off Grid AI users and contributors.

---

## Contributing

Contributions welcome! Fork, branch, PR. See [development guidelines](docs/ARCHITECTURE.md#contributing) for code style and the [codebase guide](docs/standards/CODEBASE_GUIDE.md) for patterns.

---

## Acknowledgments

Built on the shoulders of giants:
[llama.cpp](https://github.com/ggerganov/llama.cpp) | [whisper.cpp](https://github.com/ggerganov/whisper.cpp) | [llama.rn](https://github.com/mybigday/llama.rn) | [whisper.rn](https://github.com/mybigday/whisper.rn) | [local-dream](https://github.com/xororz/local-dream) | [ml-stable-diffusion](https://github.com/apple/ml-stable-diffusion) | [MNN](https://github.com/alibaba/MNN) | [Hugging Face](https://huggingface.co)

---

## Star History

<a href="https://www.star-history.com/?repos=off-grid-ai%2FOGAM&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=off-grid-ai/OGAM&type=date&theme=dark&legend=top-left&sealed_token=d1NvdHkxMRYA5HzG4HHcLDnnNhj976V0-Ofw_LKDg38CF9bluDsbRYsDxM8LEom7XSb5CbN9VHh8vpKJOkzOvDYZF1agMvBHd_p7GV7nRGWXsQ0G01GIAQ" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=off-grid-ai/OGAM&type=date&legend=top-left&sealed_token=d1NvdHkxMRYA5HzG4HHcLDnnNhj976V0-Ofw_LKDg38CF9bluDsbRYsDxM8LEom7XSb5CbN9VHh8vpKJOkzOvDYZF1agMvBHd_p7GV7nRGWXsQ0G01GIAQ" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=off-grid-ai/OGAM&type=date&legend=top-left&sealed_token=d1NvdHkxMRYA5HzG4HHcLDnnNhj976V0-Ofw_LKDg38CF9bluDsbRYsDxM8LEom7XSb5CbN9VHh8vpKJOkzOvDYZF1agMvBHd_p7GV7nRGWXsQ0G01GIAQ" />
 </picture>
</a>

<div align="center">

**Off Grid AI** — Your AI, your device, your data.

*No cloud. No data harvesting. Just AI that works anywhere.*

[Join the Community on Slack](https://join.slack.com/t/off-grid-mobile/shared_invite/zt-411pbtz7r-lcOK4YCeY40vh_~FUdcvLA)

</div>
