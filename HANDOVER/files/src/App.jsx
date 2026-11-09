import React, { useState, useCallback, useEffect, useRef } from 'react';
import JarvisHud from './components/JarvisHud';
import Settings, { useSettings } from './components/Settings';
import MemoryPanel from './components/MemoryPanel';
import { useAI } from './hooks/useAI';
import { useVoiceInput } from './hooks/useVoiceInput';
import { playTtsBuffer, stopTtsAudio } from './audio/audioBus';
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
  const playbackIdRef = useRef(0);
  const sentenceQueueRef = useRef([]);
  const isDrainingRef = useRef(false);
  const streamTurnSpokenCountRef = useRef(0);

  const addLogEvent = useCallback((event) => {
    const parts = event.split('::');
    const type = parts[0] || 'sys';
    const message = parts.slice(1).join('::') || event;
    setLogs((prev) => [...prev, { type, message }].slice(-30));
  }, []);

  const stopTTS = useCallback(() => {
    playbackIdRef.current += 1;
    sentenceQueueRef.current = [];
    isDrainingRef.current = false;
    stopTtsAudio();
    window.electronAPI?.stopSpeaking?.();
    setTtsSynthesizing(false);
    setTtsPlaying(false);
  }, []);

  const drainSentenceQueue = useCallback(async () => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;

    try {
      let prefetchedPromise = null;

      while (sentenceQueueRef.current.length > 0 || prefetchedPromise) {
        const currentPlaybackId = playbackIdRef.current;

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

        if (!raw || raw.byteLength === 0) continue;

        // Immediately pre-fetch the next sentence while current is about to play
        if (sentenceQueueRef.current.length > 0) {
          const aheadText = sentenceQueueRef.current.shift();
          if (aheadText) {
            prefetchedPromise = window.electronAPI?.speakText?.(aheadText);
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
          playTtsBuffer(bytes, () => {
            resolve();
          });
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
      setListenCooldown(true);
      window.dispatchEvent(new CustomEvent('jarvis:tts-finished'));
      setTimeout(() => setListenCooldown(false), 300);
    }
  }, [addLogEvent]);

  const queueSentence = useCallback((text) => {
    if (isMuted) return;
    const clean = String(text || '')
      .replace(/<<<TOOL:[^>]+>>>/g, '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_#>`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean || clean === 'Executing...' || clean === 'Executing command...') return;

    streamTurnSpokenCountRef.current += 1;
    sentenceQueueRef.current.push(clean);
    drainSentenceQueue();
  }, [isMuted, drainSentenceQueue]);

  const ai = useAI({
    onLogEvent: addLogEvent,
    onSentence: queueSentence,
  });

  // Handle barge-in: immediately cancel audio and interrupt AI generation
  const handleBargeIn = useCallback(() => {
    stopTTS();
    ai.stopGeneration();
  }, [stopTTS, ai]);

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

  // Startup greeting on launch: greet the user as Alfred
  const hasGreetedRef = useRef(false);
  const isInitialMountRef = useRef(true);

  useEffect(() => {
    if (hasGreetedRef.current) return;
    hasGreetedRef.current = true;

    const greeting = "Hello, good morning, sir. I'm Alfred, your personal butler, ready to help you with whatever tasks you are having or whatever you think is best.";
    lastSpokenRef.current = greeting;
    if (ai.setMessages) {
      ai.setMessages([{ role: 'assistant', content: greeting }]);
    }

    const timer = setTimeout(() => {
      queueSentence(greeting);
    }, 600);

    return () => clearTimeout(timer);
  }, [queueSentence, ai.setMessages]);

  // Fallback: Speak assistant reply ONLY for live user turns, never for loaded past logs
  useEffect(() => {
    if (isInitialMountRef.current) {
      // First tick: mark as past initial load so we don't speak loaded chat history
      isInitialMountRef.current = false;
      const last = [...ai.messages].reverse().find((m) => m.role === 'assistant' && !m.isError);
      if (last?.content) {
        lastSpokenRef.current = last.content;
      }
      return;
    }

    if (ai.streamState !== 'idle' || isMuted) return;
    const last = [...ai.messages].reverse().find((m) => m.role === 'assistant' && !m.isError);
    if (!last?.content) return;
    if (last.content === lastSpokenRef.current) return;
    if (last.content === 'Executing...' || last.content === 'Executing command...') return;
    lastSpokenRef.current = last.content;
    if (streamTurnSpokenCountRef.current === 0) {
      queueSentence(last.content);
    }
  }, [ai.messages, ai.streamState, isMuted, queueSentence]);

  const aiBusy = ai.streamState !== 'idle' || Boolean(ai.toolExecuting);
  // Mic is only blocked if AI is actively outputting, TTS is actively rendering, or during 300ms echo cooldown
  const micBlocked = aiBusy || ttsPlaying || listenCooldown;

  const onHeard = useCallback((text) => {
    const cleaned = String(text || '').trim();
    if (!cleaned || cleaned.length < 2) return;
    if (/^(?:00?:\d\d|\d\d?|[\d:\s.,]+|\[.*?\]|\(.*?\))$/i.test(cleaned)) return;
    if (!/[a-zA-Z]/.test(cleaned)) return;
    addLogEvent(`voice::heard — ${cleaned}`);
    streamTurnSpokenCountRef.current = 0;
    stopTTS();
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
    : ai.toolExecuting
      ? ai.toolExecuting.replace(/_/g, ' ').toUpperCase()
      : voiceStatus === 'transcribing'
        ? 'TRANSCRIBING SPEECH…'
        : voiceStatus === 'recording'
          ? 'VOICE DETECTED — LISTENING…'
          : voiceStatus === 'listening'
            ? 'AUTONOMOUS LISTENING — SPEAK ANYTIME'
            : ttsSynthesizing
              ? 'PREPARING AUDIO…'
              : ttsPlaying
                ? 'SPEAKING…'
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
