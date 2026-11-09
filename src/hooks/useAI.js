import { useState, useRef, useCallback, useEffect } from 'react';
import { parseToolCalls, getToolSystemPrompt } from '../utils/toolParser';
import { createProvider, loadProviderConfig, saveProviderConfig } from '../providers/registry';
import { SentenceChunker } from '../utils/sentenceChunker';
import {
  parseScheduleIntent,
  parseDateOnlyIntent,
  parseTimeIntent,
  parseSystemIntent,
  parseTasksIntent,
  parseMusicIntent,
  parseMusicActionIntent,
  extractMusicQuery,
  formatScheduleSpeech,
  formatTasksSpeech,
  isCalendarMutationIntent,
  formatSpokenTime,
} from '../utils/scheduleIntent';
import { notify } from '../utils/notify';
import { focusHudOverlay } from '../utils/hudOverlay';
import { openChosoTab, isoDateForWeekday } from '../utils/chosoBridge';
import {
  parseWeatherIntent,
  resolveWeatherLocation,
  setSessionLastWeatherLocation,
} from '../utils/weatherLocation';
import { normalizeSystemStats, formatSystemPerformanceSpeech } from '../utils/systemStats';
import { formatDateSpeech, formatTimeSpeech } from '../utils/alfredGreeting';
import { formatWeatherSpeech } from '../utils/weatherSpeech';
import { parseVisionIntent } from '../utils/visionIntent';
import { captureVisionFrame, closeVisionPanel } from '../utils/visionSession';
import { askVision } from '../utils/visionAsk';

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
  'calendar_delete_event', 'gmail_send', 'gmail_draft_reply',
  'gmail_mark_spam', 'gmail_archive',
  'task_add', 'task_complete', 'reminder_add',
  'note_take', 'note_delete', 'music_play'
]);

/**
 * useAI — Main AI hook with optimized streaming, sentence-by-sentence TTS dispatch, and parallel tool execution.
 */
export function useAI({ onLogEvent, onSentence, onTurnStart } = {}) {
  const [messages, setMessages] = useState([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamState, setStreamState] = useState('idle');
  const [ollamaStatus, setOllamaStatus] = useState('connecting');
  const [modelWarming, setModelWarming] = useState(false);
  const [providerConfig, setProviderConfig] = useState(loadProviderConfig);
  const [toolExecuting, setToolExecuting] = useState(null);
  /** null until persisted chat log has been read; then { assistantCount } for startup TTS guards */
  const [chatBoot, setChatBoot] = useState(null);

  const abortControllerRef = useRef(null);
  const providerRef = useRef(null);
  const messagesRef = useRef(messages);
  const streamStateRef = useRef(streamState);
  const turnCountRef = useRef(0);
  const onSentenceRef = useRef(onSentence);
  const onTurnStartRef = useRef(onTurnStart);

  useEffect(() => { onSentenceRef.current = onSentence; }, [onSentence]);
  useEffect(() => { onTurnStartRef.current = onTurnStart; }, [onTurnStart]);
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

  const envKeysRef = useRef({ groq: '', gemini: '' });

  // Sync environment keys on mount
  useEffect(() => {
    window.electronAPI?.getEnvKeys?.().then((keys) => {
      if (keys) {
        envKeysRef.current = {
          groq: keys.groq || import.meta.env?.VITE_GROQ_API_KEY || '',
          gemini: keys.gemini || import.meta.env?.VITE_GEMINI_API_KEY || '',
        };
      }
      if (keys?.groq) {
        setProviderConfig((prev) => {
          if (!prev?.apiKey || prev?.type === 'ollama') {
            const next = {
              type: 'groq',
              apiKey: keys.groq,
              baseUrl: 'https://api.groq.com/openai/v1',
              model: 'qwen/qwen3.8-27b',
            };
            saveProviderConfig(next);
            return next;
          }
          return prev;
        });
      } else if (keys?.gemini) {
        setProviderConfig((prev) => {
          if (!prev?.apiKey || prev?.type === 'ollama') {
            const next = {
              type: 'gemini',
              apiKey: keys.gemini,
              baseUrl: '',
              model: 'gemini-3.5-flash',
            };
            saveProviderConfig(next);
            return next;
          }
          return prev;
        });
      }
    }).catch(() => {});
  }, []);

  // Load chat log on mount
  useEffect(() => {
    let mounted = true;
    window.electronAPI?.loadChatLog?.().then((loaded) => {
      if (!mounted) return;
      const msgs = Array.isArray(loaded) && loaded.length > 0 ? loaded : [];
      setMessages(msgs);
      messagesRef.current = msgs;
      const assistantCount = msgs.filter((m) => m.role === 'assistant' && !m.isError).length;
      setChatBoot({ assistantCount });
    }).catch(() => {
      if (mounted) setChatBoot({ assistantCount: 0 });
    });
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

    const TOOL_TIMEOUT_MS = 45000;
    const settled = await Promise.allSettled(
      tools.map(async (tool) => {
        onLogEvent?.(`tool::${tool.name} start`);
        const result = await Promise.race([
          window.electronAPI.executeTool(tool.name, tool.params),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Tool ${tool.name} timed out`)), TOOL_TIMEOUT_MS);
          }),
        ]);
        if (result?.weatherData) {
          window.dispatchEvent(new CustomEvent('jarvis:weather', { detail: result.weatherData }));
        }
        if (tool.name.startsWith('calendar_') && result?.success) {
          window.dispatchEvent(new CustomEvent('jarvis:calendar-refresh'));
          const desc = tool.params?.summary || tool.params?.title || 'Calendar event updated';
          notify(tool.name === 'calendar_create_event' ? `Event: ${desc}` : desc, 'info', 'CALENDAR');
        }
        if (tool.name.startsWith('reminder_') && result?.success) {
          window.dispatchEvent(new CustomEvent('jarvis:tasks-refresh'));
          const desc = tool.params?.title || 'Reminder scheduled';
          notify(`Reminder: ${desc}`, 'info', 'REMINDER');
        } else if (tool.name.startsWith('task_') && result?.success) {
          window.dispatchEvent(new CustomEvent('jarvis:tasks-refresh'));
          const desc = tool.params?.title || 'Task updated';
          notify(`Task: ${desc}`, 'info', 'TASK');
        } else if (tool.name.startsWith('note_') && result?.success) {
          window.dispatchEvent(new CustomEvent('jarvis:notes-refresh'));
          const desc = tool.params?.title || tool.params?.query || 'Note saved';
          notify(`Note: ${desc}`, 'info', 'NOTE');
        }
        if (result && !result.success) {
          notify(result.error || `Failed: ${tool.name}`, 'error', 'ALERT');
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

  // ── Stream from current provider with resilient multi-provider fallback ──
  const streamFromProvider = useCallback(async (conversationHistory, signal, isFirstMessage = false, onSentenceChunk = null) => {
    if (!providerRef.current) throw new Error('No AI provider configured');

    setOllamaStatus('online');

    const executeStream = async (provider) => {
      const chunker = onSentenceChunk ? new SentenceChunker(onSentenceChunk) : null;
      let lastLength = 0;

      const fullResponse = await provider.streamChat(conversationHistory, {
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
    };

    try {
      return await executeStream(providerRef.current);
    } catch (primaryErr) {
      if (signal?.aborted) throw primaryErr;
      console.warn(`[useAI] Primary provider (${providerRef.current?.name}) error:`, primaryErr?.message);

      const geminiKey = envKeysRef.current.gemini || import.meta.env?.VITE_GEMINI_API_KEY;
      const groqKey = envKeysRef.current.groq || import.meta.env?.VITE_GROQ_API_KEY;

      // If Groq fails or rate limits, fallback to Gemini
      if (providerRef.current?.name === 'groq' && geminiKey) {
        try {
          console.log('[useAI] Attempting automatic fallback to Gemini...');
          const fallbackProvider = createProvider('gemini', {
            apiKey: geminiKey,
            model: 'gemini-3.5-flash',
          });
          return await executeStream(fallbackProvider);
        } catch (fallbackErr) {
          console.error('[useAI] Gemini fallback also failed:', fallbackErr);
        }
      } else if (providerRef.current?.name === 'gemini' && groqKey) {
        try {
          console.log('[useAI] Attempting automatic fallback to Groq...');
          const fallbackProvider = createProvider('groq', {
            apiKey: groqKey,
            model: 'qwen/qwen3.8-27b',
          });
          return await executeStream(fallbackProvider);
        } catch (fallbackErr) {
          console.error('[useAI] Groq fallback also failed:', fallbackErr);
        }
      }

      throw primaryErr;
    }
  }, []);

  // ── Send message (main pipeline) ─────────────────────────────────
  const lastHandledQueryRef = useRef({ text: '', at: 0 });

  const sendMessage = useCallback(async (userMessage) => {
    const trimmed = String(userMessage || '').trim();
    if (!trimmed || streamStateRef.current !== 'idle') return;

    // Drop duplicate STT/submit of the same line within 2.5s (common after barge-in / echo).
    const now = Date.now();
    const norm = trimmed.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    if (
      norm &&
      norm === lastHandledQueryRef.current.text &&
      now - lastHandledQueryRef.current.at < 2500
    ) {
      onLogEvent?.(`usr::ignored duplicate — ${trimmed}`);
      return;
    }
    lastHandledQueryRef.current = { text: norm, at: now };

    streamStateRef.current = 'waiting';
    onTurnStartRef.current?.();
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const turnSignal = abortControllerRef.current.signal;
    let spokenSentenceCount = 0;
    const isFillerSentence = (s) =>
      /^(checking\s+(the\s+)?(weather|current\s+conditions)|let\s+me\s+check\s+(the\s+)?(weather|current\s+conditions)|one\s+moment|looking\s+up\s+the\s+weather)/i.test(
        String(s || '').trim()
      );
    const isMusicClarification = (s) =>
      /\b(which\s+song|what\s+song|what\s+track|what\s+(would|do)\s+you\s+(like|want)\s+(me\s+)?to\s+play|which\s+(one|track|artist)|what\s+would\s+you\s+like\s+to\s+(hear|play))\b/i.test(
        String(s || '')
      );
    const handleSentence = (sentence) => {
      if (isFillerSentence(sentence)) return;
      // Never speak "which song?" — music is handled deterministically / via music_play.
      if (isMusicClarification(sentence)) return;
      spokenSentenceCount += 1;
      onSentenceRef.current?.(sentence);
    };

    try {
      const newUserMsg = { role: 'user', content: trimmed };
      const nextMessages = [...messagesRef.current, newUserMsg];
      setMessages(nextMessages);
      messagesRef.current = nextMessages;

      setStreamState('waiting');
      setStreamingContent('');
      onLogEvent?.('usr::query received');

      // Use trimmed consistently below
      userMessage = trimmed;

    const rawScheduleIntent = parseScheduleIntent(userMessage);
    const lastAssistantMsg = (messagesRef.current || [])
      .slice(-2)
      .find((m) => m.role === 'assistant')?.content || '';
    const isAwaitingReminderClarification =
      /\bremind/i.test(lastAssistantMsg) &&
      /\b(what time|when|what day|which day|shall i|would you like)\b/i.test(lastAssistantMsg);
    const scheduleIntent = isAwaitingReminderClarification ? null : rawScheduleIntent;
    const isDateQuery = parseDateOnlyIntent(userMessage);
    const isTimeQuery = parseTimeIntent(userMessage);
    const isWeatherQuery = parseWeatherIntent(userMessage);
    const isSystemQuery = parseSystemIntent(userMessage);
    const isTasksQuery = parseTasksIntent(userMessage);
    const isMusicQuery = parseMusicIntent(userMessage);
    const isVisionQuery = parseVisionIntent(userMessage);

    // Vision fast-path: skip memory/calendar/weather waits entirely.
    if (isVisionQuery) {
      window.dispatchEvent(new CustomEvent('jarvis:vision-mode', { detail: { active: true } }));
      onLogEvent?.('vision::engaging optical feed');
      let deterministicSpeech = null;
      try {
        window.electronAPI?.aiStarted?.();
        streamStateRef.current = 'waiting';
        const frame = await captureVisionFrame({ settleMs: 220, timeoutMs: 7000 });
        if (turnSignal.aborted) {
          // Newer utterance won — drop this turn quietly.
          closeVisionPanel({ keepAlive: true });
          window.dispatchEvent(new CustomEvent('jarvis:vision-mode', { detail: { active: false } }));
          setStreamState('idle');
          streamStateRef.current = 'idle';
          window.electronAPI?.aiStopped?.();
          return;
        }
        const answer = await askVision({
          question: userMessage,
          base64: frame.base64,
          mimeType: frame.mimeType,
        });
        deterministicSpeech =
          (answer && String(answer).trim()) ||
          'I could not make that out clearly from the camera, Sir.';
        onLogEvent?.('vision::reply ready');
      } catch (err) {
        console.warn('[vision]', err?.message || err);
        const msg = String(err?.message || err?.name || '');
        if (/permission|NotAllowed|denied/i.test(msg)) {
          deterministicSpeech =
            'Camera permission is required for that, Sir. Please allow camera access for Alfred in System Settings.';
        } else if (/API key/i.test(msg)) {
          deterministicSpeech =
            'Vision is unavailable without a Gemini API key, Sir. Add one in Settings and try again.';
        } else if (/timed out|timeout/i.test(msg)) {
          deterministicSpeech = 'The camera took too long, Sir. Please try once more.';
        } else {
          deterministicSpeech = 'I could not use the camera just now, Sir.';
        }
        onLogEvent?.(`vision::error — ${msg.slice(0, 80)}`);
      }

      try {
        if (deterministicSpeech && !turnSignal.aborted) {
          const assistantMsg = { role: 'assistant', content: deterministicSpeech };
          const finalConvo = [...messagesRef.current, assistantMsg];
          setMessages(finalConvo);
          messagesRef.current = finalConvo;
          setStreamingContent('');
          handleSentence(deterministicSpeech);
          onLogEvent?.('ai::response complete');
          try {
            window.electronAPI?.memorySaveTurn(userMessage, deterministicSpeech);
          } catch { /* best-effort */ }
          try {
            window.electronAPI?.saveChatLog(messagesRef.current);
          } catch { /* best-effort */ }
          turnCountRef.current += 1;
        }
      } finally {
        setTimeout(() => {
          closeVisionPanel({ keepAlive: true });
          window.dispatchEvent(new CustomEvent('jarvis:vision-mode', { detail: { active: false } }));
        }, 2800);
        setStreamState('idle');
        streamStateRef.current = 'idle';
        setStreamingContent('');
        abortControllerRef.current = null;
        window.electronAPI?.aiStopped?.();
      }
      return;
    }

    if (scheduleIntent) {
      // Prefer Choso Island calendar tab; jump the wheel to the asked day.
      const day = scheduleIntent.targetDay || undefined;
      const date = day
        ? isoDateForWeekday(day, { isNext: Boolean(scheduleIntent.isNextDay) })
        : scheduleIntent.range === 'tomorrow'
          ? isoDateForWeekday('tomorrow')
          : scheduleIntent.range === 'today'
            ? isoDateForWeekday('today')
            : undefined;
      void openChosoTab('calendar', { day, date, hold: 10 });
    } else if (isDateQuery) {
      // Voice only, no UI overlay
    } else if (isTimeQuery) {
      focusHudOverlay('time');
      window.dispatchEvent(new CustomEvent('jarvis:time'));
    }
    let weatherPromise = Promise.resolve(null);
    if (isWeatherQuery) {
      const loc = resolveWeatherLocation(userMessage);
      weatherPromise = window.electronAPI?.getWeather?.({ location: loc });
    }

    let calendarPromise = Promise.resolve(null);
    if (scheduleIntent) {
      calendarPromise = window.electronAPI?.getCalendarEvents?.({
        range: scheduleIntent.range,
        targetDay: scheduleIntent.targetDay,
        isNextDay: scheduleIntent.isNextDay,
        matchedMonth: scheduleIntent.matchedMonth,
        matchedMonthIndex: scheduleIntent.matchedMonthIndex,
        matchedYear: scheduleIntent.matchedYear,
      });
    }

    let tasksPromise = Promise.resolve(null);
    // Only fetch tasks when asked — not on every calendar question (Reminders was ~2.5s).
    if (isTasksQuery) {
      void openChosoTab('tasks');
      tasksPromise = window.electronAPI?.tasksList?.({ limit: 20 });
    }

    let statsPromise = Promise.resolve(null);
    if (isSystemQuery) {
      statsPromise = window.electronAPI?.getSystemStats?.();
    }

    const musicAction = parseMusicActionIntent(userMessage);
    let musicPromise = Promise.resolve(null);
    if (musicAction === 'pause') {
      window.electronAPI?.musicPause?.();
    } else if (musicAction === 'resume') {
      window.electronAPI?.musicResume?.();
    } else if (musicAction === 'next') {
      window.electronAPI?.musicNext?.();
    } else if (musicAction === 'prev') {
      window.electronAPI?.musicPrev?.();
    } else if (isMusicQuery) {
      const query = extractMusicQuery(userMessage);
      const isShow = query === '__SHOW_WINDOW__';
      // Open Choso music (home) tab so the island shows now-playing.
      void openChosoTab('home');
      musicPromise = window.electronAPI?.musicLaunch?.({ appName: 'YouTube Music', query, autoPlay: true, show: isShow })
        .catch(() => ({ launch: null }));
    }

    // Fast path: schedule / tasks / music / time / date / system don't need memory prompt.
    const needsMemory =
      !scheduleIntent &&
      !isTasksQuery &&
      !isMusicQuery &&
      !musicAction &&
      !isDateQuery &&
      !isTimeQuery &&
      !isSystemQuery;

    const [memoryResult, timeResult, weatherResult, calendarResult, tasksResult, musicResult, statsResult] =
      await Promise.allSettled([
        needsMemory ? window.electronAPI?.memoryBuildPrompt?.(userMessage) : Promise.resolve(null),
        window.electronAPI?.getSystemTime?.(),
        weatherPromise,
        calendarPromise,
        tasksPromise,
        musicPromise,
        statsPromise,
      ]);

    const memoryPrompt = memoryResult.status === 'fulfilled' ? memoryResult.value : null;
    const timeData = timeResult.status === 'fulfilled' ? timeResult.value : null;
    const weatherData = weatherResult.status === 'fulfilled' && weatherResult.value?.success ? weatherResult.value.weatherData : null;
    const calendarData =
      calendarResult.status === 'fulfilled' && calendarResult.value ? calendarResult.value : null;
    const tasksData = tasksResult.status === 'fulfilled' ? tasksResult.value : null;
    const musicData = musicResult.status === 'fulfilled' ? musicResult.value : null;
    const statsData = statsResult.status === 'fulfilled' ? statsResult.value : null;

    if (turnSignal.aborted) {
      setStreamState('idle');
      streamStateRef.current = 'idle';
      return;
    }

    if (weatherData?.location) {
      setSessionLastWeatherLocation(weatherData.location);
    }

    let deterministicSpeech = null;
    const pureSystemQuery = isSystemQuery && !isWeatherQuery;

    if (pureSystemQuery) {
      const snap = normalizeSystemStats(statsData);
      focusHudOverlay('system');
      window.dispatchEvent(new CustomEvent('jarvis:system', { detail: { stats: snap } }));
      deterministicSpeech = formatSystemPerformanceSpeech(snap);
    } else if (isDateQuery && timeData) {
      deterministicSpeech = formatDateSpeech(timeData);
    } else if (isTimeQuery && timeData) {
      deterministicSpeech = formatTimeSpeech(timeData);
    } else if (isWeatherQuery && weatherData) {
      focusHudOverlay('weather');
      window.dispatchEvent(new CustomEvent('jarvis:weather', { detail: weatherData }));
      deterministicSpeech = formatWeatherSpeech(weatherData, userMessage);
    } else if (scheduleIntent) {
      // Voice-only response, zero UI overlay
      deterministicSpeech = formatScheduleSpeech(scheduleIntent, calendarData, tasksData);
    } else if (isTasksQuery) {
      // Always answer — even if the local task DB is empty/unavailable.
      deterministicSpeech = Array.isArray(tasksData)
        ? formatTasksSpeech(tasksData)
        : 'I could not read your tasks just now, Sir.';
    } else if (musicAction === 'pause') {
      deterministicSpeech = 'Pausing music, Sir.';
    } else if (musicAction === 'resume') {
      deterministicSpeech = 'Resuming music, Sir.';
    } else if (musicAction === 'next') {
      deterministicSpeech = 'Skipping to the next track, Sir.';
    } else if (musicAction === 'prev') {
      deterministicSpeech = 'Playing previous track, Sir.';
    } else if (isMusicQuery) {
      const query = extractMusicQuery(userMessage);
      if (query === '__SHOW_WINDOW__') {
        deterministicSpeech = 'Opening YouTube Music, Sir.';
      } else if (query === '__RANDOM__' || query === '__LIBRARY__' || !query) {
        deterministicSpeech = 'Alright, playing a song.';
      } else {
        const title = musicData?.track && musicData.track !== 'Music' ? musicData.track : query;
        deterministicSpeech = `Alright, playing ${title}.`;
      }
    }

    if (deterministicSpeech) {
      try {
        window.electronAPI?.aiStarted?.();
        streamStateRef.current = 'waiting';
        const assistantMsg = { role: 'assistant', content: deterministicSpeech };
        const finalConvo = [...messagesRef.current, assistantMsg];
        setMessages(finalConvo);
        messagesRef.current = finalConvo;
        setStreamingContent('');
        handleSentence(deterministicSpeech);
        onLogEvent?.('ai::response complete');
        try {
          window.electronAPI?.memorySaveTurn(userMessage, deterministicSpeech);
        } catch { /* best-effort */ }
        try {
          window.electronAPI?.saveChatLog(messagesRef.current);
        } catch { /* best-effort */ }
        turnCountRef.current += 1;
      } finally {
        setStreamState('idle');
        streamStateRef.current = 'idle';
        setStreamingContent('');
        abortControllerRef.current = null;
        window.electronAPI?.aiStopped?.();
      }
      return;
    }

    // Schedule / tasks / music visuals are handled by Choso Island (openChosoTab above).

    if (isMusicQuery) {
      const query = extractMusicQuery(userMessage);
      const isShow = query === '__SHOW_WINDOW__';
      if (isShow) {
        notify('Opening YouTube Music, Sir.');
      } else if (query === '__RANDOM__' || query === '__LIBRARY__' || !query) {
        notify('Alright, playing a song.');
      } else {
        const name = musicData?.track || query;
        notify(`Alright, playing ${name}.`);
      }
    }

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

    if (scheduleIntent) {
      const eventsList = Array.isArray(calendarData?.events) ? calendarData.events : [];
      const lines = eventsList.slice(0, 10).map((ev) => {
        const d = ev.start ? new Date(ev.start) : null;
        const dayStr = d ? d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) : '?';
        const timeStr = ev.allDay ? 'All Day' : (d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
        return `- ${dayStr} at ${timeStr}: ${ev.title}${ev.location ? ` (${ev.location})` : ''}`;
      });
      contextLines += `\nCALENDAR EVENTS (${scheduleIntent.range}):\n${lines.length ? lines.join('\n') : 'No events scheduled.'}\nDIRECTIVE: Directly tell Sir about his upcoming events (specifically mentioning the day of the week, such as Friday, and the event title/time) in 1 to 2 spoken sentences. If no events are scheduled, inform Sir politely.\n`;
    }

    if (isSystemQuery && statsData) {
      const cpu = Math.round(Number(statsData.cpu?.usage) || 0);
      const mem = Math.round(Number(statsData.memory?.usage) || 0);
      const disk = Math.round(Number(statsData.disk?.usage) || 0);
      contextLines += `\nLIVE SYSTEM STATS (use these exact figures in speech): CPU ${cpu}%, Memory ${mem}%, Storage ${disk}%.\nDIRECTIVE: State CPU, memory, and storage usage in one or two short spoken sentences. Address the user as Sir. Do not say you cannot access system data.\n`;
    } else if (isSystemQuery) {
      contextLines += `\nDIRECTIVE: User asked about system performance. Apologize briefly that live stats are unavailable, Sir.\n`;
    }

    if (isTasksQuery && Array.isArray(tasksData)) {
      const open = tasksData.filter((t) => !t.completed);
      contextLines += `\nOPEN TASKS:\n${open.length ? open.map((t) => `- ${t.title}`).join('\n') : 'None.'}\nDIRECTIVE: Mention the next task or that the list is clear, in 1-2 sentences.\n`;
    }

    const recentConvoText = (messagesRef.current || [])
      .slice(-4)
      .map((m) => m.content)
      .join(' ');
    const isReminderIntent = /\bremind(?:er|ers)?\b/i.test(userMessage) || /\bremind(?:er|ers)?\b/i.test(recentConvoText);
    const mentionsTomorrow = /\btomorrow\b/i.test(userMessage) || /\btomorrow\b/i.test(recentConvoText);

    if (isReminderIntent) {
      const todayIso = new Date().toLocaleDateString('en-CA');
      const tomorrowD = new Date();
      tomorrowD.setDate(tomorrowD.getDate() + 1);
      const tomorrowIso = tomorrowD.toLocaleDateString('en-CA');

      contextLines += `\nREMINDER MANAGEMENT:
- TODAY'S DATE: ${todayIso}
- TOMORROW'S DATE: ${tomorrowIso}
- IMPORTANT: ${mentionsTomorrow ? `Sir specified "tomorrow". You MUST use TOMORROW'S DATE (${tomorrowIso}) in due_at (e.g. ${tomorrowIso}T16:00:00). Do NOT use today's date!` : 'If Sir specifies "tomorrow", use TOMORROW\'S DATE in due_at.'}
- If Sir asks to be reminded of something without specifying a time or date, DO NOT invent a time or call reminder_add. Instead, ask politely: "Certainly, Sir. What time would you like me to remind you?"
- When Sir specifies a time, calculate the due_at ISO timestamp combining the intended date and time, and invoke <<<TOOL:reminder_add|title=...|due_at=...>>>.\n`;
    }

    const isCalendarMutation = isCalendarMutationIntent(userMessage);
    if (isCalendarMutation) {
      contextLines += `\nCALENDAR EVENT MANAGEMENT:
User wants to create, schedule, or manage an event.
- If the user gave a title and time (e.g. "team sync today at 3pm"), calculate the start time (using Current Date/Time above) and end time (1 hour later by default) and call <<<TOOL:calendar_create_event|summary=...|start=ISO|end=ISO>>>.
- If the user did NOT give a title or time (e.g. "create an event for me today"), politely ask Sir what he would like to call the event and what time it should be scheduled for.
- Do NOT say you cannot create events or that events are empty. Address Sir respectfully in 1 short spoken sentence.\n`;
    }

    if (isMusicQuery) {
      const query = extractMusicQuery(userMessage);
      if (query === '__SHOW_WINDOW__') {
        contextLines += `\nDIRECTIVE: User asked to open YouTube Music. Confirm in one short sentence: "Opening YouTube Music, Sir." NEVER ask which song.\n`;
      } else if (query === '__RANDOM__' || query === '__LIBRARY__' || !query) {
        contextLines += `\nDIRECTIVE: User asked to play music without a title. Respond ONLY: "Alright, playing a song." Call music_play with an empty query if needed. NEVER ask which song they want.\n`;
      } else {
        const trackName = musicData?.track && musicData.track !== 'Music' ? musicData.track : query;
        contextLines += `\nDIRECTIVE: User asked to play ${trackName}. Respond ONLY: "Alright, playing ${trackName}." NEVER ask which song. NEVER mention YouTube Premium or subscriptions.\n`;
      }
    }

    if (isWeatherQuery && !weatherData) {
      contextLines += `\nDIRECTIVE: Weather data is unavailable. Apologize briefly; do not invent temperature or conditions, Sir.\n`;
    }

    if (weatherData) {
      focusHudOverlay('weather');
      window.dispatchEvent(new CustomEvent('jarvis:weather', { detail: weatherData }));
      contextLines += `\nLIVE WEATHER FOR ${weatherData.location} (ignore cities from earlier chat — use only this block): ${weatherData.condition}, ${weatherData.temperature}°C (High: ${weatherData.high}°C, Low: ${weatherData.low}°C, Humidity: ${weatherData.humidity}%, Wind: ${weatherData.windSpeed}).
DIRECTIVE: Immediately speak the actual temperature and condition in your first sentence, followed by a quick natural clothing tip (e.g. if rain remind the user to take a rain jacket or umbrella; if cold advise a warm coat; if cool advise a light jacket). Keep it concise in 1-2 spoken sentences. NEVER say "Checking the weather", "Let me check", or any filler phrases.\n`;
    }

    const fullSystemPrompt = `${systemPrompt}${contextLines}\n${getToolSystemPrompt({ excludeWeather: !!weatherData })}`;

    const recent = messagesRef.current.slice(-4);
    const conversationHistory = [
      { role: 'system', content: fullSystemPrompt },
      ...recent
        .filter((m) => m && m.content && !m.isError)
        .map((m) => ({
          role: m.role === 'assistant' || m.role === 'system' || m.role === 'user' ? m.role : 'user',
          content: typeof m.content === 'string' ? m.content : String(m.content || ''),
        })),
    ];

    const speakSystemFallback = () => {
      if (!isSystemQuery || spokenSentenceCount > 0) return;
      if (!statsData) {
        handleSentence('I could not read live system stats just now, Sir.');
        return;
      }
      const cpu = Math.round(Number(statsData.cpu?.usage) || 0);
      const mem = Math.round(Number(statsData.memory?.usage) || 0);
      const disk = Math.round(Number(statsData.disk?.usage) || 0);
      handleSentence(`CPU is at ${cpu} percent, memory at ${mem}, storage at ${disk}, Sir.`);
    };

      window.electronAPI?.aiStarted?.();

      // Step 1: Stream response with real-time sentence audio dispatch
      const fullResponse = await streamFromProvider(
        conversationHistory,
        turnSignal,
        turnCountRef.current === 0,
        handleSentence
      );

      if (!fullResponse) {
        speakSystemFallback();
        setStreamState('idle');
        setStreamingContent('');
        return;
      }

      // Step 2: Parse for tool calls
      const { displayText, tools } = parseToolCalls(fullResponse);
      const effectiveTools = tools.filter((t) => {
        if (weatherData && t.name === 'get_weather') return false;
        if (scheduleIntent && (t.name === 'calendar_fetch_events' || t.name === 'calendar_fetch_structured')) return false;
        if (tasksData && t.name === 'tasks_list') return false;
        return true;
      });

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
          const musicPlay = toolResults.find((r) => r.tool === 'music_play' && r.success);
          const statusMsg = allSucceeded
            ? (toolResults.map(r => r.output).filter(Boolean).join('. ') || 'Action completed successfully, Sir.')
            : toolResults.filter(r => !r.success).map(r => `Action failed: ${r.error || r.output}`).join('\n');

          // Prefer the real action confirmation over any prior "which song?" LLM chatter.
          const spokenConfirm = musicPlay?.output || statusMsg;
          const finalContent = musicPlay
            ? spokenConfirm
            : (displayText && !isMusicClarification(displayText)
              ? `${displayText}\n${statusMsg}`
              : statusMsg);

          const finalMsg = {
            role: 'assistant',
            content: finalContent,
            isToolResult: true,
            isError: !allSucceeded,
          };

          const finalConvo = [...messagesRef.current.slice(0, -1), finalMsg];
          setMessages(finalConvo);
          messagesRef.current = finalConvo;

          if (allSucceeded && (spokenSentenceCount === 0 || musicPlay)) {
            handleSentence(spokenConfirm);
          } else if (!allSucceeded && spokenSentenceCount === 0) {
            handleSentence(statusMsg || 'I was unable to complete that action, Sir.');
          } else if (!allSucceeded) {
            handleSentence('My apologies Sir, that action could not be completed.');
          }
        } else {
          // Query tools: check if summarization is needed or if output can be direct
          const directSpoken = toolResults.find(r => r.spokenSummary)?.spokenSummary;
          if (directSpoken) {
            if (spokenSentenceCount === 0) {
              handleSentence(directSpoken);
            }
            const statusMsg = toolResults.map(r => r.output).filter(Boolean).join('\n\n');
            const finalContent = displayText ? `${displayText}\n\n${statusMsg}` : statusMsg;
            const finalMsg = {
              role: 'assistant',
              content: finalContent,
              isToolResult: true,
            };
            const finalConvo = [...messagesRef.current.slice(0, -1), finalMsg];
            setMessages(finalConvo);
            messagesRef.current = finalConvo;
            setStreamState('idle');
            setStreamingContent('');
          } else {
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

              // Always deliver the answer to the user via TTS
              const summarizationSentenceHandler = handleSentence;

              try {
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
              } catch (summaryErr) {
                const fallbackStatus = toolResults.map(r => r.output).filter(Boolean).join('. ') || 'Tool finished, Sir.';
                handleSentence(fallbackStatus);
                const finalMsg = {
                  role: 'assistant',
                  content: fallbackStatus,
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

              if (spokenSentenceCount === 0) {
                const cleanSpoken = statusMsg.replace(/[❌⚠️•]/g, '').trim();
                if (cleanSpoken) handleSentence(cleanSpoken);
              }
            }
          }
        }
      } else {
        const clean = parseToolCalls(fullResponse).displayText || fullResponse;
        const finalMsg = { role: 'assistant', content: clean };
        const finalConvo = [...messagesRef.current, finalMsg];
        setMessages(finalConvo);
        messagesRef.current = finalConvo;
      }

      speakSystemFallback();

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
      streamStateRef.current = 'idle';
      setStreamingContent('');
      abortControllerRef.current = null;
      window.electronAPI?.aiStopped?.();
    }
  }, [onLogEvent, streamFromProvider, executeTools]);

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    setToolExecuting(null);
    setStreamState('idle');
    streamStateRef.current = 'idle';
    setStreamingContent('');
    try {
      window.electronAPI?.aiStopped?.();
    } catch { /* best-effort */ }
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
    chatBoot,
  };
}
