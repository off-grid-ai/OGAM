/**
 * Sending fewer tools makes the first reply faster: the model has to read every tool's description before it can start
 * answering. Of the tools you have switched on, this keeps the ones the message could plausibly need, plus any tool used
 * earlier in the chat (a follow-up like "and tomorrow?" needs the same tool again). Tools it knows nothing about (added by
 * servers) are always kept: they are routed separately. A message that needs no tool sends none of the built-in ones.
 */
const ASKS_FACT = /\b(who|what|when|where|which|how many|how much|latest|news|today|tonight|now|current|price|cost|score|weather|forecast|search|look up|find out|google|http|www\.|\.com)\b/i;

const TRIGGERS: Record<string, RegExp> = {
  web_search: ASKS_FACT,
  read_url: /\b(http|www\.|\.com|\.org|link|url|article|page|website|site)\b/i,
  calculator: /\d|\b(calculate|compute|sum|total|percent|percentage|average|divide|multiply|plus|minus|times|tip|convert|squared|root)\b/i,
  get_current_datetime: /\b(time|date|day|today|tomorrow|yesterday|week|month|year|now|when|o'clock|am|pm|deadline|age|old)\b/i,
  get_device_info: /\b(battery|storage|memory|ram|device|phone|space|charging|free)\b/i,
  search_knowledge_base: /./, // handled below: kept whenever the project has documents
  update_project_document: /\b(update|add|note|log|progress|document|append|write down|record)\b/i,
  list_files: /\b(file|files|folder|directory|document|documents|download|downloads|list|show me what)\b/i,
  read_file: /\b(file|read|open|document|pdf|txt|csv|note|notes|contents?)\b/i,
  write_file: /\b(write|save|create|make|edit|file|document|markdown|csv|note|export|draft)\b/i,
  create_web_page: /\b(web ?page|website|html|landing|site|page)\b/i,
  open_file: /\b(open|show|view|display)\b/i,
  calendar_events: /\b(calendar|event|events|meeting|schedule|agenda|appointment|busy|free|plans|week|tomorrow|today)\b/i,
  add_calendar_event: /\b(calendar|event|meeting|appointment|schedule|remind|reminder|book|add)\b/i,
  my_location: /\b(where am i|location|gps|near|nearby|how far|direction|which way|camp|car|waypoint|coordinates|altitude)\b/i,
  remember: /\b(remember|don't forget|keep in mind|my name|i am|i'm|i like|i prefer|i live|i work|allergic|birthday)\b/i,
  schedule_task: /\b(remind|reminder|schedule|every (day|morning|evening|night|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|weekly|each (day|morning|week)|tomorrow at|at \d|alarm|notify)\b/i,
  draft_message: /\b(text|sms|email|e-mail|message|reply|send|write to|tell|call|phone|dial|ring)\b/i,
};

/** Tools worth sending with this message. `used` are tool names already used in the chat. */
export function relevantTools(message: string, enabled: string[], opts: { used?: string[]; projectHasDocs?: boolean } = {}): string[] {
  const used = new Set(opts.used ?? []);
  return enabled.filter((tool) => {
    if (used.has(tool)) return true;
    const trigger = TRIGGERS[tool];
    if (!trigger) return true; // not a built-in tool: kept (servers' tools are routed on their own)
    if (tool === 'search_knowledge_base') return !!opts.projectHasDocs;
    return trigger.test(message);
  });
}
