/**
 * Open / close Choso Island notch from Alfred.
 */

const VALID = new Set(['calendar', 'tasks', 'home', 'music', 'shelf', 'clipboard']);

/** True after a focus until close — App.jsx closes notch when TTS finishes. */
let chosoSessionOpen = false;

export function isChosoSessionOpen() {
  return chosoSessionOpen;
}

export function markChosoSessionClosed() {
  chosoSessionOpen = false;
}

/**
 * @param {'calendar'|'tasks'|'home'|'music'|'shelf'|'clipboard'} tab
 * @param {{ day?: string, date?: string, hold?: number }} [opts]
 */
export async function openChosoTab(tab, opts = {}) {
  const normalized = tab === 'music' ? 'home' : tab;
  if (!VALID.has(normalized) && !VALID.has(tab)) {
    return { success: false, error: 'invalid tab' };
  }
  try {
    if (!window.electronAPI?.chosoFocus) {
      return { success: false, error: 'chosoFocus unavailable' };
    }
    const result = await window.electronAPI.chosoFocus({
      tab: normalized === 'home' ? 'home' : normalized,
      day: opts.day || undefined,
      date: opts.date || undefined,
      hold: opts.hold ?? 10,
    });
    if (result?.success !== false) {
      chosoSessionOpen = true;
    }
    return result;
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

export async function closeChosoTab() {
  chosoSessionOpen = false;
  try {
    return await window.electronAPI?.chosoClose?.();
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

/** Next calendar date (YYYY-MM-DD) for a weekday name like "friday". */
export function isoDateForWeekday(dayName, { isNext = false } = {}) {
  if (!dayName) return undefined;
  const map = {
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
  };
  const key = String(dayName).toLowerCase();
  if (key === 'today') {
    return new Date().toLocaleDateString('en-CA');
  }
  if (key === 'tomorrow') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('en-CA');
  }
  const target = map[key];
  if (target == null) return undefined;
  const now = new Date();
  const current = now.getDay();
  let delta = target - current;
  if (delta < 0) delta += 7;
  if (isNext) delta += 7; // "next Friday" → following week
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta);
  return d.toLocaleDateString('en-CA');
}
