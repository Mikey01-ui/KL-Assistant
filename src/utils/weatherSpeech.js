/**
 * Formats intelligent, natural spoken weather answers for Alfred based on live weather data.
 */
export function formatWeatherSpeech(weatherData, userQuery = '') {
  if (!weatherData) {
    return 'I am unable to retrieve live weather data at this moment, Sir.';
  }

  const city = (weatherData.location || 'Haarlem').split(',')[0].trim();
  const temp = Math.round(Number(weatherData.temperature) || 0);
  const high = Math.round(Number(weatherData.high) || temp);
  const low = Math.round(Number(weatherData.low) || temp);
  const cond = String(weatherData.condition || 'clear').toLowerCase();
  const query = String(userQuery || '').toLowerCase();

  const isRainCondition = /rain|drizzle|shower|thunderstorm|precipitation/i.test(cond);
  const isRainQuery = /\b(rain|raining|umbrella|wet|storm)\b/i.test(query);
  const isSunnyQuery = /\b(sunny|sun|clear)\b/i.test(query);
  const isColdWarmQuery = /\b(cold|warm|hot|freezing|temperature|temp|degrees)\b/i.test(query);

  if (isRainQuery) {
    if (isRainCondition) {
      return `Yes Sir, rain is expected in ${city} today with ${cond} and a temperature of ${temp} degrees. I recommend taking an umbrella.`;
    }
    return `No Sir, it is not expected to rain today in ${city}. The skies are currently ${cond} at ${temp} degrees.`;
  }

  if (isSunnyQuery) {
    if (/sunny|clear/i.test(cond)) {
      return `Yes Sir, it is currently sunny and clear in ${city} at ${temp} degrees.`;
    }
    return `It is currently ${cond} in ${city} at ${temp} degrees, Sir.`;
  }

  if (isColdWarmQuery) {
    let feel = temp < 10 ? 'quite chilly' : temp < 18 ? 'fairly mild' : 'warm';
    return `It is currently ${temp} degrees in ${city}, feeling ${feel}, with a high of ${high} and a low of ${low}, Sir.`;
  }

  // General weather inquiry
  return `In ${city}, it is currently ${temp} degrees and ${cond}, with a high of ${high} and a low of ${low}, Sir.`;
}
