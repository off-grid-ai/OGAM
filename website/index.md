---
layout: default
title: Home
nav_order: 1
description: Off Grid runs AI on your phone. The model loads into RAM, inference runs on your CPU and GPU, nothing leaves the device. Open source, no account, no cloud.
---

<img src="{{ '/assets/cover.png' | relative_url }}" alt="Off Grid - Private AI. No cloud. No compromise." class="hero-cover">

<div class="page-title-row">
  <img src="{{ '/assets/logo.png' | relative_url }}" alt="" width="40" height="40">
  <h1>Off Grid</h1>
</div>

**Your AI assistant. On your phone. Nowhere else.**

Chat, voice, vision, image generation, tools. The model runs in your phone's RAM. Inference happens on your CPU and GPU. Nothing is sent anywhere.

<div class="hero-buttons">
  <a href="https://apps.apple.com/us/app/off-grid-local-ai/id6759299882?utm_source=offgrid-docs&utm_medium=website&utm_campaign=download" target="_blank" rel="noopener" class="btn btn-green">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.029 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>
    App Store
  </a>
  <a href="https://play.google.com/store/apps/details?id=ai.offgridmobile&utm_source=offgrid-docs&utm_medium=website&utm_campaign=download" target="_blank" rel="noopener" class="btn btn-outline">
    <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256-256L47 0zm425.6 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c17.1-9.8 17.1-34.4-.1-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/></svg>
    Google Play
  </a>
  <a href="https://join.slack.com/t/off-grid-mobile/shared_invite/zt-3w2utgk0w-EDiDZBq6KmSZZwEw5Tkhnw" target="_blank" rel="noopener" class="btn btn-outline">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>
    Join Slack
  </a>
</div>

100K+ downloads. 4.3 stars on iOS. 2,458+ stars on [GitHub](https://github.com/alichherawalla/off-grid-mobile?utm_source=offgrid-docs&utm_medium=website&utm_campaign=github). Open source, built in public.

---

## What it does

| Capability | What actually happens |
|---|---|
| **Chat** | Quantized LLM loaded into RAM. 15-30 tok/s on flagship phones, 8-15 tok/s on mid-range. Works in airplane mode. |
| **Voice in** | Whisper transcribes audio on-device. Audio never leaves the phone. |
| **Voice out** | Kokoro TTS runs locally. The assistant speaks the reply back without a network call. |
| **Vision** | Point your camera at anything and ask a question. SmolVLM, Qwen3-VL, Gemma 3n. |
| **Image generation** | On-device Stable Diffusion. 5-10s on Snapdragon NPU. Core ML on iPhone. 20+ models in the library. |
| **Tools** | Web search, calculator, date, device info. The model decides when to call them. |
| **Documents** | Attach PDFs, CSVs, code files. Native text extraction on iOS and Android. |
| **MCP** | Connect any MCP server. The same protocol Claude Desktop uses, running through a model on your phone. |
| **Remote** | Point at Ollama, LM Studio, or LocalAI on your home network when you want a 70B model on your desktop. |

---

## The models that work right now

Pick the one that fits your phone and your task. Swap any time. No account.

| Model | Sizes for phones | Best for |
|---|---|---|
| **Gemma 4** (Google, Apr 2026) | E2B, E4B | Multimodal in one model - text, image, video, native audio. E4B is the sweet spot on a 2024+ phone. |
| **Qwen 3.5** (Alibaba, Feb 2026) | 0.8B, 2B, 4B, 9B | Strongest reasoning at this size. The 4B beats Qwen 3 8B from 2025. |
| **Phi-4 Mini** (Microsoft) | 3.8B | Tiny and sharp. Runs on a 4GB phone. |
| **DeepSeek R1 Distill** | 1.5B, 7B | Thinking model. Slower, shows its reasoning. |
| **Llama 3.2** (Meta) | 1B, 3B | The smallest end. Use when nothing else fits in memory. |
| **Ministral** (Mistral) | 3B, 8B | European weights, Apache-licensed. |

Bigger models from these families (Qwen 3.6 27B, Gemma 4 26B MoE / 31B dense) need a desktop. Point Off Grid at Ollama on your laptop and use them over your home network.

Any GGUF model works. Bring your own or pick from the in-app library.

---

## Why the cloud version isn't fine

Every query you send to ChatGPT is logged on a server you don't own. Your prompt, your account, the time, the response. Stored indefinitely. Used to train future models. Readable by employees. Subject to subpoena.

For most people, most of the time, that's fine. For anyone with something worth protecting - a draft of something private, a health question, a client file, a half-formed idea you wouldn't say out loud yet - it isn't.

With Off Grid the model lives in your phone's memory. Inference happens on your CPU and GPU. Nothing is sent anywhere. Verify it yourself: turn on airplane mode, ask it anything, watch it answer.

---

## Pro - alpha access

A version with voice, custom personas, and tool integrations - Slack, calendar, email, any MCP server. All on-device, same as the rest.

- **Voice** - Whisper in, Kokoro out. Hold to talk, listen to the reply. No audio leaves the device.
- **Personas** - Design assistants with your own prompts, voices, and memory. Switch contexts in a tap.
- **Integrations** - Read your inbox, draft a reply, schedule a meeting, file a Linear ticket. You approve every action that leaves the phone.
- **Direct line to the team** - Private channel with the people building it. File a bug, watch it get fixed.

A small group gets it before the public release. Round 2 alpha is **$30 one-time** (Round 1 sold out at the same price). Goes to **$50 one-time** at public launch. No subscription, no surprise pricing.

<div class="hero-buttons">
  <a href="{{ '/early-access' | relative_url }}" class="btn btn-green">Join the waitlist</a>
  <a href="https://off-grid-mobile.slack.com/archives/C0B4KMHNP61" target="_blank" rel="noopener" class="btn btn-outline">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>
    Join #pro-waitlist
  </a>
</div>

---

## Fair questions

**How does this actually work on a phone?**
Off Grid ships [llama.cpp](https://github.com/ggml-org/llama.cpp) inside the app. Quantized models (Q4_K_M is the usual balance) get memory-mapped into RAM and run on your CPU and GPU. iPhone 15 Pro runs a 4B model at around 20-25 tok/s. Snapdragon 8 Gen 3 is similar. Older devices run smaller models slower but still locally.

**Which model should I pick?**
If you have a 2023 or newer phone with 6GB+ RAM, start with Gemma 3 4B or Qwen 3 4B. If you have 4GB, use Phi-4 Mini or Llama 3.2 3B. Voice and vision work best with Gemma 3n.

**What if you don't ship Pro?**
Email us before the 12-week mark and you get a full refund. We've shipped the open-source core to 100K downloads already. Pro features are an extension, not a rewrite.

**Who's behind this?**
[Wednesday Solutions](https://www.wednesday.is?utm_source=offgrid-docs&utm_medium=referral), a product engineering studio. Built in public since early 2026. The code is on [GitHub](https://github.com/alichherawalla/off-grid-mobile?utm_source=offgrid-docs&utm_medium=website&utm_campaign=github) - read it before you pay.

**Will it work on my phone?**
iPhone 12 or newer with 4GB RAM runs the smaller models. iPhone 14 Pro or newer with 6GB+ runs 4B comfortably. Android: any flagship from 2022 onward, 6GB RAM, Snapdragon 8 Gen 1 or equivalent.

**Is the open-source app enough on its own?**
Yes. The base app does chat, vision, image generation, voice input, tool calling, documents, and remote servers. Pro adds voice output, personas, and integrations.

---

## Docs and guides

- [Quick Start - first model in 5 minutes]({{ '/quick-start' | relative_url }})
- [iOS Setup]({{ '/guides/ios-setup' | relative_url }})
- [Android Setup]({{ '/guides/android-setup' | relative_url }})
- [Which model should I use?]({{ '/guides/which-model' | relative_url }})

**LLMs**
- [How to Run LLMs Locally on Your Android Phone in 2026]({{ '/guides/run-llms-locally-android' | relative_url }})
- [How to Run LLMs Locally on Your iPhone in 2026]({{ '/guides/run-llms-locally-iphone' | relative_url }})

**Image Generation**
- [How to Run Stable Diffusion on Your Android Phone]({{ '/guides/stable-diffusion-android' | relative_url }})
- [How to Run Stable Diffusion on Your iPhone]({{ '/guides/stable-diffusion-iphone' | relative_url }})

**Vision, Voice and Documents**
- [Vision AI - Analyse Images and Documents On-Device]({{ '/guides/vision-ai' | relative_url }})
- [Voice Input - On-Device Speech-to-Text with Whisper]({{ '/guides/voice-stt' | relative_url }})
- [Document Analysis and Attachments]({{ '/guides/document-analysis' | relative_url }})
- [Knowledge Base and RAG]({{ '/guides/knowledge-base' | relative_url }})

**Tools and Intelligence**
- [Tool Calling - Web Search, Calculator, and More]({{ '/guides/tool-calling' | relative_url }})

**Remote Servers**
- [Remote Servers - Connect Ollama, LM Studio, and LocalAI]({{ '/guides/remote-servers' | relative_url }})
- [How to Use Ollama From Your Android Phone in 2026]({{ '/guides/ollama-android' | relative_url }})
- [How to Use LM Studio From Your Android Phone in 2026]({{ '/guides/lm-studio-android' | relative_url }})

---

Questions and feature requests: [Slack](https://join.slack.com/t/off-grid-mobile/shared_invite/zt-3w2utgk0w-EDiDZBq6KmSZZwEw5Tkhnw). Source code: [GitHub](https://github.com/alichherawalla/off-grid-mobile?utm_source=offgrid-docs&utm_medium=website&utm_campaign=github).

Here. It's yours. It runs on your phone and nowhere else.

Built by [Wednesday Solutions](https://www.wednesday.is?utm_source=offgrid-docs&utm_medium=referral).
