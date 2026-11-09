const PLACE_BLOCKLIST =
  /^(the\s+)?(morning|evening|tonight|today|tomorrow|work|here|home|outside|this\s+week)$/i;

/** Voice/text weather intent — avoids bare "hot/cold/degrees" false positives. */
export function parseWeatherIntent(text) {
  const msg = String(text || '');
  if (
    /\b(weather|forecast|temperature|rain|raining|cloudy|sunny|snow|snowing|umbrella|humidity|wind)\b/i.test(
      msg
    )
  ) {
    return true;
  }
  if (/\bhow\s+(hot|cold|warm)\s+(is\s+it|outside|today)\b/i.test(msg)) return true;
  if (/\b(do\s+i\s+need|should\s+i\s+(take|bring|wear)).*(jacket|coat|umbrella)\b/i.test(msg)) {
    return true;
  }
  return false;
}

export function parseExplicitWeatherLocation(utterance) {
  const msg = String(utterance || '');
  const match = msg.match(
    /\b(?:weather|forecast|temperature|rain|cold|hot)\s+(?:in|at|for)\s+([a-zA-Z][a-zA-Z\s,'-]{1,40})/i
  );
  if (match) {
    let loc = match[1]
      .replace(/(?:today|now|tomorrow|tonight|this\s+week|please|sir)\.?$/gi, '')
      .trim();
    if (loc && !PLACE_BLOCKLIST.test(loc)) return loc;
  }
  const loose = msg.match(/(?:\bin|\bat|\bfor)\s+([a-zA-Z][a-zA-Z\s,'-]{2,40})/i);
  if (loose) {
    let loc = loose[1]
      .replace(/(?:today|now|tomorrow|tonight|this\s+week|please|sir)\.?$/gi, '')
      .trim();
    if (loc && !PLACE_BLOCKLIST.test(loc)) return loc;
  }
  return '';
}

export function readSettingsWeatherLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem('jarvis-settings') || '{}');
    if (saved.weatherLocation?.trim()) return saved.weatherLocation.trim();
  } catch {}
  return 'Haarlem, Netherlands';
}

const SESSION_LAST_KEY = 'jarvis-last-weather-location';

export function getSessionLastWeatherLocation() {
  try {
    return sessionStorage.getItem(SESSION_LAST_KEY) || '';
  } catch {
    return '';
  }
}

export function setSessionLastWeatherLocation(location) {
  if (!location?.trim()) return;
  try {
    sessionStorage.setItem(SESSION_LAST_KEY, location.trim());
  } catch {}
}

/**
 * Order: explicit in utterance → last queried this session → Settings default.
 */
export function resolveWeatherLocation(utterance) {
  const explicit = parseExplicitWeatherLocation(utterance);
  if (explicit) return explicit;
  const last = getSessionLastWeatherLocation();
  if (last) return last;
  return readSettingsWeatherLocation();
}
