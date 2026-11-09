import React, { useState, useCallback, useEffect, useRef } from 'react';
import JarvisHud from './components/JarvisHud';
import Settings, { useSettings } from './components/Settings';
import MemoryPanel from './components/MemoryPanel';
import { useAI } from './hooks/useAI';
import { useVoiceInput } from './hooks/useVoiceInput';
import { playTtsBuffer, stopTtsAudio } from './audio/audioBus';
import { isSttNoise, isEchoOfLastSpoken } from './utils/sttFilter';
import { notify } from './utils/notify';
import { buildStartupGreeting } from './utils/alfredGreeting';
import { closeChosoTab, isChosoSessionOpen, markChosoSessionClosed } from './utils/chosoBridge';
import './styles/jarvis-hud.css';

const PROVIDER_LABELS = {
  ollama: 'OLLAMA',
  openai: 'OPENAI',
  anthropic: 'CLAUDE',
  gemini: 'GEMINI',
};

export default function App() {
  const [settings, setSettings] = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [logs, setLogs] = useState([]);

  const [isMuted, setIsMuted] = useState(false);
  const [ttsSynthesizing, setTtsSynthesizing] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('idle');
  const [listenCooldown, setListenCooldown] = useState(false);

  const lastSpokenRef = useRef('');
  const ignoreSttUntilRef = useRef(0);
  const playbackIdRef = useRef(0);
  const sentenceQueueRef = useRef([]);
  const isDrainingRef = useRef(false);
  const streamTurnSpokenCountRef = useRef(0);
  const replyAudioSentThisTurnRef = useRef(false);
  const pendingUtteranceRef = useRef(null);

  const addLogEvent = useCallback((event) => {
    const parts = event.split('::');
    const type = parts[0] || 'sys';
    const message = parts.slice(1).join('::') || event;
    setLogs((prev) => [...prev, { type, message }].slice(-30));
  }, []);

  const stopTTS = useCallback(() => {
    playbackIdRef.current += 1;
    sentenceQueueRef.current = [];
    stopTtsAudio();
    window.electronAPI?.stopSpeaking?.();
    setTtsSynthesizing(false);
    setTtsPlaying(false);
  }, []);

  const drainSentenceQueue = useCallback(async () => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;
    const currentPlaybackId = playbackIdRef.current;

    try {
      let prefetchedPromise = null;

      while (sentenceQueueRef.current.length > 0 || prefetchedPromise) {
        let raw = null;
        if (prefetchedPromise) {
          raw = await prefetchedPromise;
          prefetchedPromise = null;
        } else {
          const nextText = sentenceQueueRef.current.shift();
          if (!nextText) break;
          setTtsSynthesizing(true);
          addLogEvent('voice::synthesizing');
          raw = await window.electronAPI?.speakText?.(nextText);
          setTtsSynthesizing(false);
        }

        // Interrupted while synthesizing
        if (currentPlaybackId !== playbackIdRef.current) break;

        if (!raw || raw.byteLength === 0) {
          addLogEvent('voice::tts empty buffer — check ElevenLabs key or macOS say');
          continue;
        }

        // Immediately pre-fetch the next sentence while current is about to play
        if (sentenceQueueRef.current.length > 0) {
          const aheadText = sentenceQueueRef.current[0];
          if (aheadText) {
            prefetchedPromise = window.electronAPI?.speakText?.(aheadText).then((raw) => {
              if (raw && raw.byteLength > 0) {
                sentenceQueueRef.current.shift();
                return raw;
              }
              return null;
            });
          }
        }

        setTtsPlaying(true);
        addLogEvent('voice::speaking');

        const bytes = raw instanceof ArrayBuffer
          ? raw
          : raw.buffer
            ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
            : new Uint8Array(raw).buffer;

        await new Promise((resolve) => {
          void playTtsBuffer(bytes, resolve);
        });

        // Interrupted while playing
        if (currentPlaybackId !== playbackIdRef.current) break;
      }
    } catch (e) {
      console.error('Queue playback error:', e);
      addLogEvent(`voice::tts error — ${e.message}`);
    } finally {
      isDrainingRef.current = false;
      setTtsSynthesizing(false);
      setTtsPlaying(false);
      const wasInterrupted = currentPlaybackId !== playbackIdRef.current;
      if (!wasInterrupted) {
        setListenCooldown(true);
        ignoreSttUntilRef.current = Date.now() + 500;
        window.dispatchEvent(new CustomEvent('jarvis:tts-finished'));
        // Collapse Choso notch once Alfred finishes speaking the answer.
        if (isChosoSessionOpen()) {
          markChosoSessionClosed();
          setTimeout(() => { void closeChosoTab(); }, 700);
        }
        setTimeout(() => setListenCooldown(false), 450);
      }
      if (sentenceQueueRef.current.length > 0 && !wasInterrupted) {
        queueMicrotask(() => drainSentenceQueue());
      }
    }
  }, [addLogEvent]);

  const queueSentence = useCallback((text, { countsAsReply = true } = {}) => {
    if (isMuted) return;
    const clean = String(text || '')
      .replace(/<<<TOOL:[^>]+>>>/g, '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_#>`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean || clean === 'Executing...' || clean === 'Executing command...') return;

    lastSpokenRef.current = clean;
    if (countsAsReply) {
      streamTurnSpokenCountRef.current += 1;
      replyAudioSentThisTurnRef.current = true;
    }
    sentenceQueueRef.current.push(clean);
    drainSentenceQueue();
  }, [isMuted, drainSentenceQueue]);

  const onTurnStart = useCallback(() => {
    streamTurnSpokenCountRef.current = 0;
    replyAudioSentThisTurnRef.current = false;
  }, []);

  const ai = useAI({
    onLogEvent: addLogEvent,
    onSentence: (text) => queueSentence(text, { countsAsReply: true }),
    onTurnStart,
  });

  // Handle barge-in: immediately cancel audio and interrupt AI generation
  const handleBargeIn = useCallback(() => {
    stopTTS();
    ai.stopGeneration();
    ignoreSttUntilRef.current = 0;
    setListenCooldown(false);
  }, [stopTTS, ai]);

  // Local task reminders
  useEffect(() => {
    let isFirstCheck = true;
    const tick = async () => {
      try {
        const due = await window.electronAPI?.tasksDueReminders?.();
        if (!Array.isArray(due) || due.length === 0) {
          isFirstCheck = false;
          return;
        }

        // Clear reminders first to prevent duplicate alerts
        for (const t of due) {
          await window.electronAPI?.tasksClearReminder?.(t.id);
        }

        // On initial boot, silently acknowledge without interrupting startup voice
        if (isFirstCheck) {
          isFirstCheck = false;
          notify(due.length === 1 ? `Reminder: ${due[0].title}` : `${due.length} reminders pending`, 'info', 'REMINDER');
          return;
        }

        if (due.length === 1) {
          notify(`Reminder: ${due[0].title}`, 'info', 'REMINDER');
          queueSentence(`Reminder, Sir: ${due[0].title}.`, { countsAsReply: false });
        } else if (due.length > 1) {
          notify(`You have ${due.length} reminders due`, 'info', 'REMINDER');
          queueSentence(`You have ${due.length} reminders due, Sir.`, { countsAsReply: false });
        }
      } catch {}
    };
    // Delay first check slightly on boot so startup greeting plays cleanly first
    const timer = setTimeout(tick, 4500);
    const id = setInterval(tick, 30000);
    return () => {
      clearTimeout(timer);
      clearInterval(id);
    };
  }, [queueSentence]);

  // Escape key interrupts speaking and generation instantly
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleBargeIn();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBargeIn]);

  // Session boot: mark saved chat as already-spoken, then always play the Alfred intro (never replay last turn).
  const sessionBootRef = useRef({ done: false, assistantCountAtBoot: 0 });

  useEffect(() => {
    if (!ai.chatBoot || sessionBootRef.current.done) return;
    sessionBootRef.current.done = true;
    sessionBootRef.current.assistantCountAtBoot = ai.chatBoot.assistantCount;

    const lastFromLog = [...ai.messages]
      .reverse()
      .find((m) => m.role === 'assistant' && !m.isError);
    if (lastFromLog?.content) {
      lastSpokenRef.current = lastFromLog.content;
    }

    let cancelled = false;
    (async () => {
      try {
        const timeData = await window.electronAPI?.getSystemTime?.();
        if (cancelled) return;

        const greeting = buildStartupGreeting({
          userName: settings.userName,
          timeData: timeData || undefined,
          hasHistory: Boolean(lastFromLog?.content || (ai.messages && ai.messages.length > 0)),
        });

        lastSpokenRef.current = greeting;
        setTimeout(() => {
          if (!cancelled && !isMuted) {
            queueSentence(greeting, { countsAsReply: false });
          }
        }, 600);
      } catch { /* skip spoken greeting on failure */ }
    })();

    return () => {
      cancelled = true;
    };
  }, [ai.chatBoot, queueSentence, settings.userName, isMuted, ai.messages]);

  // Fallback TTS for new assistant replies in this session only (not restored chat log).
  useEffect(() => {
    if (!sessionBootRef.current.done) return;
    if (ai.streamState !== 'idle' || isMuted) return;

    const assistants = ai.messages.filter((m) => m.role === 'assistant' && !m.isError);
    if (assistants.length <= sessionBootRef.current.assistantCountAtBoot) return;

    const last = assistants[assistants.length - 1];
    if (!last?.content) return;
    if (last.content === lastSpokenRef.current) return;
    if (last.content === 'Executing...' || last.content === 'Executing command...') return;
    if (!replyAudioSentThisTurnRef.current) {
      lastSpokenRef.current = last.content;
      queueSentence(last.content, { countsAsReply: true });
    } else if (last.content !== lastSpokenRef.current) {
      lastSpokenRef.current = last.content;
    }
  }, [ai.messages, ai.streamState, isMuted, queueSentence]);

  const aiBusy = ai.streamState !== 'idle' || Boolean(ai.toolExecuting);
  // Block mic during playback/synthesis and brief echo cooldown — not during silent LLM/tool work
  const micBlocked = ttsPlaying || ttsSynthesizing || listenCooldown;

  const flushPendingUtterance = useCallback(() => {
    const pending = pendingUtteranceRef.current;
    if (!pending) return;
    if (ai.streamState !== 'idle' || ai.toolExecuting) return;
    pendingUtteranceRef.current = null;
    streamTurnSpokenCountRef.current = 0;
    addLogEvent(`voice::queued — ${pending}`);
    ai.sendMessage(pending);
  }, [ai, addLogEvent]);

  useEffect(() => {
    flushPendingUtterance();
  }, [ai.streamState, ai.toolExecuting, flushPendingUtterance]);

  const onHeard = useCallback((text) => {
    const cleaned = String(text || '').trim();
    if (Date.now() < ignoreSttUntilRef.current) {
      addLogEvent(`voice::ignored echo window — ${cleaned}`);
      return;
    }
    if (isSttNoise(cleaned)) {
      addLogEvent(`voice::ignored noise — ${cleaned}`);
      return;
    }
    if (isEchoOfLastSpoken(cleaned, lastSpokenRef.current)) {
      addLogEvent(`voice::ignored echo — ${cleaned}`);
      return;
    }
    addLogEvent(`voice::heard — ${cleaned}`);
    streamTurnSpokenCountRef.current = 0;
    stopTTS();
    if (ai.streamState !== 'idle' || ai.toolExecuting) {
      ai.stopGeneration();
    }
    ai.sendMessage(cleaned);
  }, [ai, addLogEvent, stopTTS]);

  const [autoListen, setAutoListen] = useState(true);

  const voiceInput = useVoiceInput({
    paused: micBlocked,
    autoListen,
    onFinal: onHeard,
    onStatus: setVoiceStatus,
    onBargeIn: handleBargeIn,
  });

  const startNewChat = useCallback(async () => {
    try {
      if (ai.messages.some((m) => m.role !== 'system')) {
        await window.electronAPI?.memorySummarizeSession?.(ai.messages);
      }
      await window.electronAPI?.memoryCreateSession?.();
    } catch {}
    ai.clearChat();
    lastSpokenRef.current = '';
    streamTurnSpokenCountRef.current = 0;
    sessionBootRef.current.assistantCountAtBoot = 0;
    stopTTS();
    addLogEvent('sys::new session started');
  }, [ai, stopTTS, addLogEvent]);

  const hudState = (() => {
    if (ai.ollamaStatus === 'offline') return 'offline';
    if (ai.toolExecuting) return 'executing';
    if (ai.streamState !== 'idle') return 'thinking';
    if (ttsPlaying) return 'speaking';
    if (voiceStatus === 'recording' || voiceStatus === 'listening') return 'listening';
    return 'idle';
  })();

  const detail = hudState === 'offline'
    ? 'AI CORE OFFLINE — ADD GEMINI KEY IN SYS'
    : ttsPlaying
      ? 'SPEAKING…'
      : ttsSynthesizing
        ? 'PREPARING AUDIO…'
        : micBlocked
          ? 'PAUSED — FINISHING AUDIO…'
          : ai.toolExecuting
            ? ai.toolExecuting.replace(/_/g, ' ').toUpperCase()
            : ai.streamState !== 'idle'
              ? 'THINKING…'
              : voiceStatus === 'transcribing'
                ? 'TRANSCRIBING SPEECH…'
                : voiceStatus === 'recording'
                  ? 'VOICE DETECTED — LISTENING…'
                  : voiceStatus === 'paused'
                    ? 'PAUSED — ALFRED IS SPEAKING'
                    : autoListen
                      ? 'AUTONOMOUS LISTENING — SPEAK ANYTIME'
                      : 'TAP MIC TO RESUME';

  return (
    <>
      <JarvisHud
        state={hudState}
        detail={detail}
        messages={ai.messages}
        streamingContent={ai.streamState === 'streaming' ? ai.streamingContent : ''}
        logs={logs}
        pollInterval={settings.pollInterval}
        providerLabel={`${PROVIDER_LABELS[ai.providerConfig?.type] || 'AI'} · ${ai.modelName || ''}`}
        isMuted={isMuted}
        onToggleMute={() => { if (!isMuted) stopTTS(); setIsMuted((m) => !m); }}
        onOpenSettings={() => setShowSettings(true)}
        onOpenMemory={() => setShowMemory(true)}
        onNewChat={startNewChat}
        onSend={(text) => { stopTTS(); ai.sendMessage(text); }}
        onStop={ai.stopGeneration}
        isBusy={ai.streamState !== 'idle'}
        onTapMic={() => {
          if (voiceStatus === 'listening' || voiceStatus === 'recording') {
            voiceInput.stop();
            setAutoListen(false);
            addLogEvent('voice::listening paused');
          } else {
            stopTTS();
            setAutoListen(true);
            voiceInput.start();
            addLogEvent('voice::autonomous listening on');
          }
        }}
      />

      {showSettings && (
        <Settings
          settings={settings}
          onUpdate={setSettings}
          onClose={() => setShowSettings(false)}
          providerConfig={ai.providerConfig}
          onSwitchProvider={ai.switchProvider}
        />
      )}

      {showMemory && <MemoryPanel onClose={() => setShowMemory(false)} />}
    </>
  );
}
