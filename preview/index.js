// The translation preview's entry: the app's screens in a browser, in the language the translate editor
// (or ?lang=) asks for. See preview/metro.preview.config.js.
//
//   index.html?lang=de             the app in German, from catalogs/de/{common,mobile}.json beside the page
//   index.html?route=onboarding    first run (otherwise: onboarding done, one model, Pro on: keychain.js)
//
// The editor (the parent frame) sends { type: 'offgrid-i18n', locale, strings } as a person types; the app
// remounts with the new text.
import './web-shims'; // first: App starts listeners as it loads
import './demo-state'; // before App: the saved state the app starts from
import React, { useEffect, useState } from 'react';
import { AppRegistry } from 'react-native';
import { setCatalog } from '@offgrid/i18n';
import App from '../App';

const params = new URLSearchParams(window.location.search);

async function loadCatalog(code) {
  const read = async file => {
    const res = await fetch(`./catalogs/${code}/${file}.json`);
    return res.ok ? res.json() : {};
  };
  const [common, mobile] = await Promise.all([read('common'), read('mobile')]);
  return { ...common, ...mobile };
}

function Preview() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const apply = (locale, strings) => {
      setCatalog(locale, strings);
      document.documentElement.lang = locale;
      setVersion(v => v + 1);
    };
    const lang = params.get('lang');
    if (lang) loadCatalog(lang).then(strings => apply(lang, strings));
    const onMessage = event => {
      const data = event.data;
      // The editor serves this preview from its own address, so only that origin may send a catalog.
      if (
        event.origin === window.location.origin &&
        event.source === window.parent &&
        data &&
        data.type === 'offgrid-i18n'
      )
        apply(data.locale, data.strings);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage(
      { type: 'offgrid-i18n:ready', app: 'mobile' },
      window.location.origin,
    );
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return <App key={version} />;
}

AppRegistry.registerComponent('OffGridPreview', () => Preview);
AppRegistry.runApplication('OffGridPreview', {
  rootTag: document.getElementById('root'),
});
