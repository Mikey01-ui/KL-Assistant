import { BaseProvider } from './base';

export const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
];

/**
 * High-speed Groq LLM provider using LPUs.
 * Delivers sub-200ms latency for real-time butler dialogue.
 */
export class GroqProvider extends BaseProvider {
  get name() { return 'groq'; }

  async checkHealth() {
    try {
      const apiKey = this.config.apiKey;
      if (!apiKey) return { status: 'offline' };
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return { status: res.ok ? 'online' : 'offline' };
    } catch {
      return { status: 'offline' };
    }
  }

  async streamChat(messages, { signal, onToken } = {}) {
    const apiKey = this.config.apiKey;
    if (!apiKey) throw new Error('GROQ_API_KEY is not configured');

    const cleanMessages = (Array.isArray(messages) ? messages : [])
      .filter((m) => m && m.content)
      .map((m) => ({
        role: m.role === 'assistant' || m.role === 'system' || m.role === 'user' ? m.role : 'user',
        content: typeof m.content === 'string' ? m.content : String(m.content || ''),
      }));

    const preferred = this.config.model || 'llama-3.3-70b-versatile';
    const candidateModels = [
      preferred,
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
      'openai/gpt-oss-120b',
    ].filter((m, i, arr) => arr.indexOf(m) === i);

    let res = null;
    let lastError = null;

    for (const model of candidateModels) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const attempt = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: cleanMessages,
            stream: true,
            temperature: 0.6,
            max_tokens: 600,
          }),
          signal,
        });

        if (attempt.status === 429 || attempt.status === 503) {
          const errText = await attempt.text().catch(() => '');
          console.warn(`[Groq] Model ${model} returned ${attempt.status}, trying fallback model...`, errText.slice(0, 100));
          lastError = new Error(`Groq ${model} rate limited (${attempt.status})`);
          continue;
        }

        if (!attempt.ok) {
          const text = await attempt.text().catch(() => '');
          throw new Error(`Groq error ${attempt.status}: ${text.slice(0, 200)}`);
        }

        res = attempt;
        break;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        lastError = err;
      }
    }

    if (!res) {
      throw lastError || new Error('All Groq models failed or rate limited');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') break;
        try {
          const p = JSON.parse(data);
          const delta = p.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onToken?.(full, delta);
          }
        } catch { /* skip */ }
      }
    }
    return full;
  }
}
