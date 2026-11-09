/**
 * Ask Gemini about a webcam frame — single fast model path.
 */

const SYSTEM = `You are Alfred, Sir's butler looking through his Mac webcam.
Answer only from the image. One short spoken sentence, address him as Sir. No markdown.`;

let cachedKey = '';

async function getGeminiKey() {
  if (cachedKey) return cachedKey;
  try {
    const keys = await window.electronAPI?.getEnvKeys?.();
    if (keys?.gemini) {
      cachedKey = keys.gemini;
      return cachedKey;
    }
  } catch (_) {}
  cachedKey = import.meta.env?.VITE_GEMINI_API_KEY || '';
  return cachedKey;
}

function extractText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text || '')
    .join('')
    .trim();
}

/**
 * @param {{ question: string, base64: string, mimeType?: string }} opts
 */
export async function askVision({ question, base64, mimeType = 'image/jpeg' } = {}) {
  const apiKey = await getGeminiKey();
  if (!apiKey) {
    throw new Error('Gemini API key missing — needed for camera vision.');
  }

  // Prefer widely available flash models; try at most two.
  const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-flash-latest'];

  const cleanB64 = String(base64 || '').replace(/^data:image\/\w+;base64,/, '');
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: cleanB64,
            },
          },
          {
            text: String(question || '').trim(),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 80,
    },
  };

  let lastError = null;
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), 9000);

  try {
    for (const model of models) {
      try {
        const t0 = performance.now();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          lastError = new Error(`Gemini vision ${model} ${res.status}: ${errText.slice(0, 120)}`);
          console.warn('[visionAsk]', lastError.message);
          continue;
        }
        const data = await res.json();
        const text = extractText(data);
        console.log(`[visionAsk] ${model} in ${Math.round(performance.now() - t0)}ms`);
        if (text) return text;
        lastError = new Error(`Empty vision reply from ${model}`);
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('Vision request timed out');
        lastError = e;
      }
    }
  } finally {
    clearTimeout(kill);
  }

  throw lastError || new Error('Vision request failed');
}
