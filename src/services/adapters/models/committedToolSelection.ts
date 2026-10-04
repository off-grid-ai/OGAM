import { applicationFacade } from '@offgrid/core/services/applicationFacade';

/**
 * The one Mobile projection of the committed tool selection.
 *
 * Shared Models settings owns the record; this only narrows the `enabledTools` value to the string
 * ids a Mobile reader can use. Both readers of that selection - the chat tool resolver
 * (`mobileChatHostPort`) and the Pro email/calendar extension - call this, so a selection changed on
 * another device or applied by a remote sync patch decides both. No app-store slice, no mirror, no
 * fallback list: the store's `settings.enabledTools` is a projection it may not have observed yet,
 * and reading it made the two resolvers disagree about which tools exist.
 *
 * Fail closed, in both directions:
 * - malformed (absent, not an array, non-string entries) narrows to no ids;
 * - not ready (the application root is not composed yet) yields no ids rather than throwing, because
 *   these readers run inside the core loop's synchronous prompt/schema build, where a throw would
 *   abort the whole turn - including tools the caller does not own - instead of withholding some.
 * Either way the user gets no tool, never an unauthorised one.
 */
export function committedEnabledToolIds(): string[] {
  let value: unknown;
  try {
    value = applicationFacade().models.settings.current().enabledTools;
  } catch {
    return [];
  }
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}
