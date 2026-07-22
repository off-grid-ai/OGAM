import { Alert, Linking } from 'react-native';

export interface ExternalLinkOptions {
  label?: string;
  fallback?: string;
}

/** Open an external destination and leave the user with an actionable fallback. */
export async function openExternalUrl(
  url: string,
  options: ExternalLinkOptions = {},
): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    const label = options.label ?? 'link';
    const fallback = options.fallback ? ` ${options.fallback}` : '';
    Alert.alert(
      'Could Not Open Link',
      `Your device could not open the ${label}.${fallback}`,
      [{ text: 'OK' }],
    );
    return false;
  }
}
