import { ToolDefinition } from './types';

export const AVAILABLE_TOOLS: ToolDefinition[] = [
  {
    id: 'web_search',
    name: 'web_search',
    displayName: 'Web Search',
    description: 'Search the live web and return real-time result titles, snippets, and URLs. Use this for any question about current events, prices, weather, news, or anything that requires up-to-date information. When the snippet is insufficient, call read_url on the most relevant result URL to get the full page content.',
    icon: 'globe',
    requiresNetwork: true,
    parameters: {
      query: {
        type: 'string',
        description: 'Search query',
        required: true,
      },
    },
  },
  {
    id: 'calculator',
    name: 'calculator',
    displayName: 'Calculator',
    description: 'Evaluate math expressions',
    icon: 'hash',
    parameters: {
      expression: {
        type: 'string',
        description: 'Math expression',
        required: true,
      },
    },
  },
  {
    id: 'get_current_datetime',
    name: 'get_current_datetime',
    displayName: 'Date & Time',
    description: 'Get current date and time',
    icon: 'clock',
    parameters: {
      timezone: {
        type: 'string',
        description: 'IANA timezone, e.g. America/New_York',
      },
    },
  },
  {
    id: 'get_device_info',
    name: 'get_device_info',
    displayName: 'Device Info',
    description: 'Get device hardware info',
    icon: 'smartphone',
    parameters: {
      info_type: {
        type: 'string',
        description: 'Info type',
        enum: ['battery', 'storage', 'memory', 'all'],
      },
    },
  },
  {
    id: 'search_knowledge_base',
    name: 'search_knowledge_base',
    displayName: 'Knowledge Base',
    description: 'Search uploaded project documents',
    icon: 'book-open',
    parameters: {
      query: {
        type: 'string',
        description: 'Search query',
        required: true,
      },
    },
  },
  {
    id: 'search_memory',
    name: 'search_memory',
    displayName: 'Memory Search',
    description: 'Search the user-approved local memory store. Use this for personal preferences, prior research notes, decisions, open questions, and project context before guessing.',
    icon: 'database',
    parameters: {
      query: {
        type: 'string',
        description: 'Search query',
        required: true,
      },
    },
  },
  {
    id: 'save_memory',
    name: 'save_memory',
    displayName: 'Save Memory',
    description: 'Save a durable local memory only when the user explicitly asks you to remember something, or when a stable preference, decision, or research note will clearly help later. For laws, taxes, finance, medicine, or other time-sensitive topics, include jurisdiction and as_of_date when known.',
    icon: 'save',
    parameters: {
      title: {
        type: 'string',
        description: 'Short title for the memory',
        required: true,
      },
      body: {
        type: 'string',
        description: 'Precise memory content to save',
        required: true,
      },
      kind: {
        type: 'string',
        description: 'Memory kind',
        enum: ['preference', 'research_note', 'source_backed_fact', 'decision', 'open_question', 'procedure', 'personal_context'],
      },
      scope: {
        type: 'string',
        description: 'Memory scope. Use project when tied to the active project; use global for cross-project user preferences.',
        enum: ['project', 'global'],
      },
      tags: {
        type: 'string',
        description: 'Comma-separated tags',
      },
      jurisdiction: {
        type: 'string',
        description: 'Jurisdiction when relevant, for example United States, California, Portugal, or EU',
      },
      as_of_date: {
        type: 'string',
        description: 'Date the claim was known or researched, in YYYY-MM-DD when possible',
      },
    },
  },
  {
    id: 'forget_memory',
    name: 'forget_memory',
    displayName: 'Forget Memory',
    description: 'Delete a saved local memory by id when the user asks you to forget or remove it.',
    icon: 'trash-2',
    parameters: {
      memory_id: {
        type: 'string',
        description: 'Memory id to delete',
        required: true,
      },
    },
  },
  {
    id: 'run_python',
    name: 'run_python',
    displayName: 'Python',
    description: 'Execute Python 3.12 code in a sandboxed on-device interpreter and return stdout, stderr, and the value of the last expression. numpy and pandas are preinstalled and run fully offline. Installing other pure-Python packages reaches the network: import micropip, then await micropip.install("package") - top-level await is supported. Write a complete script and print() what you need to see. Variables persist between calls in the same session.',
    icon: 'terminal',
    // Core use (numpy/pandas) is offline, but micropip installs fetch from PyPI.
    // Flag it so the tool list shows the network indicator, matching the app's
    // transparency convention for any tool that can reach out.
    requiresNetwork: true,
    parameters: {
      code: {
        type: 'string',
        description: 'Python source code to execute',
        required: true,
      },
    },
  },
  {
    id: 'read_url',
    name: 'read_url',
    displayName: 'URL Reader',
    description: 'Fetch the full live content of any URL. Use this after web_search to read the complete text of a result page, or directly when the user shares a link.',
    icon: 'link',
    requiresNetwork: true,
    parameters: {
      url: {
        type: 'string',
        description: 'Full URL to fetch',
        required: true,
      },
    },
  },
];

export function getToolsAsOpenAISchema(enabledToolIds: string[]) {
  return AVAILABLE_TOOLS
    .filter(tool => enabledToolIds.includes(tool.id))
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(tool.parameters).map(([key, param]) => [
              key,
              {
                type: param.type,
                description: param.description,
                ...(param.enum ? { enum: param.enum } : {}),
              },
            ]),
          ),
          required: Object.entries(tool.parameters)
            .filter(([_, param]) => param.required)
            .map(([key]) => key),
        },
      },
    }));
}

export function buildToolSystemPromptHint(enabledToolIds: string[]): string {
  const enabledTools = AVAILABLE_TOOLS.filter(t => enabledToolIds.includes(t.id));
  if (enabledTools.length === 0) return '';

  const toolList = enabledTools.map(t => `- ${t.name}: ${t.description}`).join('\n');
  return `\n\nTools available:\n${toolList}\nUse these tools proactively and precisely — call the right tool at the right moment rather than guessing or saying you cannot help.`;
}
