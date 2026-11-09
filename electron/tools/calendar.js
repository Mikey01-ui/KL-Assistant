/**
 * Google Calendar tool handlers.
 */
const { google } = require('googleapis');
const googleAuth = require('../googleAuth');
const { confirmAction } = require('../macTools');

function calendarClient(auth) {
  return google.calendar({ version: 'v3', auth });
}

function parseDate(input, endOfDay = false) {
  if (!input) return null;
  const str = String(input).trim().toLowerCase();
  const now = new Date();

  if (str === 'today') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endOfDay ? 23 : 9, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
    return d.toISOString();
  }
  if (str === 'tomorrow') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, endOfDay ? 23 : 9, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
    return d.toISOString();
  }

  // Accept ISO or loose strings; Date parses most ISO forms
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay && !/[T ]\d/.test(input)) {
    d.setHours(23, 59, 59, 999);
  }
  return d.toISOString();
}

async function calendar_list_events(params) {
  const auth = await googleAuth.getAuthClient();
  const cal = calendarClient(auth);
  const days = Math.min(30, Math.max(1, parseInt(params.days, 10) || 7));
  const timeMin = parseDate(params.time_min) || new Date().toISOString();
  const timeMax = parseDate(params.time_max, true) || new Date(Date.now() + days * 86400000).toISOString();
  const maxResults = Math.min(50, parseInt(params.max_results, 10) || 20);

  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults,
    q: params.query || undefined,
  });

  const events = res.data.items || [];
  if (events.length === 0) {
    return { success: true, output: `No events found between ${timeMin} and ${timeMax}.` };
  }

  const lines = events.map((ev, i) => {
    const start = ev.start?.dateTime || ev.start?.date || '?';
    const end = ev.end?.dateTime || ev.end?.date || '?';
    return `${i + 1}. [${ev.id}] ${start} → ${end}\n   ${ev.summary || '(no title)'}${ev.location ? `\n   Loc: ${ev.location}` : ''}${ev.description ? `\n   ${String(ev.description).slice(0, 120)}` : ''}`;
  });

  return {
    success: true,
    output: `Found ${events.length} event(s):\n\n${lines.join('\n\n')}`,
  };
}

async function calendar_create_event(params) {
  try {
    const summary = params.summary || params.title || '';
    if (!summary) return { success: false, error: 'Missing summary/title' };
    const startIso = parseDate(params.start || params.start_time);
    const endIso = parseDate(params.end || params.end_time);
    if (!startIso) return { success: false, error: 'Missing or invalid start time (use ISO datetime)' };
    const end = endIso || new Date(new Date(startIso).getTime() + 60 * 60 * 1000).toISOString();

    const auth = await googleAuth.getAuthClient();
    if (!auth) {
      return { success: false, error: 'Google Calendar is not connected. Please connect Google Calendar in Settings, Sir.' };
    }
    const cal = calendarClient(auth);
    const body = {
      summary,
      description: params.description || undefined,
      location: params.location || undefined,
      start: { dateTime: startIso },
      end: { dateTime: end },
    };
    if (params.attendees) {
      body.attendees = String(params.attendees)
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
        .map((email) => ({ email }));
    }

    const res = await cal.events.insert({ calendarId: 'primary', requestBody: body });
    const dateObj = new Date(res.data.start?.dateTime || res.data.start?.date || startIso);
    let hours = dateObj.getHours();
    const minutes = dateObj.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    const timeFormatted = minutes === 0 ? `${hours} ${ampm}` : `${hours}:${minutes < 10 ? '0' + minutes : minutes} ${ampm}`;
    const dateFormatted = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    return {
      success: true,
      output: `I have scheduled "${summary}" for ${dateFormatted} at ${timeFormatted}, Sir.`,
      event: res.data,
    };
  } catch (e) {
    console.error('calendar_create_event error:', e);
    return { success: false, error: e.message || 'Failed to create calendar event' };
  }
}

async function calendar_update_event(params) {
  const eventId = params.event_id || params.id;
  if (!eventId) return { success: false, error: 'Missing event_id' };

  const auth = await googleAuth.getAuthClient();
  const cal = calendarClient(auth);
  const existing = await cal.events.get({ calendarId: 'primary', eventId });
  const patch = { ...existing.data };

  if (params.summary || params.title) patch.summary = params.summary || params.title;
  if (params.description !== undefined) patch.description = params.description;
  if (params.location !== undefined) patch.location = params.location;
  if (params.start || params.start_time) {
    const startIso = parseDate(params.start || params.start_time);
    if (startIso) patch.start = { dateTime: startIso };
  }
  if (params.end || params.end_time) {
    const endIso = parseDate(params.end || params.end_time);
    if (endIso) patch.end = { dateTime: endIso };
  }

  const res = await cal.events.update({
    calendarId: 'primary',
    eventId,
    requestBody: patch,
  });

  return {
    success: true,
    output: `Updated event "${res.data.summary}" [${res.data.id}]`,
  };
}

async function calendar_delete_event(params, getMainWindow) {
  const eventId = params.event_id || params.id;
  if (!eventId) return { success: false, error: 'Missing event_id' };

  const confirmed = await confirmAction(
    getMainWindow(),
    `Delete calendar event ${eventId}? This cannot be undone.`
  );
  if (!confirmed) return { success: false, output: 'Action cancelled by user.' };

  const auth = await googleAuth.getAuthClient();
  const cal = calendarClient(auth);
  await cal.events.delete({ calendarId: 'primary', eventId });
  return { success: true, output: `Deleted event ${eventId}` };
}

/** Structured events for HUD agenda (Google Calendar). */
async function calendar_fetch_structured(params = {}) {
  try {
    const auth = await googleAuth.getAuthClient();
    const cal = calendarClient(auth);
    const days = Math.min(30, Math.max(1, parseInt(params.days, 10) || 14));
    const timeMin = parseDate(params.time_min) || new Date().toISOString();
    const timeMax =
      parseDate(params.time_max, true) ||
      new Date(Date.now() + days * 86400000).toISOString();
    const maxResults = Math.min(50, parseInt(params.max_results, 10) || 30);

    let allItems = [];
    const seenIds = new Set();

    // 1. Fetch from primary calendar
    try {
      console.log(`[Google Calendar] Fetching primary calendar between ${timeMin} and ${timeMax}...`);
      const res = await cal.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults,
        q: params.query || undefined,
      });
      const items = res.data.items || [];
      console.log(`[Google Calendar] Primary calendar returned ${items.length} event(s).`);
      for (const item of items) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          allItems.push(item);
        }
      }
    } catch (e) {
      console.warn('[Calendar] Primary calendar error:', e.message);
      if (/Insufficient Permission/i.test(e.message)) {
        return {
          success: false,
          events: [],
          googleConnected: true,
          permissionDenied: true,
          error: 'Google Calendar permission denied. Please reconnect your Google account in Settings and ensure the Calendar permission checkbox is checked.',
        };
      }
    }

    // 2. Also fetch from other user calendars (secondary or imported)
    try {
      const calListRes = await cal.calendarList.list();
      const calendars = (calListRes.data.items || []).filter(c => c.id !== 'primary' && !c.deleted);
      console.log(`[Google Calendar] Found ${calendars.length} additional calendar(s):`, calendars.map(c => c.summary || c.id));
      for (const c of calendars) {
        try {
          const res = await cal.events.list({
            calendarId: c.id,
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 20,
          });
          const items = res.data.items || [];
          console.log(`[Google Calendar] Calendar "${c.summary || c.id}" returned ${items.length} event(s).`);
          for (const item of items) {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              allItems.push(item);
            }
          }
        } catch (calErr) {
          console.warn(`[Google Calendar] Secondary calendar ${c.summary || c.id} error:`, calErr.message);
        }
      }
    } catch (listErr) {
      console.warn('[Google Calendar] calendarList.list error:', listErr.message);
    }

    // Sort chronologically
    allItems.sort((a, b) => {
      const tA = new Date(a.start?.dateTime || a.start?.date || 0).getTime();
      const tB = new Date(b.start?.dateTime || b.start?.date || 0).getTime();
      return tA - tB;
    });

    const events = allItems.map((ev) => ({
      id: ev.id,
      title: ev.summary || '(no title)',
      start: ev.start?.dateTime || ev.start?.date || null,
      end: ev.end?.dateTime || ev.end?.date || null,
      location: ev.location || '',
      allDay: Boolean(ev.start?.date && !ev.start?.dateTime),
    }));

    console.log(`[Google Calendar] Successfully fetched ${events.length} event(s) between ${timeMin} and ${timeMax}.`);
    if (events.length > 0) {
      console.log('[Google Calendar] Events:', events.map(e => `${e.start} -> ${e.title}`));
    }

    return { success: true, events, googleConnected: true };
  } catch (e) {
    const msg = e.message || String(e);
    console.error('[Google Calendar] Fetch error:', msg);
    const needsAuth = /invalid_grant|not connected|ENOENT|credentials/i.test(msg);
    return {
      success: false,
      events: [],
      googleConnected: !needsAuth,
      error: needsAuth ? 'Google Calendar not connected' : msg,
    };
  }
}

function createCalendarHandlers(getMainWindow) {
  return {
    calendar_list_events: (params) => calendar_list_events(params),
    calendar_create_event: (params) => calendar_create_event(params),
    calendar_update_event: (params) => calendar_update_event(params),
    calendar_delete_event: (params) => calendar_delete_event(params, getMainWindow),
  };
}

module.exports = { createCalendarHandlers, calendar_fetch_structured };
