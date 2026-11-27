# Indian languages in the apps: plan

Status: building the 11 left-to-right languages. Urdu is parked (see "Decided calls").
Date: 25 Nov 2026.

## In short

- Add 11 Indian languages to OGAM (mobile) and OGAD (desktop): Hindi, Marathi, Gujarati, Telugu, Tamil, Kannada, Malayalam, Bengali, Punjabi, Odia, Assamese. These are the left-to-right languages the Indus Appstore lists. Urdu, the twelfth, is parked with all right-to-left work (see "Decided calls").
- **The i18n layer already exists.** `@offgrid/i18n` (shared) ships 12 other languages today (de, es, fr, it, nl, pl, pt, tr, id, ru, ja, zh). See `../app-languages/plan.md`. This work adds locales to it. It adds no new library and no new architecture.
- Most of the work is in three places: the drafts (11 × about 4,500 strings), fonts and line height for Indic scripts, and native strings.
- The app list grows from 13 to 24 languages. The 11 join the one list after the current 12, with no group header.

## 1. Audit: what exists now

| Part | State |
|---|---|
| Shared layer | `shared/packages/i18n`: `keyOf`, JSX runtime, `t()`, `msg()`, `resolveLocale`, `Intl` helpers, `replyLanguageLine`, `collect` and `check` CLI, ratchet (`untranslated.json`, now 0). |
| Catalogs | `catalogs/<code>/{mobile,desktop,extension}.json`. English: mobile 2,082 keys, desktop 2,200, extension 233. All 12 current locales are complete. |
| Mobile | Metro maps `react/jsx-runtime` to the i18n runtime. `src/i18n/appLanguage.ts` (catalog map), `localeStore.ts` (the pick), `LanguageScreen.tsx`. Android `values-<code>/` for the 12. |
| Desktop | Vite `jsxImportSource: '@offgrid/i18n'`. `lib/app-language.ts`, `AppLanguageRoot.tsx`, `LanguageSettingsSection.tsx`. |
| Pro | Mobile `pro/` and desktop `pro/` are in the collect pass already. |
| RTL | **None.** No `I18nManager`, no `dir="rtl"`, no `writingDirection` anywhere. |
| Fonts | Geist and Geist Mono only (`mobile/assets/fonts/geist`, `@offgrid/design` `FONTS`). Geist has no Indic or Arabic glyphs. |
| Native, iOS | No `.lproj`, no `CFBundleLocalizations`. iOS per-app language is not declared yet, for any locale. |
| Native, Android | `values-<code>/` for the 12. No `locales_config.xml`, so Android 13 per-app language does not list them. |
| Hand-test rows | None for language (the change map flags it). |

## 2. Shared: the one owner

All rules stay in `@offgrid/i18n`. Mobile and desktop only consume.

- **`locales.ts`.** Add 11 entries. A new field `script` (`Deva`, `Gujr`, `Telu`, `Taml`, `Knda`, `Mlym`, `Beng`, `Guru`, `Orya`) for the font rule. No `dir` field: all 11 are left-to-right, and RTL is parked.

  | code | tag | name | script |
  |---|---|---|---|
  | hi | hi-IN | हिन्दी | Deva |
  | mr | mr-IN | मराठी | Deva |
  | gu | gu-IN | ગુજરાતી | Gujr |
  | te | te-IN | తెలుగు | Telu |
  | ta | ta-IN | தமிழ் | Taml |
  | kn | kn-IN | ಕನ್ನಡ | Knda |
  | ml | ml-IN | മലയാളം | Mlym |
  | bn | bn-IN | বাংলা | Beng |
  | pa | pa-IN | ਪੰਜਾਬੀ | Guru |
  | or | or-IN | ଓଡ଼ିଆ | Orya |
  | as | as-IN | অসমীয়া | Beng |

- **`matchLocale`.** Works as is: `bn-BD` → bn, `pa-Guru-IN` → pa. Add tests. `ur-PK`, `ur-IN` and `pa-Arab` (Shahmukhi) get English while Urdu is parked, as Traditional Chinese does now.
- **No picker group.** The 11 join the one list (decided call "Picker"), so no `group` field and no new string.
- **Numbers.** `Intl` with the `-IN` tag gives lakh grouping (1,00,000). Digits: **Latin (0–9) for all 11** (`-u-nu-latn`), as Indian payment and bank apps do. Without it, `bn`, `mr` and `as` show native digits next to Latin digits in Geist Mono labels. One rule in `intl.ts`.
- **Plurals.** `Intl.PluralRules` has CLDR rules for all 11 (for example Hindi: 0 and 1 are both "one"). The existing fallback table gets the 11 rules for an engine without `PluralRules`.
- **`replyLanguageLine`.** No change. It uses `english` ("Reply in Hindi…").
- **`fontFor(locale)`** (new, small): the font stack per script. See section 4.

## 3. Urdu: right-to-left (parked, not in this build)

Parked by the decided call "Urdu: not now". Nothing in this section is built now; it is kept as the plan for a later Urdu release, and the steps in section 9 do not include it. Measured: mobile has 347 left/right styles and 71 left/right icons; desktop has 256 left/right Tailwind classes and 71 left/right icons.

**Mobile.**
- `I18nManager.forceRTL(true)` flips all of React Native layout, but only after a native restart. A switch to or from Urdu therefore restarts the app once (other switches stay instant). The spike also tries a root `direction: 'rtl'` style first: if it works on both phones, there is no restart.
- `marginLeft` → `marginStart`, `left` → `start`, `textAlign: 'left'` → `'auto'`. One area per commit. A lint rule stops new left/right styles.
- Direction icons (back, chevrons, send) get `transform: [{ scaleX: -1 }]` in RTL, through one `DirIcon` wrapper in the design layer.
- **User text keeps its own direction.** Chat bubbles, notes, model names and model replies use `writingDirection: 'auto'`. English code in an Urdu chat stays left-to-right.

**Desktop.**
- `<html dir="rtl" lang="ur">` from `AppLanguageRoot`. No restart.
- Tailwind `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/`text-left` → logical classes (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`). A lint rule stops new ones.
- Direction icons flip with `rtl:-scale-x-100`.
- Code blocks, terminals and the editor stay `dir="ltr"`. Chat text uses `dir="auto"`.
- The OS menu bar and tray follow the OS, not the app. No change.

## 4. Fonts and line height

- **The rule.** Geist stays first. Each script gets a fallback after it. Latin words (brand, model names) stay in Geist. Indic words use the script font.
- **Mobile.** iOS and Android both fall back per glyph to system fonts, so Indic text shows today with no bundled font. The spike checks all 9 scripts on a real iPhone and a real Android phone (Odia and Assamese on an older Android are the risk). Bundle Noto Sans for a script **only** when a phone shows boxes.
- **Urdu font (parked with Urdu, C4).** Urdu readers expect Nastaliq, which is tall (about 1.6× line height). Not built now.
- **Line height.** Indic marks above and below the line get cut when `lineHeight` is tight. `@offgrid/design` type tokens get a per-script line-height factor (Indic 1.3×) through `fontFor(locale)`. Negative `letterSpacing` is set to 0 for these scripts, because it breaks joined letters.
- **Desktop.** CSS `:lang(hi)` etc. stacks: Geist, then the script font. Windows has Nirmala UI (all 9 Indic scripts). macOS has Kohinoor, Tamil/Telugu/Kannada/Malayalam/Oriya Sangam MN, Bangla MN and Gurmukhi MN. Bundle nothing unless a check fails.

## 5. Language pick

- No new rule. `resolveLocale`: the person's pick, else the system language, else English. A phone set to Hindi opens in Hindi.
- Settings → Language (mobile `LanguageScreen`, desktop `LanguageSettingsSection`) shows one list: the 13 current languages, then the 11, each in its own script with the English name under it. No group header.
- **System lists.** Declare all 24 languages so the OS per-app language setting lists them: Android `res/xml/locales_config.xml` + `android:localeConfig`; iOS `CFBundleLocalizations`. This also covers the 12 current locales (they are not declared now).

## 6. Native strings

- Android: `values-hi/`, `values-mr/` … one folder for each of the 11 (Odia `values-or`, Assamese `values-as`), from the catalog, like the 12 now. Notification channels and the 3 `strings.xml` entries.
- iOS: `<code>.lproj/InfoPlist.strings` for the 9 permission prompts, for all 24 languages, from the catalog.
- Desktop main: menus, tray, dialogs already use `t()`. Nothing new.

## 7. Translations: how they are made and checked

- **Drafts.** Claude drafts all 11, as for the current 12. Input: the English catalog, the keep-English list (Off Grid AI, model names), and the Indus store listing as the glossary (the words Indian users already saw on the store).
- **Style.** Everyday words, not formal Sanskrit-heavy or Persian-heavy words. Common English tech words stay in English where people say them that way ("model", "chat", "download"), written in the script. Hindi uses "आप".
- **Check.** `offgrid-i18n check` (placeholders, stale keys, gaps) in CI. Then one native speaker per language checks the main screens (onboarding, chat, models, settings) in the translate editor. Then a screen-review in Malayalam (long words) and Tamil (long words) for cut text.
- **Model quality.** Small local models write Hindi, Bengali and Tamil well, but Odia and Assamese poorly. "Reply in my language" is opt-in: off until the person turns it on (`replyLanguageDefault`). The model picker can show which languages a model speaks.

## 8. Tests

- **Shared (100% coverage).** `matchLocale` for each `-IN` tag and `bn-BD`, and English for `ur-PK` and `pa-Arab`; Latin digits and lakh grouping; plural rules for all 11; `fontFor` per locale; `check` passes for all 24 catalogs.
- **Mobile and desktop (integration, through the screen).** Pick Hindi in Settings → Language → the Settings screen shows Hindi text. The 11 show in the one list after the current languages, with no group header. No mocks of our code.
- **Devices.** Add rows to `mobile/docs/RELEASE_TEST_CHECKLIST.csv` (the change map asks for them): Hindi from the phone language; Tamil picked in app; Odia glyphs on an older Android; permission prompt in Hindi on iOS; notification channel in Hindi on Android.

## 9. Steps (each with its check)

1. **Spike on both phones.** Hindi and Odia catalogs (10 strings each). Check: glyphs show on a real iPhone and Android phone; no cut marks.
2. **Shared.** 11 locales, `script`, Latin digits, plural table, `fontFor`. Check: shared tests at 100%.
3. **Drafts for the 11.** Check: `offgrid-i18n check` passes; `untranslated.json` stays 0.
4. **Fonts and line height** (design tokens, desktop CSS). Check: screen-review in Hindi and Malayalam.
5. **The one list and system language lists** (24 languages, no group header). Check: Android 13 and iOS Settings list the app's languages.
6. **Native strings.** Check: iOS prompt and Android channel in Hindi on device.
7. **Native-speaker check for each language, then release.**

Urdu and all right-to-left work (section 3, C4) are not in these steps.

The extension is out of scope (the task names mobile and desktop). It can add the same locales later from the same catalogs.

## Calls for Mac

- **C1. All 12 at once, or in two waves?** Recommendation: two waves. Wave 1: the 11 left-to-right languages (fonts and drafts only, fast). Wave 2: Urdu, after the RTL work. Urdu waits for RTL in any case.
- **C2. Who checks the drafts?** Recommendation: one native speaker per language, from the Wednesday team where we have one, else a paid reviewer; the translate editor is open to the community too.
- **C3. Digits.** Recommendation: Latin digits (0–9) in all 12.
- **C4. Urdu font on Android.** Recommendation: bundle Noto Nastaliq Urdu (about 1 MB).

## Decided calls (Mac, 25 Nov 2026)

- **Urdu: not now.** Mac: Urdu right-to-left "feels wrong, at least right now. So right now don't do that." Decision: no RTL work and no Urdu locale. Section 3 and the Urdu font (C4) wait. The 11 left-to-right languages ship.
- **The 11 ship together**, in one release (as decided call C1 of the first plan).
- **Drafts.** Mac: Claude writes them in the chat (no API script). A native speaker checks each language before release (C2).
- **Digits.** Latin 0–9 in all languages (C3).
- **Picker.** The 11 join the one list, after the current 12, each in its own script. No group header for now (it adds no new string).
