import { GroqProvider, GROQ_MODELS } from './groq';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import { AnthropicProvider } from './anthropic';

/**
 * Provider Registry — Factory for creating AI provider instances.
 * 
 * Supports:
 * - groq (ultra-fast LPUs, recommended)
 * - ollama (local, free)
 * - openai (OpenAI, DeepSeek, Groq, LM Studio, Together, any OpenAI-compatible)
 * - gemini (Google)
 * - anthropic (Claude)
 */

export { GROQ_MODELS };

export const GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
];

const ENV_GROQ_KEY = import.meta.env?.VITE_GROQ_API_KEY || '';
const ENV_GEMINI_KEY = import.meta.env?.VITE_GEMINI_API_KEY || '';
const DEPRECATED_GEMINI = /gemini-1\.0-pro|gemini-pro-vision|gemini-2\.0-flash|gemini-2\.5-flash|gemini-flash-lite-latest/;

function defaultProviderConfig() {
  if (ENV_GROQ_KEY) {
    return { type: 'groq', apiKey: ENV_GROQ_KEY, baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' };
  }
  return { type: 'gemini', apiKey: ENV_GEMINI_KEY, baseUrl: '', model: 'gemini-3.5-flash' };
}

const PROVIDER_MAP = {
  groq: GroqProvider,
  ollama: OllamaProvider,
  openai: OpenAIProvider,
  gemini: GeminiProvider,
  anthropic: AnthropicProvider,
};

/**
 * Create a provider instance.
 * @param {string} type - Provider type (ollama, openai, gemini, anthropic)
 * @param {object} config - Provider configuration { apiKey, baseUrl, model }
 * @returns {BaseProvider}
 */
export function createProvider(type, config = {}) {
  const ProviderClass = PROVIDER_MAP[type];
  if (!ProviderClass) {
    throw new Error(`Unknown provider: ${type}. Available: ${Object.keys(PROVIDER_MAP).join(', ')}`);
  }
  return new ProviderClass(config);
}

/** Get list of available provider types with metadata */
export function getProviderList() {
  return [
    {
      id: 'groq',
      label: 'Groq (Ultra-Fast LPUs)',
      description: 'Instant response (<100ms). Recommended for live butler voice.',
      requiresApiKey: true,
      defaultBaseUrl: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-3.3-70b-versatile',
      models: GROQ_MODELS,
    },
    {
      id: 'gemini',
      label: 'Google Gemini',
      description: 'Gemini 3.5 Flash. Free tier available.',
      requiresApiKey: true,
      defaultBaseUrl: '',
      defaultModel: 'gemini-3.5-flash',
      models: GEMINI_MODELS,
    },
    {
      id: 'ollama',
      label: 'Ollama (Local)',
      description: 'Free, runs locally. Requires Ollama installed.',
      requiresApiKey: false,
      defaultBaseUrl: 'http://localhost:11434',
      defaultModel: 'qwen2.5:3b',
      models: ['qwen2.5:3b', 'qwen3.5:4b', 'llama3.2:3b', 'mistral:7b', 'gemma2:9b', 'phi3:mini'],
    },
    {
      id: 'openai',
      label: 'OpenAI / Compatible',
      description: 'GPT-4o, DeepSeek, Groq, LM Studio, any OpenAI-compatible API.',
      requiresApiKey: true,
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'deepseek-chat', 'llama-3.1-8b-instant'],
    },
    {
      id: 'anthropic',
      label: 'Anthropic Claude',
      description: 'Claude 3.5 Sonnet, Haiku, Opus.',
      requiresApiKey: true,
      defaultBaseUrl: '',
      defaultModel: 'claude-sonnet-4-20250514',
      models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    },
  ];
}

/**
 * Load saved provider config from localStorage.
 */
export function loadProviderConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('jarvis-ai-provider') || 'null');
    if (saved && saved.type === 'groq') {
      if (!saved.apiKey && ENV_GROQ_KEY) saved.apiKey = ENV_GROQ_KEY;
      if (!saved.model || saved.model === 'qwen/qwen3.8-27b' || saved.model === 'openai/gpt-oss-120b' || saved.model === 'openai/gpt-oss-20b') {
        saved.model = 'llama-3.3-70b-versatile';
        saveProviderConfig(saved);
      }
      return saved;
    }
    // If GROQ key is present, default to groq for ultra-low latency & reliability
    if (ENV_GROQ_KEY && (!saved || saved.type === 'ollama' || saved.type === 'gemini')) {
      const groqCfg = {
        type: 'groq',
        apiKey: ENV_GROQ_KEY,
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
      };
      saveProviderConfig(groqCfg);
      return groqCfg;
    }
    if (saved && saved.type !== 'ollama') {
      if (saved.type === 'gemini') {
        if (!saved.apiKey && ENV_GEMINI_KEY) saved.apiKey = ENV_GEMINI_KEY;
        if (!saved.model || DEPRECATED_GEMINI.test(saved.model)) {
          saved.model = 'gemini-3.5-flash';
          saveProviderConfig(saved);
        }
      }
      return saved;
    }
  } catch { /* ignore */ }
  return defaultProviderConfig();
}

/**
 * Save provider config to localStorage.
 */
export function saveProviderConfig(config) {
  try {
    localStorage.setItem('jarvis-ai-provider', JSON.stringify(config));
  } catch { /* ignore */ }
}

/**
 * Fetch installed models from Ollama /api/tags
 */
export async function fetchOllamaModels(baseUrl = 'http://localhost:11434') {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      models: (data.models || []).map(m => m.name).filter(Boolean),
      error: null,
    };
  } catch (err) {
    return {
      models: [],
      error: 'Ollama not detected',
    };
  }
}

