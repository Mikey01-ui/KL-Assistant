/**
 * High-Accuracy Weather Engine for JARVIS / Alfred
 * Primary: Open-Meteo API (national meteorological radar & model data, zero rate-limits, zero hallucinations).
 * Fallback: wttr.in with strict country/city routing (avoids ISP IP proxy misidentification).
 * Default Location: Haarlem, Netherlands.
 */

const https = require('https');
const http = require('http');

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    const req = protocol.get(url, {
      headers: { 'User-Agent': 'AlfredWeather/1.0' },
      timeout: options.timeout || 8000,
      ...options,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Failed to parse JSON response: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Weather request timed out'));
    });
  });
}

// Fixed coordinates for frequent cities to ensure sub-100ms response & 100% accuracy
const KNOWN_COORDINATES = {
  'haarlem': { name: 'Haarlem, Netherlands', lat: 52.3808, lon: 4.6368 },
  'harlem': { name: 'Haarlem, Netherlands', lat: 52.3808, lon: 4.6368 }, // Normalizes common English spelling
  'haarlem, netherlands': { name: 'Haarlem, Netherlands', lat: 52.3808, lon: 4.6368 },
  'amsterdam': { name: 'Amsterdam, Netherlands', lat: 52.3740, lon: 4.8897 },
  'rotterdam': { name: 'Rotterdam, Netherlands', lat: 51.9244, lon: 4.4777 },
  'utrecht': { name: 'Utrecht, Netherlands', lat: 52.0907, lon: 5.1214 },
  'the hague': { name: 'The Hague, Netherlands', lat: 52.0705, lon: 4.3007 },
  'den haag': { name: 'The Hague, Netherlands', lat: 52.0705, lon: 4.3007 },
  'london': { name: 'London, United Kingdom', lat: 51.5074, lon: -0.1278 },
  'paris': { name: 'Paris, France', lat: 48.8566, lon: 2.3522 },
  'new york': { name: 'New York, United States', lat: 40.7128, lon: -74.0060 },
};

const WMO_CODE_MAP = {
  0: { desc: 'Clear', icon: 'sunny' },
  1: { desc: 'Mainly Clear', icon: 'sunny' },
  2: { desc: 'Partly Cloudy', icon: 'partly-cloudy' },
  3: { desc: 'Overcast', icon: 'cloudy' },
  45: { desc: 'Foggy', icon: 'fog' },
  48: { desc: 'Rime Fog', icon: 'fog' },
  51: { desc: 'Light Drizzle', icon: 'rain' },
  53: { desc: 'Drizzle', icon: 'rain' },
  55: { desc: 'Dense Drizzle', icon: 'rain' },
  61: { desc: 'Slight Rain', icon: 'rain' },
  63: { desc: 'Moderate Rain', icon: 'rain' },
  65: { desc: 'Heavy Rain', icon: 'rain' },
  71: { desc: 'Slight Snow', icon: 'snow' },
  73: { desc: 'Moderate Snow', icon: 'snow' },
  75: { desc: 'Heavy Snow', icon: 'snow' },
  77: { desc: 'Snow Grains', icon: 'snow' },
  80: { desc: 'Rain Showers', icon: 'rain' },
  81: { desc: 'Moderate Showers', icon: 'rain' },
  82: { desc: 'Heavy Showers', icon: 'rain' },
  85: { desc: 'Snow Showers', icon: 'snow' },
  86: { desc: 'Heavy Snow Showers', icon: 'snow' },
  95: { desc: 'Thunderstorm', icon: 'thunder' },
  96: { desc: 'Thunderstorm with Hail', icon: 'thunder' },
  99: { desc: 'Severe Thunderstorm', icon: 'thunder' },
};

function parseWttrCondition(desc) {
  const d = (desc || '').toLowerCase();
  if (d.includes('thunder') || d.includes('storm')) return 'thunder';
  if (d.includes('snow') || d.includes('sleet') || d.includes('ice') || d.includes('blizzard')) return 'snow';
  if (d.includes('rain') || d.includes('drizzle') || d.includes('shower')) return 'rain';
  if (d.includes('fog') || d.includes('mist') || d.includes('haze')) return 'fog';
  if (d.includes('partly') || d.includes('scattered')) return 'partly-cloudy';
  if (d.includes('cloud') || d.includes('overcast')) return 'cloudy';
  return 'sunny';
}

const weatherCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Geocode city using Open-Meteo geocoding API
 */
async function geocodeLocation(cityName) {
  const key = cityName.toLowerCase().trim();
  if (KNOWN_COORDINATES[key]) return KNOWN_COORDINATES[key];

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1`;
    const data = await fetchJson(url, { timeout: 4000 });
    if (data?.results && data.results.length > 0) {
      const r = data.results[0];
      const fullName = `${r.name}${r.country ? `, ${r.country}` : ''}`;
      return { name: fullName, lat: r.latitude, lon: r.longitude };
    }
  } catch (_) {}
  return null;
}

/**
 * Fetch from Open-Meteo (Primary Engine)
 */
async function fetchFromOpenMeteo(coords) {
  const { lat, lon, name } = coords;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
  const data = await fetchJson(url, { timeout: 5000 });

  const c = data?.current;
  const d = data?.daily;
  if (!c || !d) throw new Error('Invalid Open-Meteo payload');

  const code = c.weather_code;
  const meta = WMO_CODE_MAP[code] || { desc: 'Clear', icon: 'sunny' };
  const temp = Math.round(c.temperature_2m);
  const tempF = Math.round((c.temperature_2m * 9) / 5 + 32);
  const high = Math.round(d.temperature_2m_max[0]);
  const low = Math.round(d.temperature_2m_min[0]);
  const humidity = Math.round(c.relative_humidity_2m);
  const windSpeed = `${Math.round(c.wind_speed_10m)} km/h`;

  return {
    location: name,
    temperature: temp,
    temperatureF: tempF,
    tempUnit: '°',
    condition: meta.desc,
    high,
    low,
    humidity,
    windSpeed,
    icon: meta.icon,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Fetch from wttr.in (Secondary Engine fallback)
 */
async function fetchFromWttr(cityName) {
  const url = `https://wttr.in/${encodeURIComponent(cityName)}?format=j1`;
  const data = await fetchJson(url, { timeout: 6000 });

  const current = data.current_condition[0];
  const today = data.weather[0];
  const area = data.nearest_area?.[0];

  const detectedCity = area?.areaName?.[0]?.value || area?.region?.[0]?.value || cityName;
  const temp = parseInt(current.temp_C, 10);
  const tempF = parseInt(current.temp_F, 10);
  const high = parseInt(today.maxtempC, 10);
  const low = parseInt(today.mintempC, 10);
  const condition = current.weatherDesc?.[0]?.value || 'Clear';
  const humidity = parseInt(current.humidity, 10);
  const windSpeed = `${current.windspeedKmph} km/h`;
  const icon = parseWttrCondition(condition);

  return {
    location: detectedCity,
    temperature: temp,
    temperatureF: tempF,
    tempUnit: '°',
    condition,
    high,
    low,
    humidity,
    windSpeed,
    icon,
    timestamp: new Date().toISOString(),
  };
}

async function getWeather(params = {}) {
  const rawLoc = (params.location || params.query || '').trim();
  let requestedLoc = rawLoc
    .replace(/^weather(?:\s+(?:in|for|at))?/i, '')
    .replace(/(?:today|tomorrow|now|tonight|this week)/gi, '')
    .trim();

  // If no location was given, use fixed default: Haarlem, Netherlands
  if (!requestedLoc) {
    requestedLoc = 'Haarlem, Netherlands';
  }

  // Normalization: "harlem" or "haarlem" -> "Haarlem, Netherlands"
  const lower = requestedLoc.toLowerCase();
  if (lower === 'harlem' || lower === 'haarlem') {
    requestedLoc = 'Haarlem, Netherlands';
  }

  const cacheKey = requestedLoc.toLowerCase();
  const cached = weatherCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  let weatherData = null;

  // 1. Primary: Try Open-Meteo
  try {
    const coords = await geocodeLocation(requestedLoc);
    if (coords) {
      weatherData = await fetchFromOpenMeteo(coords);
    }
  } catch (err) {
    console.warn('[Weather] Open-Meteo attempt failed:', err.message);
  }

  // 2. Fallback: wttr.in with country qualification
  if (!weatherData) {
    try {
      const fallbackTarget = requestedLoc.includes(',') ? requestedLoc : `${requestedLoc}, Netherlands`;
      weatherData = await fetchFromWttr(fallbackTarget);
    } catch (err) {
      console.warn('[Weather] wttr.in fallback failed:', err.message);
    }
  }

  if (!weatherData) {
    return {
      success: false,
      error: `Could not retrieve accurate weather data for "${requestedLoc}".`,
    };
  }

  const response = {
    success: true,
    weatherData,
    output: `Current weather for ${weatherData.location}: ${weatherData.condition}, ${weatherData.temperature}°C. High of ${weatherData.high}°C and low of ${weatherData.low}°C. Humidity is ${weatherData.humidity}%.`,
  };

  weatherCache.set(cacheKey, { timestamp: Date.now(), data: response });
  return response;
}

function createWeatherHandlers(getMainWindow) {
  return {
    get_weather: async (params) => {
      const result = await getWeather(params);
      if (result.success && result.weatherData) {
        const win = getMainWindow?.();
        if (win && !win.isDestroyed()) {
          win.webContents.send('weather-updated', result.weatherData);
        }
      }
      return result;
    },
  };
}

module.exports = {
  getWeather,
  createWeatherHandlers,
};
