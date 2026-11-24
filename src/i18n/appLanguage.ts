// The app language: the person's pick, else the phone's language, else English (shared resolveLocale).
// Catalogs are bundled and read only for the language in use.
import { useMemo } from 'react';
import { resolveLocale, setCatalog, type Locale, type Strings } from '@offgrid/i18n';
import { useLocaleStore } from '../stores/localeStore';

const CATALOGS: Record<string, () => Strings> = {
  de: () => require('@offgrid/i18n/catalogs/de/mobile.json'),
  es: () => require('@offgrid/i18n/catalogs/es/mobile.json'),
  fr: () => require('@offgrid/i18n/catalogs/fr/mobile.json'),
  it: () => require('@offgrid/i18n/catalogs/it/mobile.json'),
  nl: () => require('@offgrid/i18n/catalogs/nl/mobile.json'),
  pl: () => require('@offgrid/i18n/catalogs/pl/mobile.json'),
  pt: () => require('@offgrid/i18n/catalogs/pt/mobile.json'),
  tr: () => require('@offgrid/i18n/catalogs/tr/mobile.json'),
  id: () => require('@offgrid/i18n/catalogs/id/mobile.json'),
  ru: () => require('@offgrid/i18n/catalogs/ru/mobile.json'),
  ja: () => require('@offgrid/i18n/catalogs/ja/mobile.json'),
  zh: () => require('@offgrid/i18n/catalogs/zh/mobile.json'),
};

/** The phone's language as a BCP 47 tag (Hermes Intl follows the system locale on iOS and Android). */
export function systemLanguages(): string[] {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    return tag ? [tag] : [];
  } catch {
    return [];
  }
}

/** Resolves the app language and makes it the active catalog. Returns the locale now in use. */
export function applyAppLanguage(picked: string | null, system: readonly string[] = systemLanguages()): Locale {
  const locale = resolveLocale(system, picked);
  const load = CATALOGS[locale.code];
  setCatalog(locale.code, load ? load() : null);
  return locale;
}

/** The app language, applied before the caller's children render. Key the app root on its code. */
export function useAppLanguage(): Locale {
  const picked = useLocaleStore(s => s.picked);
  return useMemo(() => applyAppLanguage(picked), [picked]);
}
