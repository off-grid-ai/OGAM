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
    id: 'study_math',
    name: 'study_math',
    displayName: 'Study maths',
    description: 'Exact maths done in code, not by guessing. action: describe (mean, median, stdev of values), t_test (values, optional second, mu0, paired), regression (x, y), sample_size (margin, confidence), convert (value, from, to units), date (from, to or add_days, as YYYY-MM-DD), tvm (time value of money: give all of pv, fv, pmt, rate, nper except the one to solve). Lists are comma separated.',
    icon: 'percent',
    parameters: {
      action: { type: 'string', description: 'describe, t_test, regression, sample_size, convert, date or tvm', required: true },
      values: { type: 'string', description: 'Comma separated numbers' },
      second: { type: 'string', description: 'Second sample for t_test' },
      x: { type: 'string', description: 'Comma separated x values' },
      y: { type: 'string', description: 'Comma separated y values' },
      value: { type: 'string', description: 'Number to convert' },
      from: { type: 'string', description: 'Unit to convert from, or start date YYYY-MM-DD' },
      to: { type: 'string', description: 'Unit to convert to, or end date YYYY-MM-DD' },
      add_days: { type: 'string', description: 'Days to add to the from date' },
      margin: { type: 'string', description: 'Margin of error, e.g. 0.05' },
      confidence: { type: 'string', description: '0.80, 0.90, 0.95 or 0.99' },
      mu0: { type: 'string', description: 'Hypothesised mean for a one-sample t_test' },
      paired: { type: 'string', description: 'true for a paired t_test' },
      pv: { type: 'string', description: 'Present value' }, fv: { type: 'string', description: 'Future value' },
      pmt: { type: 'string', description: 'Payment per period' }, rate: { type: 'string', description: 'Rate per period, e.g. 0.05' },
      nper: { type: 'string', description: 'Number of periods' },
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
    id: 'update_project_document',
    name: 'update_project_document',
    displayName: 'Update project document',
    description: 'Create or update a named text document in this chat\'s project, shared with every chat in the project (for example "Current Progress"). Use mode "append" to add a dated note, "replace" to rewrite it. Only when the user asks or the project instructions say so.',
    icon: 'edit-3',
    parameters: {
      name: { type: 'string', description: 'Document name, e.g. Current Progress', required: true },
      content: { type: 'string', description: 'Text to write', required: true },
      mode: { type: 'string', description: 'append (default) or replace', enum: ['append', 'replace'] },
    },
  },
  {
    id: 'search_offline_library',
    name: 'search_offline_library',
    displayName: 'Offline Library',
    description: 'Search the offline encyclopedias on this phone (Wikipedia, medical wiki, iFixit repair guides, travel guides) and return article text. Works without internet.',
    icon: 'book',
    parameters: {
      query: {
        type: 'string',
        description: 'A few search words, e.g. "tetanus" or "solar charge controller"',
        required: true,
      },
    },
  },
  {
    id: 'list_files', name: 'list_files', displayName: 'List files',
    description: 'List files and folders on the phone. Default is the Atlas workspace folder.', icon: 'folder',
    parameters: { path: { type: 'string', description: 'Folder path (optional, relative to the workspace or absolute)' } },
  },
  {
    id: 'read_file', name: 'read_file', displayName: 'Read file',
    description: 'Read a text file (txt, md, html, csv, json, code) or the text of a PDF/Word file on the phone.', icon: 'file-text',
    parameters: {
      path: { type: 'string', description: 'File path', required: true },
      offset: { type: 'number', description: 'Character position to start from, for long files (default 0)' },
    },
  },
  {
    id: 'write_file', name: 'write_file', displayName: 'Write file',
    description: 'Create or change a text/markdown/html/csv file on the phone. The user is asked to approve first.', icon: 'edit',
    parameters: {
      path: { type: 'string', description: 'File path, e.g. notes/plan.md', required: true },
      content: { type: 'string', description: 'Full file content', required: true },
      append: { type: 'boolean', description: 'true to add to the end instead of replacing' },
    },
  },
  {
    id: 'create_web_page', name: 'create_web_page', displayName: 'Build web page',
    description: 'Build a web page or small website (complete HTML with CSS/JS inside) and open it for preview. The user approves first.', icon: 'globe',
    parameters: {
      name: { type: 'string', description: 'Site name', required: true },
      html: { type: 'string', description: 'Complete HTML document', required: true },
    },
  },
  {
    id: 'open_file', name: 'open_file', displayName: 'Open file',
    description: 'Open a file on the phone in the right app (browser, document viewer).', icon: 'external-link',
    parameters: { path: { type: 'string', description: 'File path', required: true } },
  },
  {
    id: 'calendar_events', name: 'calendar_events', displayName: 'Read calendar',
    description: "Read the user's calendar events.", icon: 'calendar',
    parameters: {
      days_ahead: { type: 'number', description: 'How many days ahead (default 7)' },
      days_back: { type: 'number', description: 'How many days back (default 0)' },
    },
  },
  {
    id: 'add_calendar_event', name: 'add_calendar_event', displayName: 'Add calendar event',
    description: 'Add an event to the calendar (opens the calendar app filled in for the user to save).', icon: 'calendar',
    parameters: {
      title: { type: 'string', description: 'Event title', required: true },
      start: { type: 'string', description: 'Start, ISO format like 2026-10-05T14:00', required: true },
      end: { type: 'string', description: 'End, ISO format (optional)' },
      location: { type: 'string', description: 'Location (optional)' },
    },
  },
  {
    id: 'draft_message', name: 'draft_message', displayName: 'Draft text or email',
    description: 'Open the Messages or Email app with a message already written, or the phone app with a number ready, for the user to send or call themselves. Nothing is sent or dialled by Atlas. Use when the user asks to text, email or call someone.', icon: 'send',
    parameters: {
      kind: { type: 'string', description: 'text, email or call', enum: ['text', 'email', 'call'], required: true },
      body: { type: 'string', description: 'The message (not needed for a call)' },
      to: { type: 'string', description: 'Phone number or email address (optional)' },
      subject: { type: 'string', description: 'Email subject (optional)' },
    },
  },
  {
    id: 'schedule_task', name: 'schedule_task', displayName: 'Schedule a task',
    description: 'Schedule something to happen later or repeatedly: a notification at that time, and the task runs when the user opens it (for example a reminder, a daily briefing, a plan). Use when the user says remind me, every morning, tomorrow at, each week.', icon: 'clock',
    parameters: {
      task: { type: 'string', description: 'What the AI should do at that time (a prompt). Leave empty for a daily briefing.' },
      time: { type: 'string', description: 'Time of day, like 07:30 or 7am', required: true },
      repeat: { type: 'string', description: 'once, daily, weekdays or weekly', enum: ['once', 'daily', 'weekdays', 'weekly'], required: true },
      weekday: { type: 'string', description: 'For weekly: monday ... sunday' },
      kind: { type: 'string', description: 'briefing for the daily news briefing, otherwise prompt', enum: ['prompt', 'briefing'] },
      name: { type: 'string', description: 'Short name (optional)' },
    },
  },
  {
    id: 'my_location', name: 'my_location', displayName: 'My location',
    description: "The user's GPS position (works offline) and the distance and direction to their saved places (camp, car, water...). Use for 'where am I', 'how far to camp', 'which way is the car'. It gives coordinates only: it does not know what is nearby, so never name airports, towns or landmarks from it.", icon: 'map-pin',
    parameters: {},
  },
  {
    id: 'remember', name: 'remember', displayName: 'Remember',
    description: 'Save a lasting fact about the user that they want you to remember in future chats (preferences, people, health, plans). Only when the user shares it or asks you to remember.', icon: 'bookmark',
    parameters: { fact: { type: 'string', description: 'One short fact', required: true } },
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
