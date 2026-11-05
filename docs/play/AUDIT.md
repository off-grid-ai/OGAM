# OGAM screen audit — 2026-11-05

iPhone 17 Pro Max, dev app (`ai.offgridmobile.dev`), branch `feature/experience-redesign` from `origin/main`.
Judged against `oga-ux` (product bar) and `ui-library/docs/direction/DESIGN_PHILOSOPHY.md` (brand: calm, luminous, alive).
Screenshots: `docs/play/r00-audit/`.

Severity: **P0** breaks the core flow or trust · **P1** a new user is confused or the screen reads as unfinished · **P2** polish.

---

## 01 Boot — `01-launch.jpg`

- **Purpose:** show that the app is starting.
- **Works:** short; emerald dots.
- **Product bar:** fine.
- **Brand:** flat white page with three dots. No brand mark and no living background. The first moment carries none of "calm, luminous, alive". **P2**

## 02 Home — `02-first-screen.jpg`

- **Purpose:** start something now (chat, image, voice), or go back to recent work.
- **Works:** recent chats with previews; Gallery count; the tab bar is clear.
- **Product bar:**
  - The primary action (New Chat) is weak: an outlined box with green text, placed below an inventory card. It should be the brightest thing on the screen. **P1**
  - The Models card shows a count per modality (16 / 2 / 2 / 1 / 9). That is inventory, not an outcome; a new user cannot act on "16". **P1**
  - The Clipboard tile shows a raw item title ("OGAD: Mac (Debug)"), and Sync shows "0 connected – 5 saved Discoverable". That is system state, not a next step. **P1**
  - The "What should we build next?" feedback card takes a fifth of the home screen. **P2**
  - The header shows three loading dots with no label, so it is not clear what is loading. **P1**
- **Brand:**
  - Menlo everywhere: titles, previews, counts. The brand says Geist for reading text and mono only for labels and numbers. This is the biggest gap: the app reads as a terminal. **P1**
  - Recent items are separate bordered, shadowed boxes. The brand says one surface divided by hairlines (ListGroup/ListRow), not boxes. **P1**
  - Weights mix: "Image Gallery" is bold while the rest is light. **P2**
  - Flat page, no layered depth, no living background, no staggered entrance. **P1**
  - The tab bar uses the system sans, while the rest of the screen is mono. **P2**

## 03 Chats list — `03-chats.jpg`

- **Purpose:** find and reopen a conversation.
- **Works:** search at the top; New in the header; titles and previews.
- **Product bar:**
  - No grouping by date (Today / Yesterday / Earlier), so 1,240 chats are one flat wall. **P1**
  - Image and video chats show "Generated image for: …" and not a thumbnail. Media is the most scannable thing, and it is hidden. **P1**
  - A failed send leaves an empty "New Conversation" in the list (see 09). **P1**
- **Brand:** every row is a separate bordered, shadowed box (no ListGroup); all text is Menlo. **P1**

## 04 Projects — `04-projects.jpg`

- **Purpose:** group chats with shared instructions and files.
- **Works:** explainer line, search, count badges.
- **Product bar:** test projects fill the list ("Op", "Qq", "OPOPOP"). That is test data, not a product issue. The letter avatars ("G", "S", "C") add little. **P2**
- **Brand:** boxed rows, Menlo. **P1**

## 05 Models — `05-models.jpg`

- **Purpose:** get the right model for this phone.
- **Works:** "For this phone" with Fast / Balanced / Best picks and sizes is the right idea, and the downloaded check is clear.
- **Product bar:**
  - "More models" rows are tall cards with three unlabelled icon chips (eye, wrench, bolt). A new user cannot read those chips. **P1**
  - "0.8B params" is jargon. The picks row says it better ("Fast", "2.9 GB"). **P2**
- **Brand:** boxes in boxes (card → chip row → chips), Menlo. **P1**

## 06 Settings — `06-settings.jpg`

- **Purpose:** change how the app works.
- **Works:** this is already the right list pattern: one surface with hairline rows, icon, title and one muted description line. The Appearance segmented control is clear.
- **Brand:** Menlo only. **P1** This screen is the closest to the target, and it is the template for the others.

## 07–11 Chat (core flow) — `07-chat-new.jpg` … `11-chat-answer.jpg`

- **Purpose:** ask, and get a good answer quickly.
- **Works:** after send, the user bubble shows, "Loading <model>…" appears, Stop shows, and the answer streams with markdown.
- **Product bar:**
  - **P0 (environment, fixed):** the first send crashed (`isVideoRequest is not a function`). The message disappeared with no error, and an empty chat was left behind. Root cause: the local `shared` checkout was on `feature/scribe-notes`, which does not have `video-intent`, while mobile main expects shared main (CI builds against shared main). I moved shared to `feature/experience-redesign` from main and rebuilt it. **Real product gap that remains:** a send that throws gives the user no feedback and leaves an empty chat. The send path must catch the error, keep the message, and show "Couldn't send — Retry". **P0**
  - **Default model is SmolLM2-135M** on a 17 Pro Max where Qwen 3.5 0.8B/2B/4B are downloaded. The answer is poor ("Riverside, CA" for a mountain trip). The app should default to the best downloaded model that fits the device. **P0 for the experience**
  - The header shows "Models ▾" and not the model's name, so you cannot see what you are talking to. **P1**
  - The empty state has no starter prompts. "Type a message below" is all there is. **P1**
  - "Project: Default — tap to change" is in the middle of the empty state. That is noise for a first chat. **P2**
- **Brand:**
  - The user bubble is a solid emerald block. Emerald is the light source, used sparingly; a full block of it on every message is heavy. **P1**
  - Stop is a red circle. Red is only for errors and destructive actions; Stop should be a neutral or emerald control. **P1**
  - The assistant answer sits in a shadowed box. Mature chat apps (and the brand's "no boxes") put the answer as plain text on the surface. **P1**
  - No streaming motion: text appears, nothing settles. **P2**

## 12–13 Dark mode — `12-settings-dark.jpg`, `13-home-dark.jpg`

- Dark mode is the closer of the two to the brand: a near-black base, emerald accents, and quiet surfaces. The structural issues are the same as in light mode (boxes, Menlo, a weak primary action). It also shows the empty "New Conversation" that the failed send left behind.

## 15–21 Settings subpages (dark)

- **Model Settings** `15`: seven collapsed accordions with uppercase mono labels and "Use fastest settings" on top. It is clean, but every option is hidden two taps deep. **P2**
- **Search Model** `16`: the Settings row jumps to the **Models tab › Search**, so Back does not return to Settings. This breaks "every page is a route". **P1**
- **Remote Servers** `17`: a good explainer. But each server has a row of Test / Edit / Remove buttons under it (the brand says one trailing action, never a row of buttons under each item). Stale servers (192.168.1.x) show as "Not checked yet" and not as unreachable. **P1**
- **Sync** `18`: the tap stayed on Settings, so the page did not open. Needs a recheck. **P1**
- **Security** `19`: clear. **OK**
- **Device Information** `20`: "Flagship" breaks across two lines ("Flagshi / p") in the tier grid. **P2**
- **Storage** `21`: a dense, useful breakdown; red trash icons on every video-model row. **P2**
