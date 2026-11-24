/**
 * App language — the pick on Settings → Language and on the first onboarding page, and the language the
 * app then uses. The real screens run on a real stack navigator with the real locale store and the real
 * translated catalogs; the only fake is the phone's language (Intl), the device boundary.
 */
jest.unmock('@react-navigation/native');

import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { setCatalog, t } from '@offgrid/i18n';
import { LanguageScreen } from '../../../src/screens/LanguageScreen';
import { OnboardingScreen } from '../../../src/screens/OnboardingScreen';
import { useLocaleStore } from '../../../src/stores/localeStore';
import { applyAppLanguage, systemLanguages } from '../../../src/i18n/appLanguage';

const Stack = createNativeStackNavigator();

function phoneSpeaks(tag: string | undefined) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  jest
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), locale: tag } as Intl.ResolvedDateTimeFormatOptions;
    });
}

function mount() {
  const ref = createNavigationContainerRef<Record<string, undefined>>();
  const view = render(
    <NavigationContainer ref={ref}>
      <Stack.Navigator>
        <Stack.Screen name="Onboarding" component={OnboardingScreen as React.ComponentType<any>} />
        <Stack.Screen name="Language" component={LanguageScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  return { view, route: () => ref.getCurrentRoute()?.name };
}

// The store reads its saved pick at start (async storage); let that finish so it cannot undo a test's pick.
beforeAll(() => useLocaleStore.persist.rehydrate());
beforeEach(() => useLocaleStore.getState().setPicked(null));
afterEach(() => {
  jest.restoreAllMocks();
  setCatalog('en', null);
});

describe('the app language', () => {
  it('follows the phone, so a German phone shows German', () => {
    phoneSpeaks('de-AT');
    expect(applyAppLanguage(null).code).toBe('de');
    expect(t('Phone language')).toBe('Sprache des Telefons');
  });

  it('a pick wins over the phone', () => {
    phoneSpeaks('de-DE');
    expect(applyAppLanguage('ja').code).toBe('ja');
    expect(t('Language: {0}', '日本語')).toBe('言語: 日本語');
  });

  it('a language we do not ship is English, as written', () => {
    phoneSpeaks('ko-KR');
    expect(applyAppLanguage(null).code).toBe('en');
    expect(t('Phone language')).toBe('Phone language');
  });

  it('with no readable phone language it is English', () => {
    phoneSpeaks(undefined);
    expect(systemLanguages()).toEqual([]);
    jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
      throw new Error('no Intl');
    });
    expect(systemLanguages()).toEqual([]);
    expect(applyAppLanguage(null).code).toBe('en');
  });

});

describe('picking a language', () => {
  it('onboarding shows the phone language and opens the list', () => {
    phoneSpeaks('pt-BR');
    applyAppLanguage(null);
    const { view, route } = mount();
    expect(view.getByText('Português')).toBeTruthy();
    fireEvent.press(view.getByTestId('onboarding-language'));
    expect(route()).toBe('Language');
  });

  it('a tap picks a language; Phone language goes back to the phone', () => {
    phoneSpeaks('nl-NL');
    const { view } = mount();
    fireEvent.press(view.getByTestId('onboarding-language'));

    // The phone's language is named under its row; every shipped language is listed in its own name.
    expect(within(view.getByTestId('language-system')).getByText('Nederlands')).toBeTruthy();
    expect(within(view.getByTestId('language-de')).getByText('Deutsch')).toBeTruthy();
    expect(view.getByTestId('language-system').props.accessibilityState).toEqual({ selected: true });

    fireEvent.press(view.getByTestId('language-de'));
    expect(useLocaleStore.getState().picked).toBe('de');
    expect(view.getByTestId('language-de').props.accessibilityState).toEqual({ selected: true });
    expect(view.getByTestId('language-system').props.accessibilityState).toEqual({ selected: false });

    fireEvent.press(view.getByTestId('language-system'));
    expect(useLocaleStore.getState().picked).toBeNull();
  });

  it('the first page reads in the picked language', () => {
    // Hand test 2026-11-19: the button turned Spanish and the page about Off Grid AI stayed English.
    applyAppLanguage('es');
    const { view } = mount();
    expect(view.getByText('TUYA')).toBeTruthy();
    expect(view.getByText('Tu IA.\nSin ataduras.')).toBeTruthy();
    expect(view.queryByText('YOURS')).toBeNull();
  });

  it('Back returns to where the list was opened', () => {
    const { view, route } = mount();
    fireEvent.press(view.getByTestId('onboarding-language'));
    fireEvent.press(view.getByLabelText('Back'));
    expect(route()).toBe('Onboarding');
  });
});
