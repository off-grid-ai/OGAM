# Off Grid -- Brand Voice & Tone

---

## In One Sentence

Off Grid sounds like someone who built this because they genuinely believe you deserve better -- handing you something for free, no strings, no data harvested, no angle. Here, take this. You're better off with it.

---

## The Core Disposition

Off Grid isn't a product trying to win a market. It's a thing built for the right reasons, handed over to people who deserve it.

The voice carries that. It doesn't sell. It gives. It doesn't ask you to trust it -- it shows you the mechanism and lets you verify. It doesn't talk about privacy as a feature -- it talks about it as something that was taken from you that you can have back.

Think: a friend who spent a year building something in their spare time because they were fed up with the alternative, and now they're just happy to share it. No pitch. No upsell. "Here, this is for you. It does what it says. Go use it."

That's the energy in every word Off Grid writes.

---

## Voice Attributes

### 1. Generous, not transactional

Off Grid asks nothing from you. No account. No API key. Your chats and files never leave your device; anonymous usage data and crash reports are sent only if you turn them on. The voice reflects this -- it gives without expecting anything back. It doesn't ask you to share, subscribe, follow, or review. It just hands you the thing.

This means copy never implies a trade. No "get access to," no "unlock," no implied paywall. The frame is always: here's what you have.

```
"Download it. Run it offline. That's it. No account, no API key, nothing we're holding back."
"Sign up to access the full model library."  [Wrong -- we don't do this]
```

### 2. Proof-first, not promise-first

Every claim has a fact behind it. Never say "fast" when you can say "15-30 tok/s on flagship devices." Never say "private" when you can say "the model runs in your phone's RAM, inference happens on your CPU and GPU, nothing is sent anywhere."

Specificity is how you earn trust without asking for it.

```
"Phi-3 Mini runs at ~28 tok/s on a Snapdragon 8 Gen 3. Llama 3.1 8B runs at ~12 tok/s on the same chip."
"On-device. Offline. Your chats never leave your phone. Not a marketing claim -- airplane mode works."
```

```
"Blazing fast AI right on your device."  [Vague, promotional, earns nothing]
```

### 3. Privacy as a right being returned, not a feature being sold

You've been using AI that logs everything. Your prompts. The time. Your account. Stored indefinitely, used to train models, subject to law enforcement requests. That data is yours and it's been taken.

Off Grid gives it back. The voice names this plainly, without drama. Not "we value your privacy" -- that's what every company that sells your data says. Instead: here's what actually happens when you use this, mechanically, in plain language. You can verify it yourself.

Don't moralize. Don't editorialize. State the fact and let it land.

```
"When you run a query on ChatGPT, it's logged on a server. Your prompt, the time, your account. With Off Grid, the model runs in your phone's memory. Your prompt is never sent anywhere."
```

```
"In a world where Big Tech is harvesting your data..."  [Preachy -- the user already knows]
"We take your privacy seriously."  [What every surveillance product says]
```

### 4. Respect the person reading

The Off Grid user chose this deliberately. They know what an LLM is. They've heard of Ollama. They opted out of the default. Don't explain concepts they already understand. Don't justify privacy as a value -- they already hold it.

Give them exactly what they need to act, nothing more.

```
"Tap Download. The GGUF lands in app storage. First load takes 5-15 seconds -- the model is being mapped into RAM."
```

```
"So what is a GGUF file? Great question! It's a quantized model format that allows..."  [Condescending, they don't need this]
```

### 5. Specific, not vague

No fuzzy qualifiers. If the answer depends on the device, name the device. If it depends on quantization, name the quantization. "It depends" is only acceptable followed immediately by the variables.

```
"Llama 3.1 8B Q4_K_M needs ~5.5GB RAM. iPhone 15 Pro has 8GB -- runs fine. iPhone 12 has 4GB -- use Phi-3 Mini instead."
```

```
"Performance may vary depending on your device and model choice."  [Useless, tells them nothing]
```

### 6. No angle, no ask

Off Grid has no ulterior motive and the voice reflects that. No dark patterns, no nudges toward premium, no FOMO. When something is free it's just free. When something doesn't work on a device, say so clearly instead of softening it to protect a conversion.

The reader should always feel like Off Grid is on their side, not managing them.

```
"Your phone has 4GB RAM. Llama 3.1 8B won't run well on it. Phi-3 Mini or Llama 3.2 3B will."
"For the best experience, consider upgrading to a device with more RAM."  [Wrong -- just tell them the truth]
```

---

## The Emotional Arc

Every piece of Off Grid content follows the same arc:

**Recognition -> Return -> Freedom**

1. **Recognition**: Name what's been happening. "Every query you've sent to a cloud AI has been logged, stored, and used."
2. **Return**: Show what's being given back. "With Off Grid, the model runs on your phone. Your chats never leave it."
3. **Freedom**: Hand them the capability without condition. "Go offline. It still works. It's yours."

This isn't about doubt and resolution like a pricing tool. It's about something that was taken being handed back. The tone is quiet, clear, and generous -- not triumphant or righteous.

---

## Tone Shifts

The voice stays constant. The tone shifts by context.

### Landing Page / Website
**Tone: Quiet generosity**

Short sentences. State what it does, then prove it. The reader should feel like they found something real -- not a product launch, a thing that actually works.

```
"Chat. Generate images. Use tools. See. Listen.
All on your phone. All offline. Your chats and files never leave your device.

No account. No API key. No subscription. Download and go."
```

### In-Product / UI Copy
**Tone: Terminal precision**

Minimal words. Labels are short and uppercase. Explanations appear on demand, never cluttering the primary view. The interface should feel like the answer is already there.

```
Label: "ACTIVE MODEL"
Value: "Llama 3.2 3B"
Detail: "12.4 tok/s -- Q4_K_M -- 2.1GB"
Status: "READY"
```

### Guides / Docs
**Tone: Direct handoff**

The reader has the app open. Get them to the thing. State requirements before steps. One action per step.

```
"Step 1 -- Download Off Grid
iOS: requires iPhone 12 or newer, 4GB RAM.
Android: requires Android 10+, 4GB RAM."
```

### Onboarding
**Tone: Here, take this**

First launch. One job: first inference. Don't introduce features -- show one path, make it obvious.

```
"Pick a model. Download it. Load it. Type something.
That's all there is."
```

### Error States / Empty States
**Tone: Honest and useful**

Say what happened. Say what to do. Never blame the user. Never be vague.

```
"Not enough free RAM to load this model (~5.5GB needed). Close background apps and try again -- or switch to Phi-3 Mini at 2GB."
"Error loading model. Please try again."  [Useless]

"No models downloaded yet. Phi-3 Mini is a good start -- 2GB, runs on any modern phone, no account needed."
"No models found."  [Incomplete]
```

---

## Language Rules

### Always
- Use "you/your" -- the user has this, it belongs to them
- State device requirements before recommending a model
- Use present tense ("the model runs in RAM") not future ("the model will run")
- File sizes always with units: 2.1GB, not "2.1"
- Speeds always with units: 12 tok/s

### Never
- Exclamation marks in product copy
- "Unlock," "supercharge," "game-changing," "revolutionary," "next-generation," "cutting-edge"
- Implying anything is held back or gated
- Privacy framed as a selling point -- frame it as a mechanism or a right
- Em dashes or double hyphens -- single hyphens only
- Curly quotes or special unicode characters
- "Genuinely," "honestly," "straightforward"
- Only use characters available on a standard keyboard

### Never (AI slop - flags as machine-generated)
Single words to cut on sight:
- "delve" / "delves into"
- "crucial" / "pivotal" / "vital"
- "meticulous" / "intricate"
- "tapestry" / "testament" / "landscape"
- "underscore" / "underscores"
- "bolstered" / "garnered"
- "enduring" / "vibrant" / "rich" (as vague intensifiers)
- "align with" / "resonate with"
- "foster" / "cultivate"
- "showcase" / "highlight" (as verbs in prose)
- "enhance" / "enhancing"
- "leverage" (use "use")
- "robust" (use a specific number instead)
- "comprehensive" (say what it actually covers)
- "valuable insights" (say what the insight is)
- "dive in" / "let's explore" / "in this guide we'll"
- "seamlessly"
- "empower" / "empowers"

Structural habits to kill:
- Rule of three -- two items or four, never exactly three adjectives in a row
- "Not just X, but Y" constructions
- "It's not X, it's Y" constructions
- Throat-clearing openers ("Great question," "Absolutely," "Certainly")
- Conclusion summaries that restate what was just said
- Bolding random phrases mid-paragraph for "emphasis"
- Every section getting a bold header when prose would do
- Lists of exactly three bullet points as a default

Phrases that read as AI-generated:
- "serves as" (say "is")
- "stands as" (say "is")
- "represents a" (say "is")
- "marks a turning point"
- "is a testament to"
- "plays a crucial/pivotal/vital role"
- "it is worth noting that"
- "it goes without saying"
- "at the end of the day"
- "in today's landscape"
- "in the ever-evolving"
- "moving forward" / "going forward"

---

## Technical Terminology

Use precise names. Not marketing language.

| Term | How Off Grid uses it |
|---|---|
| GGUF | "The model format -- download and load directly" |
| Quantization | "Q4_K_M is the balance point: smaller file, minimal quality loss" |
| Tokens per second | "28 tok/s -- the speed you'll feel in conversation" |
| NPU / Neural Engine | "Hardware-accelerated inference -- faster and cooler than CPU-only" |
| Core ML | "iOS model format -- needed for NPU acceleration on iPhone" |
| Ollama / LM Studio | "Run bigger models from your desktop, over LAN" |
| Q-levels | "Q2_K: smallest, most degraded. Q8_0: near-lossless, largest." |

Name models precisely. Include size and quantization when recommending.

```
"Llama 3.2 3B Q4_K_M -- ~2GB, 18 tok/s on iPhone 15 Pro"
"Phi-4 Mini -- runs on any modern phone, 4GB RAM minimum"
"Stable Diffusion 1.5 -- on-device image gen, 5-10s on Snapdragon NPU"
```

---

## Content Structure

### The Off Grid Guide Format

**1. One sentence on what this gets you**
What the user can do when they're done.

**2. Requirements upfront**
Device, OS version, RAM, storage. Before any steps, not buried at the end.

**3. Numbered steps, one action each**
Don't combine download + load into one step. One action per line.

**4. What success looks like**
Tell them exactly what they'll see. "You'll see READY under the model name."

**5. One or two next steps** (optional)
Not a feature tour -- just the obvious next thing.

### Example Headlines

```
"Run your first local AI model in 5 minutes"
"Which model should you use? Here's how to decide."
"Stable Diffusion on Android -- on-device image generation, no cloud."
"Llama 3.1 8B vs Phi-4 Mini -- when to use which."
"How to connect Off Grid to your Ollama server at home."
"iPhone 15 Pro vs iPhone 12 -- what on-device AI actually looks like."
```

### Headlines That Would Be Wrong

```
"Unlock the power of private AI"  [implies something held back]
"Why Off Grid is the best AI app in 2026"  [no proof, wrong energy]
"10 reasons to switch from ChatGPT"  [listicle, promotional]
"The Ultimate Guide to On-Device AI"  [generic filler]
"AI has never been this private"  [unverifiable]
```

---

## Microcopy Patterns

### Buttons
```
Primary: "Download"
Secondary: "Load Model"
Tertiary: "View Details"
Destructive: "Delete"
```

### Model States
```
Not downloaded: "2.1GB -- tap to download"
Downloading: "Downloading... 847MB / 2.1GB"
Downloaded, not loaded: "READY TO LOAD"
Loaded: "ACTIVE -- 12.4 tok/s"
Loading: "Loading into RAM..."
```

### Reassurance Lines
```
"No account. No API key. No internet after setup."
"Works in airplane mode."
"Nothing you type leaves your phone."
```

### Empty States
```
No models: "Nothing downloaded yet. Phi-3 Mini is 2GB and runs on any modern phone -- good place to start."
No conversations: "No conversations yet. Load a model and start one."
No search results: "Nothing matches that filter. Try broadening it."
```

### Error States
```
Insufficient RAM: "Not enough free RAM (~5.5GB needed). Close background apps, or try a smaller model -- Phi-3 Mini runs in 2GB."
Download failed: "Download interrupted. Check your connection and try again."
Load failed: "Load failed -- the file may be corrupted. Delete it and re-download."
```

### Success States
```
"ACTIVE -- 12.4 tok/s"
"Download complete. Tap Load."
"Generated in 6.2s"
```

---

## Brand Taglines

Primary: **"Private AI. No cloud. No compromise."**

Alternatives:
- "Run AI on your phone. Your chats never leave it."
- "The Swiss Army Knife of On-Device AI."
- "AI that stays on your device."
- "No cloud. No account. No compromise."
- "Yours. Offline. Always."

---

## Quality Checklist

Before publishing any Off Grid content:

- [ ] Does it feel like something being given, not sold?
- [ ] Are privacy claims stated as mechanisms ("the model runs in RAM"), not promises ("we value your privacy")?
- [ ] Do privacy claims name what they cover? Say "your chats and files never leave your device", never "nothing leaves" or "no telemetry". Marketing never mentions analytics.
- [ ] Does every performance claim include a number and a device?
- [ ] Are device requirements stated before steps?
- [ ] Does it follow the recognition -> return -> freedom arc?
- [ ] Is every "it depends" followed immediately by what it depends on?
- [ ] Can the reader do the thing without googling anything?
- [ ] Does it sound like someone who built this because they wanted to, not to sell it?
- [ ] Are there zero exclamation marks in product copy?
- [ ] Does every sentence pass the "would a human actually write this" test?
- [ ] Are there zero instances of: delve, crucial, pivotal, tapestry, testament, underscore, bolstered, garnered, meticulous, vibrant, landscape, foster, cultivate, leverage, robust, comprehensive, seamlessly, empower?
- [ ] Are there zero "not just X but Y" constructions?
- [ ] Are there zero "serves as" / "stands as" / "represents a" substitutions for "is"?
- [ ] Does it avoid restating the conclusion at the end?
- [ ] Is nothing implied to be locked, premium, or held back?

---

*"Here. It's yours. It runs on your phone and nowhere else."*
