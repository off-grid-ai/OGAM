One design, three capability tiers. It never fakes intelligence it doesn't have.
Two separate on-device models, each optional and each user-controlled: Whisper (speech → text, user-triggered) and an LLM (text → understanding, may not even be downloaded). So the honest default is 122 raw clips, zero processed. The one structure that costs no model at all is the calendar (a device API) plus wall-clock time — so that's the backbone in every tier. Everything smart (titles, summaries, folding, highlights, actions, Ask) only appears once the model that produces it is present. When it isn't, the UI shows less — it never bluffs.

Jump to:
Grouping resolved
·
Full flow & mixed states
·
Capability model
·
State A — Unprocessed (default)
·
State B — Processed
v4
The grouping, resolved — one timeline, never competing sections
You're right that Morning / Afternoon / Evening as top-level sections is the bug — it's a second grouping axis fighting the calendar. So we drop it. The day becomes one chronological spine with only two card types: a Meeting (named by the calendar) and a Gap (the unscheduled stretch between meetings). Meetings and gaps are adjacent, non-overlapping slices of the same line — so a clip can only ever be in one. "Late morning" survives only as a descriptive label on a gap, not a bucket. Plus your three asks: Transcribe All, a calendar day-navigator, and playable cardsa
![alt text](image-1.png)
![alt text](image-2.png)
![alt text](image-3.png)
![alt text](image-4.png)


