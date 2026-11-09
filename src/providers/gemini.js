import { BaseProvider } from './base';

export const GEMINI_ACTIVE_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Google Gemini provider with true SSE streaming, resilient fallback, and backoff.
 */
export class GeminiProvider extends BaseProvider {
  get name() { return 'gemini'; }

  async checkHealth() {
    if (!this.config.apiKey) return { status: 'offline' };
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.config.apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      return { status: res.ok ? 'online' : 'offline' };
    } catch {
      return { status: 'offline' };
    }
  }

  modelCandidates() {
    const primary = this.config.model || 'gemini-3.5-flash';
    return [...new Set([primary, ...GEMINI_ACTIVE_MODELS])];
  }

  buildBody(messages) {
    const systemMsg = messages.find((m) => m.role === 'system');
    let chatMsgs = messages.filter((m) => m.role !== 'system');

    // Gemini API requires the first message in contents to be from role 'user'
    while (chatMsgs.length > 0 && chatMsgs[0].role !== 'user') {
      chatMsgs.shift();
    }
    if (chatMsgs.length === 0) {
      chatMsgs = [{ role: 'user', content: 'Hello' }];
    }

    const contents = chatMsgs.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.7,
      },
    };

    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }
    return body;
  }

  extractText(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts || [];
    return parts
      .filter((p) => !p.thought)
      .map((p) => p.text || '')
      .join('');
  }

  isRetriableStatus(status) {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  async streamOneModel(model, body, { signal, onToken } = {}) {
    const apiKey = this.config.apiKey;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      const err = new Error(`Gemini error ${res.status} (${model}): ${errorText.slice(0, 220)}`);
      err.status = res.status;
      err.retriable = this.isRetriableStatus(res.status);
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            const chunk = this.extractText(parsed);
            if (chunk) {
              full += chunk;
              onToken?.(full, chunk);
            }
          } catch {
            // Buffer partial JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return full;
  }

  async generateOneModel(model, body, { signal, onToken } = {}) {
    const apiKey = this.config.apiKey;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      const err = new Error(`Gemini error ${res.status} (${model}): ${errorText.slice(0, 220)}`);
      err.status = res.status;
      err.retriable = this.isRetriableStatus(res.status);
      throw err;
    }

    const data = await res.json();
    const full = this.extractText(data);
    if (full) onToken?.(full, full);
    return full;
  }

  async streamChat(messages, { signal, onToken } = {}) {
    const apiKey = this.config.apiKey;
    if (!apiKey) throw new Error('Gemini API key missing');

    const body = this.buildBody(messages);
    const candidates = this.modelCandidates();
    let lastError = null;

    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        try {
          const result = await this.streamOneModel(model, body, { signal, onToken });
          if (result && result.trim()) return result;
          throw new Error(`Gemini returned an empty reply from ${model}`);
        } catch (err) {
          if (err.name === 'AbortError' || signal?.aborted) throw err;
          lastError = err;

          // 404 (model does not exist) or 429 (quota exceeded); advance to next fallback immediately
          if (err.status === 404 || err.status === 429) break;

          attempts++;
          if (err.retriable && attempts < maxAttempts) {
            const jitter = Math.floor(Math.random() * 250);
            const backoff = Math.min(500 * Math.pow(2, attempts) + jitter, 2500);
            await sleep(backoff);
            continue;
          }
          break;
        }
      }
    }

    throw lastError || new Error('All Gemini candidate models failed.');
  }

  async generateChat(messages, { signal, onToken } = {}) {
    const apiKey = this.config.apiKey;
    if (!apiKey) throw new Error('Gemini API key missing');

    const body = this.buildBody(messages);
    const candidates = this.modelCandidates();
    let lastError = null;

    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        try {
          const full = await this.generateOneModel(model, body, { signal, onToken });
          if (full && full.trim()) return full;
          throw new Error(`Gemini returned empty reply from ${model}`);
        } catch (err) {
          if (err.name === 'AbortError' || signal?.aborted) throw err;
          lastError = err;
          if (err.status === 404 || err.status === 429) break;

          attempts++;
          if (err.retriable && attempts < maxAttempts) {
            const jitter = Math.floor(Math.random() * 200);
            const backoff = Math.min(500 * Math.pow(2, attempts) + jitter, 2500);
            await sleep(backoff);
            continue;
          }
          break;
        }
      }
    }

    throw lastError || new Error('All Gemini candidate models failed.');
  }
}
