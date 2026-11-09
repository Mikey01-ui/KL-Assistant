/**
 * Google Tasks / Google Reminders tool handlers.
 * Google migrated all Assistant / Calendar reminders into Google Tasks API.
 */
const { google } = require('googleapis');
const googleAuth = require('../googleAuth');
const localTasks = require('../taskService');

function tasksClient(auth) {
  return google.tasks({ version: 'v1', auth });
}

/**
 * List tasks from Google Tasks
 */
async function listGoogleTasks(params = {}) {
  try {
    const auth = await googleAuth.getAuthClient();
    const tasks = tasksClient(auth);
    const maxResults = Math.min(50, parseInt(params.max_results, 10) || 20);
    const showCompleted = params.show_completed === 'true' || params.showCompleted === true;

    const res = await tasks.tasks.list({
      tasklist: '@default',
      maxResults,
      showCompleted,
      showHidden: false,
    });

    const items = res.data.items || [];
    if (items.length === 0) {
      return { success: true, output: 'No active Google tasks or reminders found, Sir.', items: [] };
    }

    const lines = items.map((t, i) => {
      const due = t.due ? new Date(t.due).toLocaleString() : 'anytime';
      const status = t.status === 'completed' ? ' [Completed]' : '';
      const notes = t.notes ? `\n   Note: ${t.notes}` : '';
      return `${i + 1}. [${t.id}] ${t.title}${status} (due ${due})${notes}`;
    });

    return {
      success: true,
      output: `Found ${items.length} Google reminder(s) / task(s):\n\n${lines.join('\n')}`,
      items,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Create a task/reminder in Google Tasks
 */
async function createGoogleTask({ title, notes = '', dueAt = null }) {
  try {
    const auth = await googleAuth.getAuthClient();
    const tasks = tasksClient(auth);

    const requestBody = {
      title: String(title).trim(),
      notes: notes ? String(notes).trim() : undefined,
    };

    if (dueAt) {
      const d = new Date(dueAt);
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        requestBody.due = `${year}-${month}-${day}T00:00:00.000Z`;

        const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const timeNote = `Due Time: ${timeStr}`;
        if (!requestBody.notes) {
          requestBody.notes = timeNote;
        } else if (!requestBody.notes.includes('Due Time:')) {
          requestBody.notes = `${requestBody.notes}\n${timeNote}`;
        }
      }
    }

    console.log('[GoogleTasks] Inserting task into @default list:', requestBody);
    const res = await tasks.tasks.insert({
      tasklist: '@default',
      requestBody,
    });
    console.log('[GoogleTasks] Successfully inserted task:', res.data.id, res.data.title);

    return {
      success: true,
      task: res.data,
      id: res.data.id,
    };
  } catch (err) {
    console.error('[GoogleTasks] Failed to insert task:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Complete a task in Google Tasks
 */
async function completeGoogleTask(taskId) {
  try {
    const auth = await googleAuth.getAuthClient();
    const tasks = tasksClient(auth);

    const res = await tasks.tasks.patch({
      tasklist: '@default',
      task: taskId,
      requestBody: {
        status: 'completed',
        completed: new Date().toISOString(),
      },
    });

    return { success: true, task: res.data };
  } catch (err) {
    console.error('[GoogleTasks] Failed to complete task:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Delete a task in Google Tasks
 */
async function deleteGoogleTask(taskId) {
  try {
    const auth = await googleAuth.getAuthClient();
    const tasks = tasksClient(auth);

    await tasks.tasks.delete({
      tasklist: '@default',
      task: taskId,
    });

    return { success: true };
  } catch (err) {
    console.error('[GoogleTasks] Failed to delete task:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Reminder add tool handler:
 * Saves locally in SQLite, syncs to Google Tasks, and creates Google Calendar timed reminder.
 */
async function reminder_add(params, getMainWindow) {
  const title = params.title || params.summary || params.reminder || '';
  if (!title) return { success: false, error: 'Missing reminder title' };

  let dueAt = null;
  let remindAt = null;
  if (params.due_at) dueAt = new Date(params.due_at).getTime();
  if (params.remind_at) remindAt = new Date(params.remind_at).getTime();
  if (!remindAt && dueAt) remindAt = dueAt;
  if (!dueAt && remindAt) dueAt = remindAt;

  const notes = params.notes || '';

  // 1. Try sync to Google Tasks if connected
  let googleTaskId = null;
  let googleSynced = false;
  let syncError = null;

  try {
    if (googleAuth.isConnected()) {
      const gRes = await createGoogleTask({ title, notes, dueAt: dueAt || remindAt });
      if (gRes.success && gRes.id) {
        googleTaskId = gRes.id;
        googleSynced = true;
      } else if (gRes.error) {
        syncError = gRes.error;
        console.warn('[GoogleTasks] Sync warning:', gRes.error);
      }
    }
  } catch (e) {
    syncError = e.message;
    console.error('[GoogleTasks] Sync error:', e.message);
  }

  // 1b. Also insert into Google Calendar as a timed event for exact mobile notification chime
  try {
    if (googleAuth.isConnected() && dueAt) {
      const auth = await googleAuth.getAuthClient();
      const { google } = require('googleapis');
      const cal = google.calendar({ version: 'v3', auth });
      const d = new Date(dueAt);
      const endD = new Date(dueAt + 30 * 60 * 1000);
      await cal.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: `🔔 Reminder: ${title}`,
          description: `Reminder created by Alfred${notes ? `\n\nNotes: ${notes}` : ''}`,
          start: { dateTime: d.toISOString() },
          end: { dateTime: endD.toISOString() },
          reminders: {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: 0 }],
          },
        },
      });
      console.log('[GoogleCalendar] Reminder event inserted into calendar for exact notification at:', d.toISOString());
    }
  } catch (calErr) {
    console.warn('[GoogleCalendar] Reminder calendar sync warning:', calErr.message);
  }

  // 2. Save in local database
  const localTask = localTasks.addTask({
    title,
    dueAt,
    remindAt,
    notes,
    googleTaskId,
  });

  // Notify frontend HUD
  const win = getMainWindow?.();
  if (win) {
    win.webContents.send('tasks-updated');
  }

  const dueStr = dueAt ? ` for ${new Date(dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  let syncNotice = '';
  if (googleSynced) {
    syncNotice = ' (Synced with Google Tasks)';
  } else if (googleAuth.isConnected() && syncError) {
    if (/disabled|has not been used|enable it/i.test(syncError)) {
      syncNotice = ' (Local reminder saved; please enable Google Tasks API in Google Cloud Console)';
    } else if (/scope|insufficient|unauthorized/i.test(syncError)) {
      syncNotice = ' (Local reminder saved; Google Tasks requires re-authorization in Settings to sync to your phone)';
    } else {
      syncNotice = ' (Local reminder saved; Google sync pending)';
    }
  }

  return {
    success: true,
    output: `Reminder set: ${title}${dueStr}, Sir.${syncNotice}`,
    task: localTask,
    googleSynced,
  };
}

/**
 * Reminder list tool handler
 */
async function reminder_list(params) {
  // Query local tasks
  const localList = localTasks.listTasks({ limit: 10 });
  
  // If Google is connected, try to also fetch Google tasks
  let gCount = 0;
  if (googleAuth.isConnected()) {
    const gRes = await listGoogleTasks({ max_results: 10 });
    if (gRes.success && gRes.items) {
      gCount = gRes.items.length;
    }
  }

  if (!localList.length && gCount === 0) {
    return { success: true, output: 'You have no open tasks or reminders, Sir.' };
  }

  const lines = localList.map((t, i) => {
    const due = t.dueAt ? new Date(t.dueAt).toLocaleString() : 'anytime';
    const tag = t.googleTaskId ? ' 🌐' : '';
    return `${i + 1}. ${t.title}${tag} (due ${due})`;
  });

  return {
    success: true,
    output: `Here are your current reminders, Sir:\n${lines.join('\n')}`,
    tasks: localList,
  };
}

function createGoogleTasksHandlers(getMainWindow) {
  return {
    reminder_add: (params) => reminder_add(params, getMainWindow),
    reminder_list: (params) => reminder_list(params),
    google_tasks_list: (params) => listGoogleTasks(params),
  };
}

module.exports = {
  listGoogleTasks,
  createGoogleTask,
  completeGoogleTask,
  deleteGoogleTask,
  createGoogleTasksHandlers,
};
