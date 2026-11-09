/**
 * ElevenLabs TTS — High-speed streaming implementation with sentence chunking,
 * strict TTFB/stream timeouts, and AbortController integration.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const activeControllers = new Set();
const activeRequests = new Set();

function loadEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  try {
    fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) return;
      out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    });
  } catch (_) {}
  return out;
}

function getConfig() {
  const env = { ...loadEnvFile(), ...process.env };
  return {
    apiKey: env.ELEVENLABS_API_KEY || '',
    voiceId: env.ELEVENLABS_VOICE_ID || '',
    modelId: env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',
  };
}

function isConfigured() {
  const { apiKey, voiceId } = getConfig();
  return Boolean(apiKey && voiceId);
}

function stopSpeaking() {
  for (const ctrl of activeControllers) {
    try { ctrl.abort(); } catch (_) {}
  }
  activeControllers.clear();
  for (const req of activeRequests) {
    try { req.destroy(); } catch (_) {}
  }
  activeRequests.clear();
}

/**
 * Split text into natural sentence chunks without cutting words or sentences.
 * Max chunk target is ~400 characters.
 */
function chunkText(text, maxChunkLen = 400) {
  const clean = String(text || '')
    .replace(/<<<TOOL:[^>]+>>>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return [];
  if (clean.length <= maxChunkLen) return [clean];

  const sentences = clean.match(/[^.!?]+[.!?]+|\S+$/g) || [clean];
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (currentChunk.length + trimmed.length + 1 <= maxChunkLen) {
      currentChunk = currentChunk ? `${currentChunk} ${trimmed}` : trimmed;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      if (trimmed.length > maxChunkLen) {
        // Fallback for long clauses
        const clauses = trimmed.split(/([,;:]\s+)/);
        let subChunk = '';
        for (const part of clauses) {
          if (subChunk.length + part.length <= maxChunkLen) {
            subChunk += part;
          } else {
            if (subChunk) chunks.push(subChunk.trim());
            subChunk = part;
          }
        }
        currentChunk = subChunk.trim();
      } else {
        currentChunk = trimmed;
      }
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

/**
 * Fetch a single audio chunk from ElevenLabs streaming endpoint.
 */
function streamAudioChunk(textChunk, config, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('ABORTED'));

    const { apiKey, voiceId, modelId } = config;
    const body = JSON.stringify({
      text: textChunk,
      model_id: modelId,
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.8,
        style: 0.0,
        use_speaker_boost: true,
      },
    });

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128&optimize_streaming_latency=3`;

    let ttfbTimer = null;
    let streamIdleTimer = null;
    let totalTimer = null;
    const chunks = [];

    const clearAllTimers = () => {
      if (ttfbTimer) clearTimeout(ttfbTimer);
      if (streamIdleTimer) clearTimeout(streamIdleTimer);
      if (totalTimer) clearTimeout(totalTimer);
    };

    const resetIdleTimer = () => {
      if (streamIdleTimer) clearTimeout(streamIdleTimer);
      streamIdleTimer = setTimeout(() => {
        cleanupAndReject(new Error('STREAM_IDLE_TIMEOUT'));
      }, 5000);
    };

    const cleanupAndReject = (err) => {
      clearAllTimers();
      try { req.destroy(); } catch (_) {}
      reject(err);
    };

    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (ttfbTimer) clearTimeout(ttfbTimer);

        if (res.statusCode !== 200) {
          const errChunks = [];
          res.on('data', (d) => errChunks.push(d));
          res.on('end', () => {
            clearAllTimers();
            const errMsg = Buffer.concat(errChunks).toString('utf-8');
            reject(new Error(`ElevenLabs API HTTP ${res.statusCode}: ${errMsg}`));
          });
          return;
        }

        resetIdleTimer();

        res.on('data', (chunk) => {
          resetIdleTimer();
          chunks.push(chunk);
        });

        res.on('end', () => {
          clearAllTimers();
          activeRequests.delete(req);
          resolve(Buffer.concat(chunks));
        });

        res.on('error', cleanupAndReject);
      }
    );

    activeRequests.add(req);

    // TTFB timeout: 8 seconds
    ttfbTimer = setTimeout(() => {
      cleanupAndReject(new Error('TTFB_TIMEOUT'));
    }, 8000);

    // Total stream timeout cap: 30 seconds
    totalTimer = setTimeout(() => {
      cleanupAndReject(new Error('TOTAL_TIMEOUT'));
    }, 30000);

    if (signal) {
      signal.addEventListener('abort', () => cleanupAndReject(new Error('ABORTED')), { once: true });
    }

    req.on('error', (err) => {
      activeRequests.delete(req);
      cleanupAndReject(err);
    });
    req.write(body);
    req.end();
  });
}

/**
 * Main TTS entrypoint: Streams and concatenates chunks for full text.
 * @param {string} text
 * @returns {Promise<Buffer|null>}
 */
async function speak(text) {
  const config = getConfig();
  if (!config.apiKey || !config.voiceId) {
    console.warn('[ElevenLabs] Missing credentials');
    return null;
  }

  const controller = new AbortController();
  activeControllers.add(controller);

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    activeControllers.delete(controller);
    return null;
  }

  try {
    const audioBuffers = [];
    for (const chunk of chunks) {
      if (controller.signal.aborted) break;
      const buf = await streamAudioChunk(chunk, config, controller.signal);
      if (buf && buf.byteLength > 0) {
        audioBuffers.push(buf);
      }
    }

    if (audioBuffers.length === 0) return null;
    return Buffer.concat(audioBuffers);
  } catch (err) {
    if (err.message !== 'ABORTED') {
      console.error('[ElevenLabs] TTS error:', err.message);
    }
    return null;
  } finally {
    activeControllers.delete(controller);
  }
}

module.exports = {
  isConfigured,
  speak,
  stopSpeaking,
  getConfig,
  chunkText,
};
