import { t } from '@offgrid/i18n';
import type { Readiness } from '@offgrid/features';
import { showAlert, type AlertState } from '../../utils/alertState';
import { MODELS_TAB } from '../../hooks/useReadinessAction';

/**
 * A readiness line as an alert, for a send that cannot go: the shared line as the title and its
 * step as the button (Get a model opens Models on the right tab). Same words as the composer line.
 */
export function readinessAlert(readiness: Readiness, navigation: { navigate: (...args: any[]) => void }): AlertState {
  const action = readiness.action;
  const line = t(readiness.line, ...readiness.lineArgs);
  if (action?.kind !== 'get-model') return showAlert(line);
  return showAlert(line, undefined, [
    { text: t('Cancel'), style: 'cancel' },
    {
      text: t(action.label),
      style: 'primary',
      onPress: () => navigation.navigate('Main', { screen: 'ModelsTab', params: { initialTab: MODELS_TAB[action.tab] } }),
    },
  ]);
}
