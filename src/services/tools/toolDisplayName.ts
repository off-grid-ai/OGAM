import { AVAILABLE_TOOLS } from './registry';
import { getToolExtensions } from './extensions';

/**
 * A tool's name in words, for people: the registry's displayName, then an extension's, then the
 * model-facing id made readable ("search_docs" reads "Search docs"). Hand test 66 found the
 * chat's Details listing raw snake_case ids.
 */
export function toolDisplayName(id: string): string {
  const known = AVAILABLE_TOOLS.find(tool => tool.id === id)
    ?? getToolExtensions().flatMap(ext => ext.getToolDefinitions?.() ?? []).find(tool => tool.id === id);
  if (known?.displayName) return known.displayName;
  const words = id.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}
