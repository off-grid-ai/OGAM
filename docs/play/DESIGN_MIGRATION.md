# Mobile design migration: decision — 2026-11-05

## Recommendation: yes, now, at the shared source

Desktop and the ui-library moved to "calm, luminous, alive" (`ui-library/docs/direction/DESIGN_PHILOSOPHY.md`). Mobile still ships the earlier "brutalist terminal" look (`docs/design/DESIGN_PHILOSOPHY_SYSTEM.md`). The audit (`AUDIT.md`) shows the same four gaps on almost every screen. Each gap has one shared source, so the migration is a small number of changes, not a rewrite of 28 screens.

Now is the right time because:
- The pieces exist: `TYPOGRAPHY`/`FONTS` tokens (every text style uses one family), `AnimatedPressable` (scale + haptic), `AnimatedEntry`/`AnimatedListItem`, `react-native-reanimated` 4, `react-native-svg`, and theme tokens with the right emerald values.
- Settings already uses the target list pattern (one surface, hairline rows), so the list primitive is an extraction, not an invention.
- Every month of new screens built in the old look adds to the cost.

## The gaps, and the one source for each

| Gap (brand principle) | Today | Change at the source |
| --- | --- | --- |
| Type: Geist for reading, mono only for labels/numbers | Menlo for all text (`FONTS.mono` in every `TYPOGRAPHY` role) | `FONTS.sans = Geist`, `FONTS.mono = Geist Mono`; reading roles (body, h1–h3, bodySmall) → sans; label/meta/display numbers → mono. Bundle Geist TTFs (one native rebuild). |
| Lists: one surface with hairlines, never stacked boxes | Home Recent, Chats, Projects, Models are stacks of bordered, shadowed cards | Extract `ListGroup` / `ListRow` from the Settings pattern; move the four lists onto it. |
| Alive: press waves, staggered entrance, focus light, living background | Static pages; `AnimatedPressable` used in some places only | One `alive` module: press (scale + soft light), staggered list entrance, focus glow on inputs, a `LivingBackground` (faint dot lattice + slow breathing emerald light, SVG + Reanimated). Honours Reduce Motion. |
| Emerald is the light source, used sparingly; red only for errors | Solid emerald user bubbles; red Stop; emerald text on outlined buttons | Chat surface: assistant text on the surface (no box); user bubble a quiet raised surface with an emerald edge; Stop neutral; one primary action per screen with an emerald halo. |

## Order

1. **Product P0s first** (no design dependency): the best downloaded model is the default; a failed send keeps the message and shows Retry, and leaves no empty chat.
2. **Type** (tokens + fonts) — the biggest visible change, one place.
3. **ListGroup/ListRow** → Chats, Home Recent, Projects, Models.
4. **Chat surface** (bubbles, Stop, answer on surface, header shows the model's name).
5. **Home hierarchy** (New Chat as the primary action; model counts → one line).
6. **Alive layer** (press, entrance, focus, living background).

Each step: device screenshots before/after in both themes, tests, one commit per concern.

## Costs and limits

- **Fonts:** Geist TTFs must be bundled for iOS and Android (`UIAppFonts` + Android assets). That needs one native rebuild per platform. Android needs a separate check: memory note "No Menlo change on Android" warns against remapping fonts to fix text bugs; this is a deliberate brand change, and it needs Ali's go.
- **Glass (blur):** no blur library is installed. Dialogs stay as solid raised surfaces for now; glass is a later, separate native dependency.
- **Performance:** the living background is one SVG layer with a single Reanimated loop on the UI thread. It turns off with Reduce Motion and in Low Power Mode.
- **Never lose functionality:** visual-only changes; no control, setting or route is removed.
