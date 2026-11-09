import { useState, useRef, useCallback, useEffect } from 'react';
import { parseToolCalls, getToolSystemPrompt } from '../utils/toolParser';
import { createProvider, loadProviderConfig, saveProviderConfig } from '../providers/registry';
import { SentenceChunker } from '../utils/sentenceChunker';

// Fast conversational chat prompt
const FALLBACK_PROMPT = `You are Alfred — personal butler and loyal aide to Sir.
You are in live, hands-free conversational voice mode.
Speak naturally with calm British composure, addressing the user respectfully as "Sir".
Be direct, helpful, and concise: reply in 1 to 2 punchy, spoken sentences maximum.
Never give long-winded answers, monologues, or over-exaggerated theatrical Batman tropes. Understand Sir's intent and answer directly.
NEVER use markdown formatting, bolding, bullet points, asterisks, or lists.
Do NOT invent tool calls.`;

const ACTION_TOOLS = new Set([
  'open_app', 'close_app', 'open_url', 'open_folder',
  'volume_control', 'brightness_control', 'take_screenshot',
  'system_power', 'calendar_create_event', 'calendar_update_event',
  'calendar_delete_event', 'gmail_send', 'gmail_draft_reply'
]);

/**
 * useAI — Main AI hook with optimized streaming, sentence-by-sentence TTS dispatch, and parallel tool execution.
 */
export function useAI({ onLogEvent, onSentence } = {}) {
  const [messages, setMessages] = useState([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamState, setStreamState] = useState('idle');
  const [ollamaStatus, setOllamaStatus] = useState('connecting');
  const [modelWarming, setModelWarming] = useState(false);
  const [providerConfig, setProviderConfig] = useState(loadProviderConfig);
  const [toolExecuting, setToolExecuting] = useState(null);

  const abortControllerRef = useRef(null);
  const providerRef = useRef(null);
  const messagesRef = useRef(messages);
  const streamStateRef = useRef(streamState);
  const turnCountRef = useRef(0);
  const onSentenceRef = useRef(onSentence);

  useEffect(() => { onSentenceRef.current = onSentence; }, [onSentence]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { streamStateRef.current = streamState; }, [streamState]);

  // Instantiate provider
  useEffect(() => {
    try {
      providerRef.current = createProvider(providerConfig.type, providerConfig);
    } catch (err) {
      console.error('Failed to create AI provider:', err);
    }
  }, [providerConfig]);

  // Load chat log on mount
  useEffect(() => {
    let mounted = true;
    window.electronAPI?.loadChatLog?.().then((loaded) => {
      if (mounted && Array.isArray(loaded) && loaded.length > 0) {
        setMessages(loaded);
        messagesRef.current = loaded;
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Check health on mount and provider change
  const checkOllamaHealth = useCallback(async () => {
    if (!providerRef.current) return;
    try {
      const health = await providerRef.current.checkHealth();
      setOllamaStatus(health.status);
    } catch {
      setOllamaStatus('offline');
    }
  }, []);

  useEffect(() => {
    checkOllamaHealth();
  }, [checkOllamaHealth]);

  // ── Parallel Tool Execution ─────────────────────────────────────────
  const executeTools = useCallback(async (tools) => {
    if (!tools || tools.length === 0) return [];
    setToolExecuting(tools.map(t => t.name).join(', '));
    onLogEvent?.(`tool::executing ${tools.length} tool(s) in parallel`);

    const settled = await Promise.allSettled(
      tools.map(async (tool) => {
        onLogEvent?.(`tool::${tool.name} start`);
        const result = await window.electronAPI.executeTool(tool.name, tool.params);
        if (result?.weatherData) {
          window.dispatchEvent(new CustomEvent('jarvis:weather', { detail: result.weatherData }));
        }
        onLogEvent?.(`tool::${tool.name} → ${result?.success ? 'OK' : 'FAIL'}`);
        return { tool: tool.name, params: tool.params, ...(result || { success: false, error: 'Empty result' }) };
      })
    );

    setToolExecuting(null);
    return settled.map((s, i) => {
      if (s.status === 'fulfilled') return s.value;
      return {
        tool: tools[i].name,
        params: tools[i].params,
        success: false,
        error: s.reason?.message || 'Tool execution rejected',
      };
    });
  }, [onLogEvent]);

  // ── Stream from current provider ──────────────────────────────────
  const streamFromProvider = useCallback(async (conversationHistory, signal, isFirstMessage = false, onSentenceChunk = null) => {
    if (!providerRef.current) throw new Error('No AI provider configured');

    setOllamaStatus('online');

    const chunker = onSentenceChunk ? new SentenceChunker(onSentenceChunk) : null;
    let lastLength = 0;

    const fullResponse = await providerRef.current.streamChat(conversationHistory, {
      signal,
      isFirstMessage,
      onToken: (fullText, delta) => {
        setStreamState('streaming');
        setStreamingContent(fullText);
        if (chunker) {
          if (delta !== undefined && delta !== null) {
            chunker.push(delta);
          } else if (typeof fullText === 'string') {
            const newChunk = fullText.slice(lastLength);
            lastLength = fullText.length;
            if (newChunk) chunker.push(newChunk);
          }
        }
      },
    });

    if (chunker) {
      chunker.flush();
    }

    return fullResponse;
  }, []);

  // ── Send message (main pipeline) ─────────────────────────────────
  const sendMessage = useCallback(async (userMessage) => {
    if (!userMessage.trim() || streamStateRef.current !== 'idle') return;

    const newUserMsg = { role: 'user', content: userMessage };
    const nextMessages = [...messagesRef.current, newUserMsg];
    setMessages(nextMessages);
    messagesRef.current = nextMessages;

    setStreamState('waiting');
    setStreamingContent('');
    onLogEvent?.('usr::query received');

    let spokenSentenceCount = 0;
    const isFillerSentence = (s) => /^(checking\s+(the\s+)?(weather|current\s+conditions)|let\s+me\s+check\s+(the\s+)?(weather|current\s+conditions)|one\s+moment|looking\s+up\s+the\s+weather)/i.test(s.trim());
    const handleSentence = (sentence) => {
      if (isFillerSentence(sentence)) return;
      spokenSentenceCount += 1;
      onSentenceRef.current?.(sentence);
    };

    // Detect queries for time, date/calendar, and weather
    const isDateQuery = /\b(what('?s| is)?\s+(today'?s\s+)?(date|day)|what\s+day\s+(is\s+it|is\s+today)|calendar|month)\b/i.test(userMessage);
    const isTimeQuery = !isDateQuery && /\b(what('?s| is)?\s+(the\s+)?time|current\s+time|tell\s+(me\s+)?the\s+time)\b/i.test(userMessage);
    const isWeatherQuery = /\b(weather|temperature|forecast|rain|cloudy|cold|hot|sunny|snow|umbrella|degrees)\b/i.test(userMessage);

    if (isDateQuery) {
      window.dispatchEvent(new CustomEvent('jarvis:date'));
    } else if (isTimeQuery) {
      window.dispatchEvent(new CustomEvent('jarvis:time'));
    }

    let weatherPromise = Promise.resolve(null);
    if (isWeatherQuery) {
      const match = userMessage.match(/(?:in|at|for)\s+([a-zA-Z\s]+)/i);
      let loc = match ? match[1].replace(/(?:today|now|tomorrow|tonight|this week)/gi, '').trim() : '';
      if (!loc) {
        try {
          const saved = JSON.parse(localStorage.getItem('jarvis-settings') || '{}');
          if (saved.weatherLocation) loc = saved.weatherLocation;
        } catch (_) {}
      }
      weatherPromise = window.electronAPI?.getWeather?.({ location: loc || 'Haarlem, Netherlands' });
    }

    const [memoryResult, timeResult, weatherResult] = await Promise.allSettled([
      window.electronAPI?.memoryBuildPrompt?.(userMessage),
      window.electronAPI?.getSystemTime?.(),
      weatherPromise,
    ]);

    const memoryPrompt = memoryResult.status === 'fulfilled' ? memoryResult.value : null;
    const timeData = timeResult.status === 'fulfilled' ? timeResult.value : null;
    const weatherData = weatherResult.status === 'fulfilled' && weatherResult.value?.success ? weatherResult.value.weatherData : null;

    let systemPrompt = memoryPrompt || FALLBACK_PROMPT;
    let contextLines = '';
    if (timeData) {
      contextLines += `\nCurrent Date/Time: ${timeData.date} at ${timeData.time} (${timeData.timezone})\n`;
      if (isDateQuery) {
        contextLines += `DIRECTIVE: User asked for the date. State today's date in 1 short spoken sentence (e.g. "Today is Tuesday, October 6th, Sir."). Be concise.\n`;
      } else if (isTimeQuery) {
        contextLines += `DIRECTIVE: User asked for the time. State the current time in 1 short spoken sentence (e.g. "The time is 11:34 AM, Sir."). Be concise.\n`;
      }
    }

    if (weatherData) {
      // Trigger the transparent HUD widget right away
      window.dispatchEvent(new CustomEvent('jarvis:weather', { detail: weatherData }));
      contextLines += `\nLIVE WEATHER FOR ${weatherData.location}: ${weatherData.condition}, ${weatherData.temperature}°C (High: ${weatherData.high}°C, Low: ${weatherData.low}°C, Humidity: ${weatherData.humidity}%, Wind: ${weatherData.windSpeed}).
DIRECTIVE: Immediately speak the actual temperature and condition in your first sentence, followed by a quick natural clothing tip (e.g. if rain remind the user to take a rain jacket or umbrella; if cold advise a warm coat; if cool advise a light jacket). Keep it concise in 1-2 spoken sentences. NEVER say "Checking the weather", "Let me check", or any filler phrases.\n`;
    }

    const fullSystemPrompt = `${systemPrompt}${contextLines}\n${getToolSystemPrompt({ excludeWeather: !!weatherData })}`;

    const recent = messagesRef.current.slice(-6);
    const conversationHistory = [
      { role: 'system', content: fullSystemPrompt },
      ...recent,
    ];

    try {
      window.electronAPI?.aiStarted?.();
      abortControllerRef.current = new AbortController();

      // Step 1: Stream response with real-time sentence audio dispatch
      const fullResponse = await streamFromProvider(
        conversationHistory,
        abortControllerRef.current.signal,
        turnCountRef.current === 0,
        handleSentence
      );

      if (!fullResponse) {
        setStreamState('idle');
        setStreamingContent('');
        return;
      }

      // Step 2: Parse for tool calls
      const { displayText, tools } = parseToolCalls(fullResponse);
      const effectiveTools = weatherData ? tools.filter((t) => t.name !== 'get_weather') : tools;

      if (effectiveTools.length > 0) {
        const toolPendingText = displayText || 'Executing command...';
        const initialAiMsg = { role: 'assistant', content: toolPendingText, isPending: true };

        const withPending = [...messagesRef.current, initialAiMsg];
        setMessages(withPending);
        messagesRef.current = withPending;
        setStreamingContent('');

        // Step 3: Concurrent Tool Execution
        const toolResults = await executeTools(effectiveTools);
        const isOnlyActionTools = effectiveTools.every(t => ACTION_TOOLS.has(t.name));

        if (isOnlyActionTools) {
          const allSucceeded = toolResults.every(r => r.success);
          const statusMsg = allSucceeded
            ? (toolResults.map(r => r.output).filter(Boolean).join('. ') || 'Action completed successfully, Sir.')
            : toolResults.filter(r => !r.success).map(r => `Action failed: ${r.error || r.output}`).join('\n');

          const finalContent = displayText
            ? `${displayText}\n${statusMsg}`
            : statusMsg;

          const finalMsg = {
            role: 'assistant',
            content: finalContent,
            isToolResult: true,
            isError: !allSucceeded,
          };

          const finalConvo = [...messagesRef.current.slice(0, -1), finalMsg];
          setMessages(finalConvo);
          messagesRef.current = finalConvo;

          // If nothing was spoken before tool execution (e.g. no preamble), speak the action result
          if (spokenSentenceCount === 0 && allSucceeded) {
            handleSentence(statusMsg);
          }
        } else {
          // Query tools: check if summarization is needed or if output can be direct
          const hasData = toolResults.some(r => r.success && r.output && r.output.length > 50);
          if (hasData) {
            setStreamState('waiting');
            setStreamingContent('');

            const resultSummaries = toolResults.map(r => {
              if (r.success) return `[Tool: ${r.tool}] SUCCESS:\n${r.output}`;
              return `[Tool: ${r.tool}] FAILED: ${r.error || r.output}`;
            }).join('\n\n');

            const followUpHistory = [
              { 
                role: 'system', 
                content: 'You are Alfred, personal butler to Sir. Be extremely concise. Summarize the tool results in 1 short spoken sentence without markdown.'
              },
              { 
                role: 'user', 
                content: `Here are the results:\n${resultSummaries}\n\nSummarize briefly for me.`
              },
            ];

            // If sentences were already spoken in pass 1, do not speak duplicate summary sentences
            const summarizationSentenceHandler = spokenSentenceCount === 0 ? handleSentence : null;

            const summaryResponse = await streamFromProvider(
              followUpHistory,
              abortControllerRef.current.signal,
              false,
              summarizationSentenceHandler
            );
            if (summaryResponse) {
              const cleanSummary = parseToolCalls(summaryResponse).displayText || summaryResponse;
              const finalMsg = {
                role: 'assistant',
                content: cleanSummary,
                isToolResult: true,
              };
              const finalConvo = [...messagesRef.current.slice(0, -1), finalMsg];
              setMessages(finalConvo);
              messagesRef.current = finalConvo;
            }
          } else {
            const allSucceeded = toolResults.every(r => r.success);
            const statusMsg = allSucceeded
              ? (toolResults.map(r => r.output).filter(Boolean).join('. ') || 'Action completed successfully, Sir.')
              : toolResults.filter(r => !r.success).map(r => `❌ ${r.tool}: ${r.error || r.output}`).join('\n');

            const finalContent = displayText ? `${displayText}\n${statusMsg}` : statusMsg;
            const finalMsg = {
              role: 'assistant',
              content: finalContent,
              isToolResult: true,
              isError: !allSucceeded,
            };
            const finalConvo = [...messagesRef.current.slice(0, -1), finalMsg];
            setMessages(finalConvo);
            messagesRef.current = finalConvo;
          }
        }
      } else {
        const clean = parseToolCalls(fullResponse).displayText || fullResponse;
        const finalMsg = { role: 'assistant', content: clean };
        const finalConvo = [...messagesRef.current, finalMsg];
        setMessages(finalConvo);
        messagesRef.current = finalConvo;
      }

      onLogEvent?.('ai::response complete');

      try {
        window.electronAPI?.memorySaveTurn(userMessage, displayText || fullResponse);
      } catch { /* best-effort */ }

      try {
        window.electronAPI?.saveChatLog(messagesRef.current);
      } catch { /* best-effort */ }

      turnCountRef.current += 1;

    } catch (error) {
      if (error.name === 'AbortError') {
        onLogEvent?.('ai::generation stopped by user');
      } else {
        console.error('AI error:', error);
        let errorContent;
        if (error.message === 'MODEL_NOT_FOUND') {
          errorContent = `Model not loaded, Sir. Please check your provider settings.`;
          onLogEvent?.('ai::error — model not found');
        } else if (error.message.includes('Failed to fetch') ||
          error.message.includes('NetworkError') ||
          error.message.includes('ERR_CONNECTION_REFUSED')) {
          errorContent = `Connection failed, Sir. Please check your network connection.`;
          setOllamaStatus('offline');
          onLogEvent?.('ai::error — network');
        } else if (/Gemini error 503|UNAVAILABLE|high demand/i.test(error.message)) {
          errorContent = `Gemini is overloaded right now, Sir. Retrying with fallback model...`;
          onLogEvent?.('ai::error — gemini overloaded (503)');
        } else {
          errorContent = `An error occurred, Sir.\n\n${error.message}`;
          onLogEvent?.(`ai::error — ${error.message}`);
        }
        const errConvo = [...messagesRef.current, {
          role: 'assistant', content: errorContent, isError: true
        }];
        setMessages(errConvo);
        messagesRef.current = errConvo;
        if (spokenSentenceCount === 0) {
          handleSentence(errorContent);
        }
      }
    } finally {
      setStreamState('idle');
      setStreamingContent('');
      abortControllerRef.current = null;
      window.electronAPI?.aiStopped?.();
    }
  }, [onLogEvent, streamFromProvider, executeTools]);

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    messagesRef.current = [];
    setStreamingContent('');
    setStreamState('idle');
    window.electronAPI?.clearChatLog?.();
    onLogEvent?.('sys::chat history cleared');
  }, [onLogEvent]);

  const switchProvider = useCallback((newConfig) => {
    saveProviderConfig(newConfig);
    setProviderConfig(newConfig);
    setOllamaStatus('connecting');
    onLogEvent?.(`ai::switching to ${newConfig.type} / ${newConfig.model}`);
    setTimeout(() => checkOllamaHealth(), 500);
  }, [onLogEvent, checkOllamaHealth]);

  return {
    messages,
    setMessages,
    streamingContent,
    streamState,
    ollamaStatus,
    modelWarming,
    modelName: providerConfig.model,
    providerType: providerConfig.type,
    providerConfig,
    toolExecuting,
    sendMessage,
    stopGeneration,
    clearChat,
    checkOllamaHealth,
    switchProvider,
  };
}
