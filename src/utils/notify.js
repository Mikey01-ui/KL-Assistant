/** Fire a HUD notification (NotificationStack listens for jarvis:notify). */
export function notify(message, levelOrOptions = 'info', tag = null) {
  if (!message) return;
  let level = 'info';
  let resolvedTag = tag;

  if (typeof levelOrOptions === 'object' && levelOrOptions !== null) {
    level = levelOrOptions.level || 'info';
    resolvedTag = levelOrOptions.tag || tag;
  } else if (typeof levelOrOptions === 'string') {
    level = levelOrOptions;
  }

  if (!resolvedTag) {
    const msg = String(message).toLowerCase();
    if (level === 'error') resolvedTag = 'ALERT';
    else if (msg.includes('reminder')) resolvedTag = 'REMINDER';
    else if (msg.includes('calendar') || msg.includes('meeting') || msg.includes('schedule') || msg.includes('event')) resolvedTag = 'CALENDAR';
    else if (msg.includes('music') || msg.includes('playing') || msg.includes('song') || msg.includes('track')) resolvedTag = 'MUSIC';
    else if (msg.includes('task')) resolvedTag = 'TASK';
    else if (msg.includes('note')) resolvedTag = 'NOTE';
    else if (msg.includes('system') || msg.includes('cpu') || msg.includes('battery') || msg.includes('volume')) resolvedTag = 'SYSTEM';
    else resolvedTag = 'NOTICE';
  }

  const payload = {
    message: String(message),
    level,
    tag: String(resolvedTag).toUpperCase(),
    at: Date.now(),
  };

  window.dispatchEvent(
    new CustomEvent('jarvis:notify', {
      detail: payload,
    })
  );

  try {
    window.electronAPI?.broadcastEvent?.('jarvis:notify', payload);
  } catch (_) {}
}
