# Device checks queued while the phone is offline

The iPhone lost internet at 13:48, so iOS will not verify a new install. When it is online: install the latest build once, then capture each item in **light and dark** into `docs/play/r06-device-pass/`, before → after where an r00 shot exists.

| # | Screen / state | What should show | Commit |
|---|---|---|---|
| 1 | Home | Geist type; New Chat filled emerald (near-black text); Recent right after it, one grouped surface; Clipboard/Sync below | `311f8ace3`, `5fe3c9d02`, `d23a8f644` |
| 2 | New chat, empty | Header names the model; three starter prompts in one group (one bottom edge); privacy line | `ab63eadf1`, `c1172a7b4` |
| 3 | Chat, typing | Composer edge glows emerald while focused | composer glow |
| 4 | Chat, streaming → answer | Stop is a quiet raised control; answer on the surface; quiet user tile | `2890b6c47`, `4066db9e0` |
| 5 | Memory refusal (Gemma 4 E4B) | "Not enough memory: this model needs about … GB and … GB is free …"; stacked buttons, Choose another model filled | `a9845b11d`, `72db83a87` |
| 6 | Choose another model → pick Qwen 3.5 4B | Picker opens; the waiting message is sent after the pick and answered | `a76561cc1` |
| 7 | Chats tab | One grouped surface with hairlines; swipe-to-delete still works and its action stays inside the round corners | `e98c70816` |
| 8 | Projects tab | Same group look | `e98c70816` |
| 9 | Models › Text | More models grouped; badges read Sees images / Tools / Thinks; an incompatible row fades its text, not its surface | `527369877`, `d2622c852`, `372ea268e` |
| 10 | Settings › Search Model | Opens its own page; Back returns to Settings | `7f3ad0197` |
| 11 | Settings › Remote Servers | One grouped list; In use on the active server; Test/Edit/Remove icon buttons; switches: off reads off, disabled dims | `b97e1ff18`, `37085e27d`, `2890b6c47` |
| 12 | Settings › Storage, Device Information | Plain labels; "Flagship" on one line | `58f55446f`, `4a7818dfb` |
| 13 | Fresh install (delete app, reinstall) | Onboarding → first model → first answer; the first finished download becomes the chat model (not the classifier) | `8dd6aff94` |
