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
You have full Mac control and Google Calendar/Gmail access through tools. When the user asks you to do something, respond naturally AND include a tool call using this format:

<<<TOOL:tool_name|param1=value1|param2=value2>>>

AVAILABLE TOOLS:
${includeWeather ? '- get_weather: Get live current weather and forecast via API without opening a browser. Params: location (optional, e.g. "Sportliedenbuurt", "Amsterdam", "New York", or leave empty for current local area)\n' : ''}- open_app: Open any application. Params: app_name (e.g. Safari, Chrome, Notes, Calendar, Mail, Spotify)
- open_url: Open a URL in the default browser. Params: url
- web_search: Search the internet for general info or news. Params: query
- take_screenshot: Capture the screen and save to Desktop. No params needed.
- volume_control: Adjust system volume. Params: action (up/down/mute/unmute/set), value (0-100 for set)
- brightness_control: Adjust screen brightness. Params: action (up/down)
- file_control: Manage files/folders. Params: action (list/read/write/delete/move/copy/create_folder/find), path, content (for write), destination (for move/copy), name (for find)
- run_shell: Execute a shell command. Params: command
- run_powershell: Alias for run_shell on macOS. Params: command
- get_system_info: Get system information. Params: type (processes/cpu/memory/disk/network/battery/uptime)
- close_app: Close a running application. Params: name
- system_power: System power management. Params: action (shutdown/restart/sleep/lock)
- open_folder: Open Finder at a path. Params: path (default: Desktop)
- search_files: Search for files by name. Params: query, path (default: home), extension (optional, e.g. .pdf)

GOOGLE CALENDAR (requires Connect Google in Settings):
- calendar_list_events: List upcoming events. Params: days (default 7), time_min, time_max, query, max_results
- calendar_create_event: Create an event. Params: summary, start (ISO datetime), end (ISO datetime), description, location, attendees (comma emails)
- calendar_update_event: Update an event. Params: event_id, summary, start, end, description, location
- calendar_delete_event: Delete an event (asks confirmation). Params: event_id

GMAIL (requires Connect Google in Settings):
- gmail_list: List inbox messages. Params: max_results, unread_only (true/false), query
- gmail_search: Search mail. Params: query, max_results
- gmail_read: Read a message. Params: message_id
- gmail_draft_reply: Create a draft reply. Params: message_id, body, to (optional), subject (optional)
- gmail_send: Send mail (asks confirmation). Params: draft_id OR to + subject + body

IMPORTANT RULES:
1. Always respond with natural language FIRST, then add the tool call at the end.
2. You can chain multiple tools in one response.
3. For destructive actions (delete files, kill processes, shutdown, delete events, send email), warn the user and still include the tool call — the system will ask for confirmation.
4. When tool results are returned to you, use them to give a helpful summary to the user.
5. For weather inquiries: NEVER say "Checking the weather", "Checking current conditions", or filler phrases. Immediately and directly state the actual weather (temperature and condition).
6. Use ISO 8601 datetimes for calendar start/end (e.g. 2026-10-03T15:00:00).
7. Paths use macOS style (/Users/...) or ~ for home.

EXAMPLES:
User: "Open Safari"
Response: Opening Safari for you. <<<TOOL:open_app|app_name=Safari>>>

${includeWeather ? `User: "What's the weather?"
Response: It is 17 degrees and foggy today, Sir. <<<TOOL:get_weather>>>

User: "What's the weather in Sportliedenbuurt?"
Response: It is currently 17 degrees with Fog in Sportliedenbuurt, Sir. <<<TOOL:get_weather|location=Sportliedenbuurt>>>

` : ''}
User: "What's on my calendar tomorrow?"
Response: Checking your calendar now. <<<TOOL:calendar_list_events|days=2>>>

User: "Create a meeting Friday at 3pm called Design sync"
Response: Creating that event. <<<TOOL:calendar_create_event|summary=Design sync|start=2026-10-03T15:00:00|end=2026-10-03T16:00:00>>>

User: "Summarize my unread email"
Response: Pulling your unread inbox. <<<TOOL:gmail_list|unread_only=true|max_results=10>>>

User: "Read email abc123"
Response: Opening that message. <<<TOOL:gmail_read|message_id=abc123>>>

User: "Set volume to 50%"
Response: Setting volume to 50%. <<<TOOL:volume_control|action=set|value=50>>>

User: "What apps are using the most CPU?"
Response: Checking processes. <<<TOOL:get_system_info|type=processes>>>

User: "Search for PDF files in Downloads"
Response: Searching Downloads. <<<TOOL:search_files|query=*|path=~/Downloads|extension=.pdf>>>
`.trim();
}
