function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function formatSpokenTime(d) {
  if (!d) return '';
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  if (minutes === 0) {
    return `${hours} ${ampm}`;
  }
  const minStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${minStr} ${ampm}`;
}

export function formatSpokenDate(d) {
  if (!d) return '';
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  const day = getOrdinal(d.getDate());
  return `${weekday}, ${month} ${day}`;
}

/** Check if user query is intended to create/modify/delete a calendar event */
export function isCalendarMutationIntent(text) {
  const msg = String(text || '').trim();
  if (!msg) return false;
  return (
    /\b(create|add|make|schedule|set\s*up|book|put|insert|new)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:calendar\s+)?(?:event|meeting|appointment|entry|session|sync)\b/i.test(msg) ||
    /\b(create|add|schedule|book|put)\s+(.+?)\s+(?:on|in|to)\s+(?:my\s+)?(?:calendar|schedule)\b/i.test(msg) ||
    /\bschedule\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:event|meeting|appointment|call|session|sync)\b/i.test(msg) ||
    /\b(delete|remove|cancel|drop)\s+(?:the\s+|my\s+|an\s+)?(?:event|meeting|appointment)\b/i.test(msg) ||
    /\b(reschedule|move|postpone|change)\s+(?:the\s+|my\s+|an\s+)?(?:event|meeting|appointment)\b/i.test(msg) ||
    /\b(create|add)\s+(?:an?\s+)?event\b/i.test(msg)
  );
}

/** Parse schedule/agenda voice intent from user text. */
export function parseScheduleIntent(text) {
  const msg = String(text || '').trim();
  if (isCalendarMutationIntent(msg)) {
    return null;
  }
  const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const matchedDay = daysOfWeek.find((d) => new RegExp(`\\b${d}\\b`, 'i').test(msg));
  const isNextDay = /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(msg);

  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const matchedMonthIndex = monthNames.findIndex((m) => new RegExp(`\\b${m}\\b`, 'i').test(msg));
  const matchedMonth = matchedMonthIndex !== -1 ? monthNames[matchedMonthIndex] : null;

  const yearMatch = msg.match(/\b(20\d\d)\b/);
  const matchedYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const currentYear = new Date().getFullYear();

  const isCrossCheck = /\b(cross-?check|double-?check|check\s+(it\s+)?(out\s+)?again|check\s+(my\s+)?calendar\s+again|check\s+(my\s+)?schedule\s+again|verify|are\s+you\s+sure|is\s+that\s+(really\s+)?correct|confirm\s+(my\s+)?schedule|missed|they\s+actually\s+this\s+week|both\s+this\s+week)\b/i.test(msg);

  const isScheduleQuery =
    isCrossCheck ||
    /\b(schedule|calendar|agenda|plans?|meetings?|events?|appointments?|jadwal|acara)\b/i.test(msg) ||
    /\b(what\s+do\s+i\s+have|what\x27?s\s+coming\s+up|what\s+is\s+coming\s+up|upcoming|ada\s+acara|ada\s+jadwal)\b/i.test(msg) ||
    /\b(what\s+about|how\s+about|about)\s+(today|tomorrow|this\s+week|next\s+week|this\s+month|next\s+month|this\s+year|next\s+year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|[a-z0-9]+)\b/i.test(msg) ||
    /\b(next\s+year|this\s+year|tahun\s+depan|tahun\s+ini|next\s+month|this\s+month|bulan\s+depan|bulan\s+ini|next\s+week|this\s+week|minggu\s+depan|minggu\s+ini|hari\s+ini|besok)\b/i.test(msg) ||
    /\bcheck\s+(my\s+)?(schedule|calendar|agenda|events?)\b/i.test(msg) ||
    /^(?:of\s+|about\s+)?(?:next\s+year|this\s+year|next\s+month|this\s+month|next\s+week|this\s+week|today|tomorrow|20\d\d)\.?$/i.test(msg) ||
    (matchedYear !== null && /\b(events?|schedule|calendar|in|for|plans?)\b/i.test(msg)) ||
    (matchedDay && /\b(on|for|this|next|what\s+about|how\s+about|anything\s+on|plans?\s+for)\s+[a-z]+\b/i.test(msg)) ||
    (matchedMonth !== null && /\b(in|for|on|during|what\s+about|how\s+about|schedule|calendar|events?)\b/i.test(msg)) ||
    (matchedMonth !== null && /^(?:in\s+|for\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\.?$/i.test(msg));

  if (!isScheduleQuery) return null;

  let range = 'week';
  if (/\b(next\s+year|tahun\s+depan)\b/i.test(msg) || (matchedYear && matchedYear > currentYear)) {
    range = 'next_year';
  } else if (/\b(this\s+year|tahun\s+ini)\b/i.test(msg) || (matchedYear && matchedYear === currentYear)) {
    range = 'year';
  } else if (matchedYear) {
    range = 'named_year';
  } else if (/\b(next\s+month|bulan\s+depan)\b/i.test(msg)) {
    range = 'next_month';
  } else if (matchedMonth !== null && !/\b(this\s+month|bulan\s+ini)\b/i.test(msg)) {
    range = 'named_month';
  } else if (/\b(this\s+month|month|bulan\s+ini)\b/i.test(msg) && !/\b(week|today|hari\s+ini)\b/i.test(msg)) {
    range = 'month';
  } else if (/\b(next\s+week|minggu\s+depan)\b/i.test(msg) || (isNextDay && matchedDay)) {
    range = 'next_week';
  } else if (/\b(tomorrow|besok)\b/i.test(msg)) {
    range = 'tomorrow';
  } else if (/\b(today|the\s+day|hari\s+ini)\b/i.test(msg) && !matchedDay && !/\b(week|this\s+week|next\s+week|minggu\s+ini|minggu\s+depan)\b/i.test(msg)) {
    range = 'today';
  } else {
    range = 'week';
  }

  return {
    range,
    targetDay: matchedDay || null,
    isNextDay,
    matchedMonth,
    matchedMonthIndex: matchedMonthIndex !== -1 ? matchedMonthIndex : null,
    matchedYear,
    isCrossCheck,
  };
}

export function parseDateOnlyIntent(text) {
  const msg = String(text || '');
  if (parseScheduleIntent(msg)) return false;
  if (/\b(weather|forecast|temperature|rain)\b/i.test(msg)) return false;
  return (
    /\bwhat('?s|\s+is)\s+(the\s+)?(date|day)\b/i.test(msg) ||
    /\bwhat('?s|\s+is)\s+(today'?s\s+)?(date|day)\b/i.test(msg) ||
    /\bwhat\s+day\s+(is\s+it|is\s+today)\b/i.test(msg)
  );
}

export function parseTimeIntent(text) {
  const msg = String(text || '').toLowerCase();
  if (parseDateOnlyIntent(text) || parseScheduleIntent(text)) return false;
  return (
    /\bwhat('?s|\s+is|\s+was)\s+(the\s+)?time\b/.test(msg) ||
    /\bwhat\s+time\s+(is\s+it|was\s+it)\b/.test(msg) ||
    /\b(current\s+time|tell\s+(me\s+)?the\s+time)\b/.test(msg) ||
    /\bdo\s+you\s+have\s+(the\s+)?time\b/.test(msg) ||
    /\btime\s+please\b/.test(msg)
  );
}

export function parseSystemIntent(text) {
  const msg = String(text || '').toLowerCase();
  const device = /(computer|mac|system|machine|pc|laptop|hardware|specs)/;
  return (
    /how\s+is\s+my\s+(computer|mac|system|machine|pc|laptop)(\s+(doing|performing|looking|running))?/.test(msg) ||
    /how('?s|\s+is)\s+my\s+(computer|mac|system|machine|pc|laptop)\s+(performing|doing|looking|running)/.test(msg) ||
    /what('?s|\s+is)\s+my\s+(computer|mac|system|machine|pc|laptop|stats)\s+(looking\s+like|status)/.test(msg) ||
    /(performance|performing|diagnostics|stats|health)/.test(msg) && device.test(msg) ||
    /system\s+(diagnostics|performance|stats|health|status)/.test(msg) ||
    /computer\s+(performing|stats|performance|status|health)/.test(msg) ||
    /\b(how\s+are|what\s+are)\s+(my\s+)?(stats|computer\s+stats|system\s+stats)\b/.test(msg) ||
    /\bcheck\s+(my\s+)?(computer|system|mac)?\s*(stats|status|diagnostics|health)\b/.test(msg)
  );
}

export function parseTasksIntent(text) {
  const msg = String(text || '');
  if (/^remind\s+me\s+to\b/i.test(msg.trim())) return false;
  return (
    /\b(my\s+tasks?|to-?do|checklist|what\s+(are\s+)?my\s+reminders)\b/i.test(msg) ||
    /\b(tasks?|reminders?)\s+(for\s+)?(today|the\s+day|this\s+week)\b/i.test(msg) ||
    /\b(what|show|list|check|any)\s+(are\s+)?(my\s+)?(tasks?|reminders?|to-?dos?)\b/i.test(msg) ||
    /^(tasks?|reminders?|to-?dos?)[.!?]*$/i.test(msg.trim())
  );
}

export function parseShowMusicWindowIntent(text) {
  const msg = String(text || '').trim();
  return /\b(open\s+youtube\s+music|show\s+(youtube\s+)?music|bring\s+up\s+(youtube\s+)?music|display\s+(youtube\s+)?music)\b/i.test(msg);
}

export function parseMusicActionIntent(text) {
  const msg = String(text || '').trim();
  if (!msg) return null;

  if (
    /\b(pause|hold|freeze)\s+(?:the\s+|my\s+)?(?:music|song|track|playback|playing)\b/i.test(msg) ||
    /^(?:please\s+)?pause(?:\s+(?:the\s+)?(?:music|song|track|it))?\.?$/i.test(msg) ||
    /\b(stop\s+(?:the\s+|my\s+)?(?:music|song|track|playing)|stop\s+playing)\b/i.test(msg) ||
    /^(?:please\s+)?stop\s+music\.?$/i.test(msg)
  ) {
    return 'pause';
  }

  if (
    /\b(resume|continue|unpause)\s+(?:the\s+|my\s+)?(?:music|song|track|playback)\b/i.test(msg) ||
    /^(?:please\s+)?(?:resume|unpause)(?:\s+(?:the\s+)?(?:music|song|track|it))?\.?$/i.test(msg)
  ) {
    return 'resume';
  }

  if (
    /\b(next\s+song|skip\s+song|skip\s+this\s+song|next\s+track|skip\s+track)\b/i.test(msg) ||
    /^(?:please\s+)?(?:next|skip)(?:\s+song)?\.?$/i.test(msg)
  ) {
    return 'next';
  }

  if (
    /\b(previous\s+song|prev\s+song|go\s+back\s+song|previous\s+track)\b/i.test(msg) ||
    /^(?:please\s+)?(?:previous|prev)(?:\s+song)?\.?$/i.test(msg)
  ) {
    return 'prev';
  }

  return null;
}

export function parseMusicIntent(text) {
  const msg = String(text || '').trim();
  if (!msg) return false;
  if (parseMusicActionIntent(msg)) return true;
  if (parseShowMusicWindowIntent(msg)) return true;
  if (
    /\b(play|give|put\s+on|queue|start|spin)\s+(me\s+|some\s+|a\s+|the\s+|my\s+)?(music|song|tunes|track)\b/i.test(msg) ||
    /\b(play|put\s+on|queue|start)\s+.+/i.test(msg) ||
    /\b(give|find|put)\s+(me\s+)?(the\s+)?(song|track|music)\b/i.test(msg) ||
    /\b(i('?d|\s+would)\s+like\s+to\s+(hear|play)|can\s+you\s+play|could\s+you\s+play|please\s+play)\b/i.test(msg) ||
    /^(me\s+)?(music|song|a\s+song|play\s+song|play\s+a\s+song)\.?$/i.test(msg) ||
    /\b(start\s+music|resume\s+music)\b/i.test(msg) ||
    /^(?:the\s+)?(?:song|track)\s+(.+?)(?:\s+by\s+.+)?\.?$/i.test(msg) ||
    /\bby\s+[a-zA-Z0-9\s.'&-]+(?:\s+on\s+(youtube\s+music|youtube|music))?\.?$/i.test(msg)
  ) {
    return true;
  }
  return false;
}

function scrubMusicQuery(raw) {
  let q = String(raw || '').trim();
  q = q.replace(/[?!.,]+$/g, '').trim();
  q = q.replace(/\s+for\s+me$/i, '').trim();
  q = q.replace(/\s+please$/i, '').trim();
  q = q.replace(/^(a\s+song\s+by|a\s+song\s+from|songs?\s+by)\s+/i, '');
  q = q.replace(/^(a\s+|some\s+|the\s+)?(music|song|tunes?|track)\s*(by\s+|from\s+)?/i, (_, _a, _b, by) => by || '');
  q = q.replace(/\s+on\s+(?:youtube\s+music|youtube|music)$/i, '').trim();
  return q.trim();
}

export function extractMusicQuery(text) {
  const msg = String(text || '').trim();
  if (parseShowMusicWindowIntent(msg)) return '__SHOW_WINDOW__';

  if (
    /^(?:me\s+)?(?:a\s+)?(?:music|song|tunes?|track)\.?$/i.test(msg) ||
    /\b(my\s+library|my\s+songs?|liked\s+songs?)\b/i.test(msg) ||
    /^(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:play|give\s+me|put\s+on|start)(?:\s+me)?\s+(?:a\s+|some\s+)?(?:random\s+)?(?:music|song|tunes?|track)\.?$/i.test(msg) ||
    /^(?:play\s+music|play\s+a\s+song|play\s+something|play\s+song)\.?$/i.test(msg) ||
    /^(?:me\s+)?music\.?$/i.test(msg)
  ) {
    return '__RANDOM__';
  }

  // 1. "play / put on / queue / start / give me [the song] X"
  let m = msg.match(
    /(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:play|put\s+on|queue|start|give|spin)\s+(?:me\s+)?(?:the\s+song\s+|the\s+track\s+|track\s+|song\s+)?(.+?)(?:\s+on\s+(?:youtube\s+music|youtube|music))?\.?$/i
  );
  if (m) {
    const raw = scrubMusicQuery(m[1]);
    if (raw && !/^(music|song|tunes?|track|something)$/i.test(raw)) {
      return raw;
    }
  }

  // 2. "I'd like to hear X" / "can you play X"
  m = msg.match(
    /(?:i(?:'d|\s+would)\s+like\s+to\s+(?:hear|play)|can\s+you\s+play|could\s+you\s+play|please\s+play)\s+(.+?)(?:\s+on\s+(?:youtube\s+music|youtube|music))?\.?$/i
  );
  if (m) {
    const raw = scrubMusicQuery(m[1]);
    if (raw && !/^(music|song|tunes?|track|something)$/i.test(raw)) {
      return raw;
    }
  }

  // 3. Clipped "the song X" or "song X"
  m = msg.match(/^(?:the\s+)?(?:song|track)\s+(.+?)(?:\s+on\s+(?:youtube\s+music|youtube|music))?\.?$/i);
  if (m) {
    const raw = scrubMusicQuery(m[1]);
    if (raw && !/^(music|song|tunes?|track|something)$/i.test(raw)) {
      return raw;
    }
  }

  // 4. Direct "[Title] by [Artist]"
  m = msg.match(/^(.+?)\s+by\s+(.+?)(?:\s+on\s+(?:youtube\s+music|youtube|music))?\.?$/i);
  if (m) {
    return scrubMusicQuery(m[0]);
  }

  return '__RANDOM__';
}

export function parseDueFromReminder(text) {
  const msg = String(text || '');
  const m = msg.match(/remind\s+me\s+(?:to\s+)?(.+?)(?:\s+(tomorrow|today|tonight|next\s+week))?\.?$/i);
  if (!m) return null;
  let title = m[1].trim();
  title = title.replace(/\s+(tomorrow|today|tonight|next\s+week)$/i, '').trim();
  const when = (m[2] || '').toLowerCase();
  const due = new Date();
  due.setHours(9, 0, 0, 0);
  if (when === 'tomorrow') due.setDate(due.getDate() + 1);
  else if (when === 'tonight') due.setHours(20, 0, 0, 0);
  else if (when === 'next week') due.setDate(due.getDate() + 7);
  return { title, dueAt: due.getTime(), remindAt: due.getTime() };
}

export function formatScheduleSpeech(scheduleIntent, calendarData, tasksData) {
  if (calendarData?.permissionDenied && !calendarData?.macConnected && !(calendarData?.events?.length > 0)) {
    return 'Sir, Google Calendar permission was not granted during sign-in. Please disconnect and reconnect your Google account in Settings, and make sure to check the box for Google Calendar.';
  }

  const range = scheduleIntent?.range || 'today';
  const targetDay = scheduleIntent?.targetDay || null;
  const isNextDay = Boolean(scheduleIntent?.isNextDay);
  const isCrossCheck = Boolean(scheduleIntent?.isCrossCheck);
  const events = Array.isArray(calendarData?.events) ? calendarData.events : [];
  const openTasks = Array.isArray(tasksData) ? tasksData.filter((t) => !t.completed) : [];

  let relevantEvents = events;
  if (targetDay) {
    relevantEvents = events.filter((e) => {
      if (!e.start) return false;
      const d = new Date(e.start);
      return d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() === targetDay.toLowerCase();
    });
  }

  const matchedMonth = scheduleIntent?.matchedMonth || null;
  const now = new Date();
  const nextMonthName = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'long' });

  const matchedYear = scheduleIntent?.matchedYear || null;
  const nextYearNumber = now.getFullYear() + 1;

  const rangeLabel = targetDay
    ? (isNextDay ? 'next ' : '') + targetDay.charAt(0).toUpperCase() + targetDay.slice(1)
    : range === 'next_year' || (matchedYear && matchedYear > now.getFullYear())
    ? `next year, in ${matchedYear || nextYearNumber}`
    : range === 'year' || (matchedYear && matchedYear === now.getFullYear())
    ? `this year, in ${now.getFullYear()}`
    : matchedYear
    ? `in ${matchedYear}`
    : range === 'next_month'
    ? `next month, in ${nextMonthName}`
    : range === 'named_month' && matchedMonth
    ? `in ${matchedMonth.charAt(0).toUpperCase() + matchedMonth.slice(1)}`
    : range === 'next_week'
    ? 'next week'
    : range === 'tomorrow'
    ? 'tomorrow'
    : range === 'today'
    ? 'today'
    : range === 'month'
    ? 'this month'
    : 'this week';

  if (relevantEvents.length > 0) {
    const count = relevantEvents.length;
    const items = relevantEvents.slice(0, 4).map((e) => {
      const d = e.start ? new Date(e.start) : null;
      const dateSpoken = d ? formatSpokenDate(d) : '';
      const timeStr = e.allDay
        ? 'all day'
        : d
        ? formatSpokenTime(d)
        : '';
      if (targetDay && !isNextDay) {
        return timeStr ? `${e.title} at ${timeStr}` : e.title;
      }
      return `${e.title} on ${dateSpoken}${timeStr ? ` at ${timeStr}` : ''}`;
    }).join(', and ');

    if (isCrossCheck) {
      if (count === 1) {
        return `I have double-checked your calendar, Sir. You have 1 event scheduled for ${rangeLabel}: ${items}. There are no other events on your schedule for ${rangeLabel}.`;
      }
      return `I have double-checked your calendar, Sir. You have ${count} events scheduled for ${rangeLabel}: ${items}.`;
    }

    return `You have ${count} event${count > 1 ? 's' : ''} on your schedule for ${rangeLabel}: ${items}, Sir.`;
  }

  if (isCrossCheck) {
    return `I have double-checked your calendar, Sir. You have no events scheduled for ${rangeLabel}. Your schedule is completely clear.`;
  }

  if (targetDay) {
    return `You have no events scheduled for ${rangeLabel}, Sir. Your calendar is clear on that day.`;
  }

  if (openTasks.length > 0 && range === 'today') {
    const taskCount = openTasks.length;
    const spoken = openTasks.slice(0, 8);
    const taskTitles =
      spoken.length === 1
        ? spoken[0].title
        : spoken.length === 2
          ? `${spoken[0].title} and ${spoken[1].title}`
          : `${spoken.slice(0, -1).map((t) => t.title).join(', ')}, and ${spoken[spoken.length - 1].title}`;
    return `You have no calendar events for ${rangeLabel}, Sir, but you have ${taskCount} pending task${taskCount > 1 ? 's' : ''}: ${taskTitles}.`;
  }

  return `You have no scheduled events for ${rangeLabel}, Sir. Your calendar is completely clear.`;
}

export function formatTasksSpeech(tasksData) {
  const open = Array.isArray(tasksData) ? tasksData.filter((t) => !t.completed) : [];
  if (open.length === 0) {
    return 'You have no open tasks, Sir. Your to-do list is completely clear.';
  }
  const count = open.length;
  const spoken = open.slice(0, 10);
  const titles =
    spoken.length === 1
      ? spoken[0].title
      : spoken.length === 2
        ? `${spoken[0].title} and ${spoken[1].title}`
        : `${spoken.slice(0, -1).map((t) => t.title).join(', ')}, and ${spoken[spoken.length - 1].title}`;
  const more =
    count > spoken.length ? ` That is the first ${spoken.length} of ${count}.` : '';
  return `You have ${count} pending task${count > 1 ? 's' : ''}: ${titles}.${more}`.replace(
    /\.\s*$/,
    ', Sir.'
  );
}

