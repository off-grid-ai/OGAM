# OffgridMobile Design Philosophy & System

## Core Philosophy

OffgridMobile follows a **brutalist, minimal design system** inspired by terminal aesthetics. Visual quality and function are both essential. The interface must be clear, consistent, easy to use, and responsive.

### Product priority: UI and UX are P0

Styling, UI/UX, consistency, ease of use, finesse, animation, and interactions are **P0 requirements**. Do not defer known problems in these areas as optional polish. A feature must work well and feel complete in use.

- Reuse existing components, theme tokens, and interaction patterns across screens.
- Use restrained depth and theme-aware shadows to separate cards and show hierarchy. Minimal does not mean flat or unfinished.
- Follow the recent chat and remote-server card improvements. Mobile commits `93e90268` (chat card depth), `f87ae730` (remote-server card depth), and `4871a9ad` (enhanced prompt card styling) provide implementation references.
- Make taps, selection, expansion, collapse, loading, cancellation, and recovery clear and predictable. Show the actual state of the operation.
- Use smooth, purposeful animation and immediate interaction feedback. Respect reduced-motion settings and device performance.
- Keep common actions easy to find. Keep rows compact and easy to scan. Hide technical file details until the user needs them.
- Check the result in the real app on each affected platform. A source change alone does not establish visual or interaction quality.

These rules apply to new features and changes to existing screens. Fix concrete feedback within the affected area; this is not a request for unrelated redesigns.

### Mobile design decisions

This document is the source of truth for Off Grid AI Mobile layout and interaction decisions. The shared brand philosophy supplies the common visual identity; use this document for the mobile details.

- Use less visible text. Keep the words a person needs to choose or act. Put longer explanations in details, confirmation, or recovery states.
- Use a clear icon for a familiar action when it saves space. Give every icon action an accessible label and a touch target of at least 44px. Keep visible text when the icon could be misunderstood.
- Keep model rows lean and compact. Use the shared `ModelCard` for text, image, video, embedding, and speech models. Highlight the active model in the same list; do not make a separate active-model list. Put the main action in the row; do not add a large button below every card.
- Use the screen area well. Align headings, inputs, cards, and actions to the same content edge. Avoid repeated copy and empty space that makes a list harder to scan.
- Use standard `SPACING` tokens for gaps and padding. Keep the same spacing between equivalent parts across screens.
- Give cards useful depth with restrained, theme-aware shadows. Use the same depth pattern across related screens; keep borders crisp and avoid heavy elevation.

---

## Design Principles

### 1. **Minimal & Functional**
- No unnecessary decoration or embellishment
- Every element serves a purpose
- Remove before adding
- Silence over noise

### 2. **Terminal-Inspired Aesthetic**
- Monospace typography (`Menlo`) throughout
- Dark mode: Pure black background (`#0A0A0A`), light mode: clean white (`#FFFFFF`)
- Single accent color (emerald green — `#34D399` dark, `#059669` light)
- High contrast for readability in both themes
- Crisp borders and sharp edges

### 3. **Consistent Patterns**
- Use centralized design tokens (typography, spacing, colors)
- No magic numbers in component styles
- Maintain visual hierarchy through size and weight, not color
- Predictable interactions

### 4. **Information Density**
- Respect screen real estate
- Compact layouts where appropriate
- Progressive disclosure (hide complexity until needed)
- Metadata as "whispers" not shouts

### 5. **Performance First**
- Lightweight components
- No unnecessary animations (functional animations only)
- Fast, responsive interactions
- Optimize for lower-end devices

---

## Design System

### Typography Scale

All text uses **Menlo** (monospace) for consistency and readability.

| Token | Size | Weight | Use Case | Example |
|-------|------|--------|----------|---------|
| `TYPOGRAPHY.display` | 22px | 200 | Hero numbers, RAM display | "8.2 GB" |
| `TYPOGRAPHY.h1` | 24px | 300 | Screen titles | "Conversations" |
| `TYPOGRAPHY.h2` | 16px | 400 | Section headers | "Downloaded Models" |
| `TYPOGRAPHY.h3` | 13px | 400 | Subsection headers | "Text Models" |
| `TYPOGRAPHY.body` | 14px | 400 | Primary body text | Message content |
| `TYPOGRAPHY.bodySmall` | 13px | 400 | Secondary body text | Descriptions |
| `TYPOGRAPHY.label` | 10px | 400 | Labels, whispers | "ACTIVE MODEL" |
| `TYPOGRAPHY.labelSmall` | 9px | 400 | Tiny labels | Badges |
| `TYPOGRAPHY.meta` | 10px | 300 | Metadata | "12.3 tok/s" |
| `TYPOGRAPHY.metaSmall` | 9px | 300 | Tiny metadata | Timestamps |

**Typography Rules:**
- Use `display` for large numeric displays (memory, performance metrics)
- Use `h1` for screen titles
- Use `h2` for major sections
- Use `h3` for subsections within cards
- Use `label` for uppercase labels and section markers ("whispers")
- Use `meta` for secondary information (timestamps, performance data)
- Maintain consistent letter spacing: tight (-0.5) for large text, loose (+0.3) for small labels

---

### Spacing Scale

Use the spacing scale for all margins, paddings, and gaps.

| Token | Value | Use Case |
|-------|-------|----------|
| `SPACING.xs` | 4px | Tight spacing, icon gaps |
| `SPACING.sm` | 8px | Small padding, list item gaps |
| `SPACING.md` | 12px | Standard padding |
| `SPACING.lg` | 16px | Card padding, section spacing |
| `SPACING.xl` | 24px | Screen padding, major sections |
| `SPACING.xxl` | 32px | Large screen padding, hero sections |

**Spacing Rules:**
- Screen-level padding: `SPACING.xl` (24px)
- Card padding: `SPACING.lg` (16px)
- Button padding: `SPACING.sm` or `SPACING.md`
- List item gaps: `SPACING.sm`
- Icon-to-text gaps: `SPACING.sm`
- Section breaks: `SPACING.xl` or `SPACING.xxl`

---

### Color System

Monochromatic palette with emerald green as the only accent. Supports **light and dark modes** via the theme system (`src/theme/`).

Colors are accessed via `useTheme()` hook — not imported directly. All tokens are available as `colors.xxx` in both themes.

#### Token Reference (dark / light values)
| Token | Dark | Light | Use Case |
|-------|------|-------|----------|
| `colors.primary` | `#34D399` | `#059669` | Main accent, active states |
| `colors.background` | `#0A0A0A` | `#FFFFFF` | App background |
| `colors.surface` | `#141414` | `#F5F5F5` | Cards, elevated elements |
| `colors.surfaceLight` | `#1E1E1E` | `#EBEBEB` | Nested elements, inputs |
| `colors.text` | `#FFFFFF` | `#0A0A0A` | Primary text |
| `colors.textSecondary` | `#B0B0B0` | `#525252` | Secondary text |
| `colors.textMuted` | `#808080` | `#8A8A8A` | Metadata, placeholders |
| `colors.border` | `#1E1E1E` | `#E5E5E5` | Default borders |
| `colors.borderFocus` | `#34D399` | `#059669` | Focused/active borders |
| `colors.error` | `#EF4444` | `#DC2626` | Error states |
| `colors.overlay` | `rgba(0,0,0,0.7)` | `rgba(0,0,0,0.4)` | Modal backgrounds |

#### Shadows (theme-aware)
| Level | Light Mode | Dark Mode |
|-------|-----------|-----------|
| `shadows.small` | Black, opacity 0.15, radius 6 | White, opacity 0.08, radius 1 |
| `shadows.medium` | Black, opacity 0.22, radius 10 | White, opacity 0.10, radius 2 |
| `shadows.large` | Black, opacity 0.35, radius 18 | White, opacity 0.12, radius 3 |
| `shadows.glow` | Emerald, opacity 0.25, radius 12 | Emerald, opacity 0.15, radius 4 |

Dark mode shadows use very tight radius (1-3px) to preserve crisp card edges while still providing subtle elevation.

**Color Rules:**
- Use emerald (`primary`) sparingly — only for active states, focus, and important actions
- Prefer monochrome hierarchy over color variation
- Semantic colors (success, warning, error) only for their intended purpose
- Borders should be subtle (`border`) unless focused (`borderFocus`)
- Backgrounds should use the three-tier system: `background` → `surface` → `surfaceLight`
- **Never import COLORS directly** — always use `useTheme()` for dynamic theming

---

### Component Patterns

#### Buttons
- **Default:** Transparent with border (outline style)
- **Primary:** Transparent with emerald border, emerald text
- **Secondary:** Transparent with gray border, white text
- **Ghost:** No border, just text
- Padding: Use spacing scale (`sm`, `md`, `lg` for different sizes)
- Border radius: `8px` (sharp, minimal)
- No shadows or gradients

#### Cards
- Background: `colors.surface`
- Padding: `SPACING.lg`
- Border radius: `8px`
- Border: `1px solid colors.border`
- Shadow: `shadows.small` (subtle elevation)
- Hover state (if interactive): `backgroundColor: colors.surfaceHover`
- **Compact variant:** `ModelCard` supports a `compact` prop for dense list views — horizontal layout with content on left and icon actions (download, select, delete) on right. Used for recommended models and image model lists.

#### Icon Action Buttons
- Small circular touch targets with Feather icons (download, check-circle, trash-2)
- Transparent background, `colors.textMuted` default, `colors.primary` for active/selected state
- `hitSlop` for easier mobile tapping
- Used in compact `ModelCard` and list items instead of full-width text buttons

#### Screen Headers

All screens must use a standardized header style for visual consistency. Two variants exist:

**Tab Screen Header** (top-level tabs: Chats, Projects, Models, Settings):
```typescript
<ScreenHeader title="Models" variant="tab" right={downloadAction} />
```
- Shared owner: `components/ScreenHeader.tsx`; do not copy this header into tab screens.
- Padding: `SPACING.md` horizontal and `SPACING.sm` vertical.
- Title (`TYPOGRAPHY.h2`) on the left
- Optional action button on the right (e.g. "New", download icon)
- `backgroundColor: colors.surface` + `shadows.small` for elevation

**Sub-Screen Header** (pushed screens: ModelSettings, Storage, Security, etc.):
```typescript
header: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: SPACING.lg,
  paddingVertical: SPACING.md,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
  backgroundColor: colors.surface,
  ...shadows.small,
  zIndex: 1,
  gap: SPACING.md,
}
```
- Back button on the left
- Title (`TYPOGRAPHY.h2`, `flex: 1`) fills remaining space
- Optional action button on the right

**Key rules:**
- Every header MUST have `backgroundColor: colors.surface` and `...shadows.small`
- Every header MUST have `zIndex: 1` (so shadow renders above content below)
- Subscreen padding is `SPACING.lg` horizontal and `SPACING.md` vertical.
- Top-level tab padding is `SPACING.md` horizontal and `SPACING.sm` vertical.
- Border bottom is always 1px `colors.border`
- Home keeps its product masthead inside the scroll content.

**Exceptions:** Onboarding, LockScreen, and ModelDownload have no standard header (full-screen flows).

#### Text Inputs
- Background: `colors.surfaceLight`
- Border: `1px solid colors.border`
- Focus border: `colors.borderFocus`
- Padding: `SPACING.md`
- Border radius: `8px`
- Monospace font

#### Filter Pills
- Horizontal scroll of filter options (org, size, quantization, type)
- Default: `colors.surfaceLight` background, `colors.border` border
- Active: `colors.primary` border, `colors.primary` text
- `TYPOGRAPHY.labelSmall` or `TYPOGRAPHY.meta` for pill text
- Expandable sections with multi-select for dimension filters (e.g., organizations)
- Clear all filters button when any filter is active

#### Labels & Headers
- Use `TYPOGRAPHY.label` or `TYPOGRAPHY.labelSmall`
- **Always uppercase** (e.g., "ACTIVE MODEL", "DOWNLOADED MODELS")
- Color: `COLORS.textMuted` (whisper, not shout)
- Letter spacing: `+0.3` for readability
- Purpose: Visual anchors, not primary content

#### Metadata Display
- Use `TYPOGRAPHY.meta` or `TYPOGRAPHY.metaSmall`
- Color: `COLORS.textSecondary` or `COLORS.textMuted`
- Parentheses for inline metadata: `(12.3 tok/s)`
- Bullets for lists: `• Metal • 99 layers`
- Keep concise: numbers + abbreviations

---

## UI Patterns

### Information Hierarchy

1. **Primary:** Screen title (h1) or main content (body)
2. **Secondary:** Section headers (h2, h3) or descriptions (bodySmall)
3. **Tertiary:** Labels (label), metadata (meta), timestamps (metaSmall)

### Whitespace

- Generous top-level spacing (`SPACING.xl`, `SPACING.xxl`)
- Tighter spacing within components (`SPACING.sm`, `SPACING.md`)
- Breathing room around text (`SPACING.md` minimum)
- Avoid cramped layouts — let content breathe

### States

| State | Visual Treatment |
|-------|------------------|
| **Default** | Normal colors, subtle borders |
| **Hover** | `COLORS.surfaceHover` background |
| **Active/Pressed** | `COLORS.primaryDark` accent |
| **Focused** | `COLORS.borderFocus` border |
| **Disabled** | 40% opacity, `COLORS.textDisabled` |
| **Loading** | Subtle spinner, muted text |

### Feedback

- **Success:** Brief green flash or checkmark
- **Error:** Red text + error icon
- **Loading:** Minimal spinner (no elaborate animations)
- **Empty states:** Simple message + optional action button

---

## Anti-Patterns (What to Avoid)

❌ **Colorful gradients or heavy shadows** — Use restrained, theme-aware depth that matches existing cards
❌ **Multiple accent colors** — Emerald only
❌ **Rounded pill shapes** — Use minimal `8px` radius
❌ **Decorative animations** — Only functional animations (loading, state transitions)
❌ **Mixed font families** — Menlo only
❌ **Heavy borders or 3D effects** — Keep edges crisp and elevation restrained
❌ **Large empty spaces without purpose** — Dense when appropriate
❌ **Color-coded information** — Use hierarchy, not color
❌ **Cluttered layouts** — Remove before adding

---

## Implementation Guide

### Using Design Tokens

Theme-independent tokens (`TYPOGRAPHY`, `SPACING`, `FONTS`) come from `src/constants/index.ts`.
Colors and shadows come from the theme system via hooks:

```typescript
import { SPACING, TYPOGRAPHY } from '../constants';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';

const MyScreen = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hello</Text>
      <Icon color={colors.textMuted} />
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    backgroundColor: colors.background,
    padding: SPACING.xl,
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: colors.text,
    marginBottom: SPACING.md,
  },
});
```

### Component Checklist

When building or refactoring a component:

- [ ] Uses `useTheme()` and `useThemedStyles()` (no hardcoded colors)
- [ ] Follows typography scale (`TYPOGRAPHY.*`)
- [ ] Uses spacing scale for all padding/margin (`SPACING.*`)
- [ ] Colors from theme only (`colors.*` via hook, never direct import)
- [ ] Labels are uppercase with proper typography
- [ ] Metadata uses appropriate meta styles
- [ ] Buttons follow button patterns (transparent + border)
- [ ] Cards use surface colors with minimal borders
- [ ] Shadows from theme only (`shadows.small/medium/large`)
- [ ] States (hover, focus, disabled) properly styled
- [ ] Accessible (sufficient contrast, touch targets ≥ 44px)

---

## Philosophy in Practice

### Example: Model Card

**Before (decorative, colorful):**
- Gradient background
- Multiple colors for badges
- Large shadows
- Rounded pill shapes
- Mixed fonts

**After (brutalist, minimal):**
- Flat `COLORS.surface` background
- Single emerald accent for active state
- Sharp `8px` border radius
- Monospace font throughout
- Uppercase label for section ("DOWNLOADED MODELS")
- Metadata as small, muted text
- Subtle border and theme-aware shadow, consistent with the shared card pattern
- Compact mode: horizontal layout with icon action buttons (download, select, delete) on right
- Author shown as small pill-style tag, not a full line

### Example: Chat Message

**Before:**
- Bubble-style messages with gradients
- Colorful avatars
- Large padding, rounded corners
- Mixed fonts for metadata

**After:**
- Theme surface background with the established card depth and shadow
- No avatars (text-first)
- Compact padding (`SPACING.md`)
- Sharp edges
- Metadata in tiny, muted monospace
- Role indicated by position and subtle color, not decoration

---

## Design Evolution

This design system was intentionally created to:

1. **Differentiate** from typical chat apps (iOS Messages, WhatsApp)
2. **Signal technical capability** through terminal aesthetics
3. **Respect privacy** with dark, unobtrusive UI
4. **Optimize for content** — let the AI responses shine
5. **Perform well** on low-end devices (no heavy rendering)
6. **Age gracefully** — minimalism doesn't go out of style

As the app evolves:
- **Keep the minimal aesthetic** — preserve visual quality, useful depth, and clear interactions
- **Maintain consistency** — use tokens religiously
- **Question additions** — does this serve the user or just look nice?
- **Optimize for density** — information should be easy to scan

---

## References

- **Theme System:** `src/theme/` (palettes, hooks, style factory)
- **Design Tokens:** `src/constants/index.ts` (typography, spacing, fonts)
- **Codebase Guide:** `docs/standards/CODEBASE_GUIDE.md`
- **Typography:** All Menlo, weights 200-400 only
- **Inspiration:** Terminal UIs, Linear, Vercel, brutalist web design

---

**Remember:** Clarity, visual quality, and ease of use are part of the feature. Minimal design must still feel complete.
