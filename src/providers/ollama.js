import { BaseProvider } from './base';

export class OllamaProvider extends BaseProvider {
  get name() { return 'ollama'; }

  async checkHealth() {
    try {
      const base = this.config.baseUrl || 'http://localhost:11434';
      const model = this.config.model || 'qwen3.5:4b';
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { status: 'offline' };
      const data = await res.json();
      const models = data.models || [];
      const prefix = model.split(':')[0];
      const found = models.some(m => m.name && (
        m.name === model ||
        m.name === `${model}:latest` ||
        m.name.startsWith(model) ||
        (prefix && (m.name.startsWith(prefix) || m.name.split(':')[0] === prefix))
      ));
      return { status: found ? 'online' : 'no-model', models };
    } catch {
      return { status: 'offline' };
    }
  }

  async listModels() {
    try {
      const base = this.config.baseUrl || 'http://localhost:11434';
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { models: [], error: `HTTP ${res.status}` };
      const data = await res.json();
      const models = (data.models || []).map(m => m.name).filter(Boolean);
      return { models, error: null };
    } catch {
      return { models: [], error: 'Ollama not detected' };
    }
  }

  /**
   * warmUp — Send a minimal /api/chat request to force Ollama to load the
   * model into VRAM before the first real user query.
   *
   * - num_predict: 1   → generate only 1 token; we care about the load, not output
   * - keep_alive: 30m  → keep model resident in VRAM for the whole session
   * Wrapped in try/catch — this is best-effort; failures are silently ignored.
   */
  async warmUp() {
    const base = this.config.baseUrl || 'http://localhost:11434';
    const model = this.config.model || 'qwen3.5:4b';
    try {
      await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
          think: false,
          options: { num_predict: 1, num_ctx: 4096, num_gpu: 99 },
          keep_alive: '30m',
        }),
        signal: AbortSignal.timeout(90000), // allow full cold-load within warm-up
      });
    } catch {
      // Best-effort — never throw from warmUp
    }
  }

  async streamChat(messages, { signal, onToken, isFirstMessage = false } = {}) {
    const base = this.config.baseUrl || 'http://localhost:11434';
    const model = this.config.model || 'qwen3.5:4b';

    // Race the fetch against a 45-second first-token timeout.
    // The timeout is cleared as soon as the first token arrives,
    // so normal long generations are unaffected.
    // First message after launch gets extra headroom: even with warm-up in
    // progress, a cold GPU load can take longer than the normal 45 s window.
    const FIRST_TOKEN_TIMEOUT_MS = isFirstMessage ? 90000 : 45000;
    let firstTokenReceived = false;
    let timeoutId = null;
    const timeoutController = new AbortController();

    // Combine caller's abort signal with our timeout signal
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    timeoutId = setTimeout(() => {
      if (!firstTokenReceived) {
        timeoutController.abort();
      }
    }, FIRST_TOKEN_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          think: false,
          options: {
            num_ctx: 4096,
            num_predict: 512,
            num_thread: 4,
            num_gpu: 99,
            repeat_penalty: 1.1
          },
          keep_alive: '30m',
        }),
        signal: combinedSignal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (timeoutController.signal.aborted && !firstTokenReceived) {
        throw new Error('OLLAMA_TIMEOUT');
      }
      throw err;
    }

    if (!res.ok) {
      clearTimeout(timeoutId);
      const text = await res.text().catch(() => '');
      if (res.status === 404 || text.includes('not found')) throw new Error('MODEL_NOT_FOUND');
      throw new Error(`Ollama error: ${res.status}`);
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
          const t = line.trim();
          if (!t) continue;
          try {
            const p = JSON.parse(t);
            if (p.message?.content) {
              // Clear the first-token timeout on first content
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                clearTimeout(timeoutId);
              }
              full += p.message.content;
              onToken?.(full);
            }
            if (p.done) break;
          } catch { /* skip malformed lines */ }
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (timeoutController.signal.aborted && !firstTokenReceived) {
        throw new Error('OLLAMA_TIMEOUT');
      }
      throw err;
    }

    clearTimeout(timeoutId);
    return full;
  }
}
