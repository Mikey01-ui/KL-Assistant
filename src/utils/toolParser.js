/**
 * toolParser.js — Parse AI responses for tool calls
 * 
 * Format:
 *   <<<TOOL:tool_name|param1=value1|param2=value2>>>
 */

const TOOL_TAG_REGEX = /<<<TOOL:([a-zA-Z0-9_]+)(?:\|([\s\S]*?))?>>>/g;

/**
 * Safely parses key-value parameter string respecting quotes and internal pipes/arrows.
 */
function parseParameterString(paramStr) {
  const params = {};
  if (!paramStr || !paramStr.trim()) return params;

  // Tokenize parameters: a pipe delimiter occurs when NOT inside quotes
  // and immediately followed by `param_name=` identifier pattern.
  const pairs = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < paramStr.length; i++) {
    const char = paramStr[i];

    if ((char === '"' || char === "'" || char === '`') && (i === 0 || paramStr[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      }
      current += char;
      continue;
    }

    if (char === '|' && !inQuotes) {
      const remainder = paramStr.slice(i + 1).trim();
      if (/^[a-zA-Z0-9_]+\s*=/.test(remainder)) {
        pairs.push(current);
        current = '';
        continue;
      }
    }

    current += char;
  }
  if (current.trim()) pairs.push(current);

  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      const key = pair.slice(0, eqIdx).trim();
      let val = pair.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'")) ||
          (val.startsWith('`') && val.endsWith('`'))) {
        val = val.slice(1, -1);
      }
      params[key] = val;
    }
  }

  return params;
}

/**
 * Parse an AI response string for embedded tool calls.
 * @param {string} response - Raw AI response text
 * @returns {{ displayText: string, tools: Array<{ name: string, params: object }> }}
 */
export function parseToolCalls(response) {
  if (!response) return { displayText: '', tools: [] };

  const tools = [];
  TOOL_TAG_REGEX.lastIndex = 0;
  let match;

  while ((match = TOOL_TAG_REGEX.exec(response)) !== null) {
    const name = match[1];
    const rawParams = match[2] || '';
    const params = parseParameterString(rawParams);
    tools.push({ name, params });
  }

  const displayText = response.replace(TOOL_TAG_REGEX, '').trim();
  return { displayText, tools };
}

/**
 * Strip tool calls from text for TTS and display
 */
export function stripToolTokens(text) {
  if (!text) return '';
  return text
    .replace(TOOL_TAG_REGEX, '')
    .replace(/<<<TOOL:[^>]*$/g, '')
    .trim();
}

/**
 * Check if a response contains any tool calls
 */
export function hasToolCalls(response) {
  if (!response) return false;
  TOOL_TAG_REGEX.lastIndex = 0;
  return TOOL_TAG_REGEX.test(response);
}

/**
 * Build the tool schema section for the AI system prompt.
 */
export function getToolSystemPrompt(options = {}) {
  const includeWeather = !options.excludeWeather;
  return `
To control Mac or manage agenda, append: <<<TOOL:name|param=val>>>
TOOLS:
${includeWeather ? '- get_weather: location\n' : ''}- music_play: query (song/artist name, or empty to shuffle). NEVER ask which song — play immediately.
- task_add: title, due_at (ISO)
- task_list: none
- task_complete: id
- reminder_add: title, due_at (ISO)
- reminder_list: none
- note_take: title, content
- note_list: none
- note_search: query
- open_app: app_name
- open_url: url
- web_search: query
- take_screenshot: none
- volume_control: action (up/down/mute/set), value (0-100)
- brightness_control: action (up/down)
- calendar_list_events: days, query
- calendar_create_event: summary, start (ISO), end (ISO)
- calendar_delete_event: event_id
- gmail_list: max_results, query, unread_only (true/false)
- gmail_search: query
- gmail_read: message_id
- gmail_draft_reply: message_id, body
- gmail_send: to, subject, body
- gmail_organize_inbox: max_results
- gmail_find_unreplied: days
- gmail_mark_spam: message_ids
- gmail_archive: message_ids
EXAMPLES:
User: Remind me to call someone / Remind me to call Kenneth
Response: Certainly, Sir. What time would you like me to remind you?
User: At 4pm tomorrow
Response: Setting a reminder to call Kenneth for 4 PM tomorrow, Sir. <<<TOOL:reminder_add|title=Call Kenneth|due_at=2026-10-21T16:00:00>>>
User: Remind me to call John at 4pm
Response: Setting a reminder to call John for 4 PM today, Sir. <<<TOOL:reminder_add|title=Call John|due_at=2026-10-20T16:00:00>>>
User: What are my reminders?
Response: Checking your reminders now, Sir. <<<TOOL:reminder_list>>>
User: Open my calendar / Show my calendar
Response: Opening Google Calendar for you now, Sir. <<<TOOL:open_url|url=https://calendar.google.com>>>
User: Open my reminders / Open my tasks / Show my to-do list
Response: Opening your Google Tasks now, Sir. <<<TOOL:open_url|url=https://tasks.google.com>>>
User: Open my notes / Show my notes
Response: Opening your notes now, Sir. <<<TOOL:open_app|app_name=Notes>>>
User: Take a note: Discuss Q4 targets with the board
Response: Taking that note for you, Sir. <<<TOOL:note_take|title=Q4 targets|content=Discuss Q4 targets with the board>>>
User: What are my notes?
Response: Checking your notes now, Sir. <<<TOOL:note_list>>>
User: What was my note about Q4?
Response: Searching your notes for Q4, Sir. <<<TOOL:note_search|query=Q4>>>
User: Schedule a team sync today at 3pm
Response: I will schedule your team sync for 3 PM today, Sir. <<<TOOL:calendar_create_event|summary=Team sync|start=2026-10-20T15:00:00|end=2026-10-20T16:00:00>>>
User: Add doctor appointment tomorrow at 10am
Response: Adding your doctor appointment for 10 AM tomorrow, Sir. <<<TOOL:calendar_create_event|summary=Doctor appointment|start=2026-10-21T10:00:00|end=2026-10-21T11:00:00>>>
User: Check my emails
Response: Checking your inbox now, Sir. <<<TOOL:gmail_list|max_results=5|unread_only=false>>>
User: Sort my emails / Organize my inbox
Response: Analyzing and organizing your inbox now, Sir. <<<TOOL:gmail_organize_inbox|max_results=15>>>
User: What important emails did I forget to reply to?
Response: Checking for any important emails awaiting your reply, Sir. <<<TOOL:gmail_find_unreplied|days=14>>>
User: Move email 18f23a to spam
Response: Moving that email to spam, Sir. <<<TOOL:gmail_mark_spam|message_ids=18f23a>>>
User: Search emails about invoice
Response: Searching for emails concerning invoices, Sir. <<<TOOL:gmail_search|query=invoice>>>
RULES:
1. Respond naturally in 1 spoken sentence first, then append <<<TOOL:...>>> when an action is needed.
2. If the user asks to be reminded of something or create a reminder/task without specifying a time or date (e.g. "remind me to call someone", "remind me to call Daniel tomorrow"), do NOT invent a time or assume 9:00 AM. Instead, ask politely: "Certainly, Sir. What time would you like me to remind you?" When Sir clarifies the time in the next turn (e.g. "at 4pm"), if Sir originally specified "tomorrow" in the earlier turn, you MUST use tomorrow's date for due_at (e.g. 2026-10-21T16:00:00). Do NOT set it for today! Only invoke reminder_add once Sir provides the time, or if Sir explicitly says "anytime" or "just add it to my list".
3. If the user asks to create or schedule a calendar event without providing a title or time (e.g. "create an event for me today"), do NOT invent random titles or times. Instead, politely ask Sir what he would like the event to be called and what time it should take place.
4. When the user asks to open or view their calendar, open Google Calendar via <<<TOOL:open_url|url=https://calendar.google.com>>>. When the user asks to open reminders or tasks, open Google Tasks via <<<TOOL:open_url|url=https://tasks.google.com>>>. When the user asks to open notes, open <<<TOOL:open_app|app_name=Notes>>>.
5. NEVER make empty promises like "I will check your calendar" or "Checking for you". Either invoke the tool immediately or answer directly.
6. MUSIC: If Sir names a song/artist, call <<<TOOL:music_play|query=...>>> immediately and say only "Alright, playing <title>." If no title is given, call music_play with an empty query and say "Alright, playing a song." NEVER ask which song they would like.`.trim();
}
