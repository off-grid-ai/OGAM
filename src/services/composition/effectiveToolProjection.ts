import {
  EffectiveToolProjectionService,
  catalogEntryToDefinition,
  openAIToolToDefinition,
  type EffectiveToolCandidate,
  type EffectiveToolProjectionInput,
} from '@offgrid/models';
import { applicationFacade } from '../applicationFacade';
import { AVAILABLE_TOOLS } from '../tools/registry';
import {
  getToolExtensions,
  subscribeToolExtensions,
} from '../tools/extensions';

function selectedToolIds(): string[] {
  try {
    const value = applicationFacade().models.settings.current().enabledTools;
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function candidates(): EffectiveToolCandidate[] {
  const builtIn: EffectiveToolCandidate[] = AVAILABLE_TOOLS.map(tool => ({
    definition: catalogEntryToDefinition(tool),
    surface: 'built-in',
    routing: 'built-in',
    activation: 'settings',
  }));
  const extensions = getToolExtensions();
  const pro = extensions.flatMap(extension =>
    (extension.getToolDefinitions?.() ?? []).map(tool => ({
      definition: catalogEntryToDefinition(tool),
      surface: 'pro' as const,
      routing: 'external' as const,
      activation: 'settings' as const,
    })),
  );
  const selectableNames = new Set(pro.map(entry => entry.definition.name));
  const remote = extensions.flatMap(extension => {
    try {
      return (extension.getOpenAISchemas?.() ?? [])
        .flatMap(schema => {
          const definition = openAIToolToDefinition(schema);
          return definition ? [definition] : [];
        })
        .filter(definition => !selectableNames.has(definition.name))
        .map(definition => ({
          definition,
          surface: 'remote' as const,
          routing: 'external' as const,
          activation: 'source' as const,
        }));
    } catch {
      return [];
    }
  });
  return [...builtIn, ...pro, ...remote];
}

function snapshot(): EffectiveToolProjectionInput {
  return { selectedToolIds: selectedToolIds(), candidates: candidates() };
}

function subscribe(listener: () => void): () => void {
  let extensionStops: Array<() => void> = [];
  const wireExtensions = () => {
    extensionStops.forEach(stop => stop());
    extensionStops = getToolExtensions()
      .map(extension => extension.subscribe?.(listener))
      .filter((stop): stop is () => void => typeof stop === 'function');
  };
  wireExtensions();
  const stopModels = applicationFacade().models.subscribe(listener);
  const stopRegistry = subscribeToolExtensions(() => {
    wireExtensions();
    listener();
  });
  return () => {
    stopModels();
    stopRegistry();
    extensionStops.forEach(stop => stop());
  };
}

let owner: EffectiveToolProjectionService | null = null;

/** The single Mobile composition of Shared's effective chat-tool projection. */
export function effectiveChatTools(): EffectiveToolProjectionService {
  owner ??= new EffectiveToolProjectionService({ snapshot, subscribe });
  return owner;
}
