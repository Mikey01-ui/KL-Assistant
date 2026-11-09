import React, { useState, useRef, useEffect, memo, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MemoizedMessage = memo(({ msg, isResponded }) => (
  <div className="chat-message">
    <div className={`msg-sender ${msg.role === 'user' ? 'user-sender' : ''}`}>
      <span className="sender-accent" />
      {msg.role === 'user' ? 'You' : 'ALFRED'}
    </div>
    {msg.role === 'user' ? (
      <div>
        <div className={`msg-content user-content`} style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
        <div className={`msg-status ${isResponded ? 'responded' : ''}`}>
          {isResponded ? '✓✓' : '✓'}
        </div>
      </div>
    ) : (
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
      </div>
    )}
  </div>
));

export default function ChatCore({ ollamaHook, onLogEvent, ttsSpeaking, stopTTS }) {
  const {
    messages,
    streamingContent,
    streamState,
    sendMessage,
    stopGeneration,
    toolExecuting,
    modelWarming,
  } = ollamaHook;

  const [input, setInput] = useState('');
  const [isMicActive, setIsMicActive] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceStatusText, setVoiceStatusText] = useState('initializing');
  const [visibleCount, setVisibleCount] = useState(50);

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  const filteredMessages = useMemo(() => {
    return messages.filter(m => m.role !== 'system');
  }, [messages]);

  const slicedMessages = useMemo(() => {
    return filteredMessages.slice(-visibleCount);
  }, [filteredMessages, visibleCount]);

  useEffect(() => {
    if (!window.electronAPI?.onVoiceText || !window.electronAPI?.onVoiceStatus) {
      setVoiceStatusText('unavailable');
      return undefined;
    }
    const removeVoiceText = window.electronAPI.onVoiceText((text) => {
      if (text) {
        onLogEvent?.(`voice::heard — ${text}`);
        if (ttsSpeaking) stopTTS();
        sendMessage(text);
      }
    });
    const removeVoiceStatus = window.electronAPI.onVoiceStatus((status) => {
      setVoiceStatusText(status);
      if (status === 'recording') setIsTranscribing(true);
      else if (status === 'ready' || status === 'idle') setIsTranscribing(false);
    });
    return () => {
      removeVoiceText?.();
      removeVoiceStatus?.();
    };
  }, [sendMessage, onLogEvent, ttsSpeaking, stopTTS]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSend = useCallback(() => {
    if (!input.trim() || streamState !== 'idle') return;
    if (ttsSpeaking) stopTTS();
    sendMessage(input.trim());
    setInput('');
  }, [input, streamState, sendMessage, ttsSpeaking, stopTTS]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const toggleMic = () => {
    if (isMicActive) {
      window.electronAPI?.voiceStop?.();
      setIsMicActive(false);
      setIsTranscribing(false);
      onLogEvent?.('voice::mic off');
    } else {
      if (ttsSpeaking) stopTTS();
      window.electronAPI?.voiceStart?.();
      setIsMicActive(true);
      onLogEvent?.('voice::mic on');
    }
  };

  const isStreaming = streamState !== 'idle';
  const hasMessages = filteredMessages.length > 0;
  const canLoadMore = filteredMessages.length > visibleCount;

  return (
    <div className="chat-area">
      {/* Messages */}
      <div className="chat-messages">
        {!hasMessages && !isStreaming && (
          <div className="chat-empty">
            <div className="chat-empty-icon">◈</div>
            <div className="chat-empty-text">How can I help you, Sir?</div>
            <div className="chat-empty-hint">Type a message or use voice input</div>
          </div>
        )}

        {canLoadMore && (
          <button className="load-more-btn" onClick={() => setVisibleCount(p => p + 50)}>
            ↑ Load earlier messages
          </button>
        )}

        {slicedMessages.map((msg, idx) => {
          const globalIndex = filteredMessages.length - slicedMessages.length + idx;
          const nextMsg = filteredMessages[globalIndex + 1];
          const isResponded = msg.role === 'user' && nextMsg?.role === 'assistant';
          return <MemoizedMessage key={globalIndex} msg={msg} isResponded={isResponded} />;
        })}

        {/* Streaming */}
        {streamState === 'waiting' && (
          <div className="streaming-indicator">
            <span className="streaming-dot" />
            {modelWarming ? 'Loading model…' : toolExecuting ? `Running ${toolExecuting}…` : 'Thinking…'}
          </div>
        )}

        {streamState === 'streaming' && streamingContent && (
          <div className="chat-message">
            <div className="msg-sender">
              <span className="sender-accent" />
              ALFRED
            </div>
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
              <span className="streaming-dot" style={{ display: 'inline-block', width: 6, height: 6, marginLeft: 4, verticalAlign: 'middle' }} />
            </div>
          </div>
        )}

        {/* TTS indicator */}
        {ttsSpeaking && (
          <div style={{ padding: '4px 0' }}>
            <span className="tts-indicator" onClick={stopTTS} title="Click to stop">
              🔊 Speaking… tap to stop
            </span>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <div className="input-area">
        <div className="input-container">
          {/* Mic button */}
          <button
            className={`input-btn ${isMicActive ? 'mic-active' : ''}`}
            onClick={toggleMic}
            title={isMicActive ? 'Stop listening' : 'Start voice input'}
          >
            🎙
          </button>

          <textarea
            ref={inputRef}
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message ALFRED…"
            rows={1}
            disabled={isStreaming}
          />

          {isStreaming ? (
            <button className="input-btn stop-btn" onClick={stopGeneration} title="Stop generation">
              ■
            </button>
          ) : (
            <button
              className="input-btn send-btn"
              onClick={handleSend}
              disabled={!input.trim()}
              title="Send message"
            >
              ↑
            </button>
          )}
        </div>

        {isMicActive && (
          <div className="voice-status">
            {voiceStatusText === 'recording'
              ? '● Recording speech…'
              : voiceStatusText === 'processing'
              ? '● Transcribing…'
              : voiceStatusText === 'listening'
              ? '● Listening… speak now'
              : voiceStatusText.startsWith('error_no_microphone')
              ? '⚠ No microphone detected — please check permissions'
              : '● Microphone active'}
          </div>
        )}
      </div>
    </div>
  );
}
