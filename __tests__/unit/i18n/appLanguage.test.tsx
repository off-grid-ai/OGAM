/**
 * The app language follows the locale store as soon as it changes (the app root keys on it). The real
 * store and catalogs; the phone's language (Intl) is the device boundary, faked.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { activeLocale, setCatalog, t, TRANSLATED_LOCALES } from '@offgrid/i18n';
import { useLocaleStore } from '../../../src/stores/localeStore';
import { applyAppLanguage, useAppLanguage } from '../../../src/i18n/appLanguage';

function phoneSpeaks(tag: string) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  jest
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), locale: tag } as Intl.ResolvedDateTimeFormatOptions;
    });
}

afterEach(() => {
  jest.restoreAllMocks();
  useLocaleStore.getState().setPicked(null);
  setCatalog('en', null);
});

describe('useAppLanguage', () => {
  it('changes as soon as the pick changes', () => {
    phoneSpeaks('en-US');
    const Probe = () => {
      const language = useAppLanguage();
      return <Text>{language.code}</Text>;
    };
    const view = render(<Probe />);
    expect(view.getByText('en')).toBeTruthy();
    act(() => {
      useLocaleStore.getState().setPicked('fr');
    });
    expect(view.getByText('fr')).toBeTruthy();
    expect(activeLocale().code).toBe('fr');
  });

  it.each(TRANSLATED_LOCALES.map(locale => [locale.code]))('%s ships with its own words', code => {
    expect(applyAppLanguage(code).code).toBe(code);
    expect(t('Phone language')).not.toBe('Phone language');
  });
});
