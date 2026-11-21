# Onboarding feature map (X → Y)

Source: code inventory of desktop (+ desktop-pro), mobile (+ pro) and browser-extension, 2026-11-17.
Model kinds come from `@offgrid/features` (`shared/packages/features/src/features.json`).

Flow: pick X (groups) → pick Y (features inside) → "Show me how it works" → guide page for the picks → model setup for the model kinds the picks need.

| X (group) | Y (feature) | Desktop | Mobile | Browser | Free/Pro | Needs models |
|---|---|---|---|---|---|---|
| **Chat and ask** | Chat | yes | yes | side panel | Free | text |
| | Ask your documents (Projects / knowledge base) | yes | yes | — | Free | text, embedding |
| | Ask about a photo or screenshot | yes | yes | yes | Free | vision |
| | Web search and tools | yes | yes | agent mode | Free | text (tool-capable) |
| | Voice mode (talk, it answers aloud) | yes | yes | read aloud | Free desktop / Pro mobile | stt, tts |
| | Ask about this page | — | — | yes | Pro | text |
| **Create** | Images | yes | yes | yes | Free | image |
| | Video and films (Video Studio) | yes | yes (11 GB+ or via computer) | — | Pro | video, tts |
| | Animate a photo | — | yes | — | Pro | video |
| **Write** | Scribe (fix and rewrite in any app) | yes | yes (Improve) | yes (any text box) | Pro | text |
| | Dictation into any app | yes | yes (in app) | yes | Pro desktop / Free mobile | stt |
| | Notes | yes | yes | — | Pro | text |
| **Remember** | Replay and Search (rewind what you saw) | yes | — | — | Pro | vision, embedding |
| | Day and Reflect (your day, your time) | yes | — | — | Pro | text |
| | Clipboard history | yes | under Private and connected (rides Sync) | — | Pro | — |
| **Meetings and people** | Meetings (record, transcribe, summary) | yes | — | — | Pro | stt, text |
| | People and projects (Entities) | yes | — | — | Pro | text |
| **Get work done** | Assistant (God) | yes | — | — | Pro | text, stt |
| | Web Use and Computer Use | yes | yes (via computer) | yes (runs tasks) | Free (for now) | text, vision |
| | Integrations (Gmail, Calendar, Notion, Linear, MCP) | yes | yes (MCP, email, calendar) | — | Free desktop / Pro mobile | text (tool-capable) |
| | To-dos and approvals (Actions) | yes | — | — | Pro | text |
| **Private and connected** | Vault (passwords, autofill) | yes | yes | yes (autofill) | Pro | — |
| | Sync your devices | yes | yes | pair | Pro | — |
| | Use your computer's or own server's models | Gateway / remote server | Remote servers | remote desktop | Free | — |
| | Bigger models (Boost) | promo | promo | — | separate | — |

## Facts that change the build

- The desktop guide covers only 21 of about 70 desktop features. Mobile has a guide (`GuideScreen`, its own `guideTopics.ts`). Both read `shared/packages/models/src/product-guide.ts` for the Ask answers. Every Y needs a guide entry before step 3 works.
- `@offgrid/features` already has 16 features with model kinds. It is the right single source for X, Y, guide copy and model setup; it needs the missing Ys and a group field that matches X.
- The browser extension needs Pro and a paired desktop, and is not in any store yet. It appears only as "also in your browser" on desktop Ys.
- Web Use / Computer Use is Free for now (decided 2026-11-17). `proCatalog` lists Tasks as Pro and the desktop guide's extension topic says tasks need Pro; both copies disagree with this.
